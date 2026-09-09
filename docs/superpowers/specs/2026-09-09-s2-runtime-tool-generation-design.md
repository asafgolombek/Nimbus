# S2 — Runtime Tool Generation

> **Status: DESIGNED 2026-09-09, NOT IMPLEMENTED.** Nothing in this document exists in the code
> yet. Invariant **I39**, static rule **D29**, the `tool` egress coverage class, the
> `[tool_generation]` config section, the `toolgen.*` IPC namespace and the `nimbus tool`
> subcommands are all **reserved names in this spec only** — do not cite any of them as shipped.
>
> The one exception is `tool_generation`, which has been a member of `AI_V2_CAPABILITIES`
> (`packages/gateway/src/policy/types.ts:52`) since the exec slice and is referenced **nowhere
> else in the tree, not even in a test**. It is a declared-but-unenforced capability name, exactly
> the state `multimodal_input` was in before multimodal PR 2. PR 1 below is what makes it real.
>
> **Slot:** [Spine S2 — Local Compute Fleet](../../roadmap.md#active), the row *"Runtime tool
> generation"* — after multimodal I/O closed (2026-09-05) and the overnight fleet's PR 2a landed
> (2026-09-08), **this is the last unstarted spine row in S2**. Closing it closes the slot and
> opens S3. Detail source: [Phase 14 § Stretch — Tool
> Generation](../../roadmap.md#phase-14--agent-evolution--ai-v2).
>
> Read [§ Active](../../roadmap.md#active) for delivery status, never this header.

---

## 1. Goal

Let the agent extend its own tool surface at runtime: draft an MCP tool for a service Nimbus has
no connector for, prove the sandbox confines it, obtain the local owner's approval, and register
it **for the session only**. Persistence is a separate, manually-reviewed act (§ 10, PR 3).

This is the highest-blast-radius row in the repository, and the reason is worth stating plainly
rather than discovering during review: **the model that authors the code has indexed connector
text in its context.** That text is untrusted by construction — it is why `wrapToolOutput` (I11)
and the `<tool_output>` envelope exist. A prompt injection carried in an indexed Jira comment can
therefore influence, and in the limit fully author, the body of a tool that is about to be given
network access and credentials.

Every defense below is placed so that **the model's cooperation is not required for it to hold.**
That is the single design rule this spec is organised around. A defense the generated body could
decline to invoke is not a defense.

## 2. Non-goals, stated so they are not re-litigated

- **Not a connector-authoring replacement.** `nimbus scaffold` and `create-nimbus-connector`
  already exist for a human writing a real connector against the published SDK. This is for a
  tool that lives and dies inside one session.
- **Not a credential broker.** A generated tool never inherits an existing connector's secret
  (§ 6.3). If it has no credential of its own it makes unauthenticated requests or it makes none.
- **Not agent-initiated in PR 1.** The two paths ship behind two switches (§ 9); PR 1 is
  owner-initiated only.
- **Not persistent in PR 1.** Ephemeral means in-memory; a gateway restart drops every generated
  tool. There is no schema migration in PR 1 (§ 8).
- **No local fine-tuning, no tool-use trace dataset.** Those remain Phase 14 stretch rows and the
  spine table does not name them in S2.

## 3. The constraint that shaped everything: per-host network filtering is not enforceable on Windows

The obvious design — the generated tool declares its hosts in its manifest, and the existing
sandbox enforces that list — **does not work**, and the reason is a platform fact rather than a
missing feature.

| Platform | A declared `permissions.network` allow-list is… | Site |
|---|---|---|
| macOS | **Enforced exactly.** `generateSbplProfile` emits `(remote tcp "*:<port>" (host "<h>"))` per entry under `(deny default)`. No helper needed. | `platform/sandbox/darwin.ts:163-171` |
| Linux | **Enforced exactly, or refused.** `canConfine` returns the helper's reason for any non-empty network set when `nimbus-sandbox-helper` is absent. | `platform/sandbox/linux.ts:230-239` |
| Windows | **Not enforced at all.** AppContainer's `internetClient` is all-or-nothing; per-host "would need a WFP callout driver with kernel-mode signing". | `platform/sandbox/win32.ts:73-88` |

Two details make the Windows row worse than it first reads:

1. **`canConfine` deliberately returns `null`** — *yes, I can confine this* — for a multi-host
   policy on Windows. The asymmetry is reported only through `degradedReason()`. So the guard that
   I33 and the terminal lane rely on to refuse before consent **would not refuse here**, by
   design: for a hand-written first-party connector the all-or-nothing grant is an accepted
   defense-in-depth degradation, and `canConfine` is answering the question those callers ask.
2. On Linux, `decideNetworkMode` maps a non-empty host set with no helper to `"fallback"`, and
   `buildBwrapArgv` maps anything that is not `"no-net"` to `--share-net`
   (`linux.ts:37-54`). A caller that spawns *without* asserting `canConfine` first — which the
   lazy-mesh connector path does — therefore gets full unfiltered network from a policy that
   named two hosts.

For a trusted connector, both behaviours are defensible. For LLM-authored code they are not: the
owner would be approving *"this tool may reach api.example.com"* while actually being handed
*"this tool may reach anything"*. That is the same shape as the two failures already on record in
this project — an air-gap switch that was inert while the docs promised it, and a hero demo whose
output was fabricated. **An approval prompt that overstates the bound is worse than no prompt.**

**Resolution: the generated tool gets no network at all, on every platform, and the gateway makes
its requests for it.** § 4.

## 4. Architecture — brokered egress

### 4.1 The shape

```
  owner ──"nimbus tool create"──▶ toolgen-gate.ts
                                       │
                          (refusals BEFORE consent: § 5)
                                       │
                                       ▼
                    model drafts BODY ──▶ toolgen-stub.ts
                                          (Nimbus authors skeleton +
                                           manifest with network: [])
                                       │
                          runSandboxContractTests(manifest)   § 7
                                       │
                          owner approves VERBATIM artifact    § 5 step 7
                                       │
                                       ▼
                              toolgen-registry.ts  (in-memory, session-keyed)
                                       │
                            wrapServerSpec (I15/D10) ──▶ sandboxed tool process
                                       │                        │
                                       │      nimbusFetch(url)  │  raw fetch() ──▶ ✗ BLOCKED
                                       │◀───────────────────────┘     (no network, all 3 OSes)
                                       ▼
                              toolgen-broker.ts
                                 ├─ host on approved envelope?      else refuse
                                 ├─ attach credential bound to THAT host  § 6.3
                                 ├─ append `tool`-class egress row   § 6 (fail-closed)
                                 └─ perform request, return response
```

### 4.2 Files

| File | Role |
|---|---|
| `toolgen/toolgen-gate.ts` | The chokepoint. `createGeneratedTool()`, ordered like `exec-gate.ts` / `cu-gate.ts`. |
| `toolgen/toolgen-stub.ts` | Nimbus-authored skeleton, `nimbusFetch` helper, and the manifest constructor. |
| `toolgen/toolgen-broker.ts` | Serves the brokered-fetch request. The ONLY site that performs a generated tool's outbound request. |
| `toolgen/toolgen-registry.ts` | Ephemeral session-keyed registry. In-memory only. |
| `toolgen/toolgen-consent-broker.ts` | Owner approval, reusing the `ConsentBroker` shape `exec-gate.ts` already has. |
| `toolgen/toolgen-credentials.ts` | The sole site composing `toolgen.<toolId>.<hostSlug>` Vault keys. |
| `toolgen/toolgen-artifact.ts` | `GeneratedToolArtifact` + its canonical serialization (§ 4.5). |
| `toolgen/toolgen-types.ts` | Envelope, approved host list, credential bindings, outcome union. |
| `egress/tool-egress.ts` | `recordToolEgress` — the new `tool` coverage class appender. |

### 4.3 Why the model's cooperation is not required

1. The manifest is **Nimbus-constructed** with `permissions.network: []` **by construction**,
   rejecting a requested net grant rather than dropping it — I33's exact wording for the exact
   same reason.
2. A body that ignores `nimbusFetch` and calls raw `fetch()` therefore **simply fails**:
   `--unshare-net` on Linux (its own netns, loopback included), `(deny default)` with no
   `(allow network*)` block emitted on macOS, no `internetClient` on Windows. All three, no
   helper required, no asymmetry — the Windows gap of § 3 does not exist when the set is empty.
3. `nimbusFetch` is consequently the only door, and it opens onto the gateway, not the network.
4. Generated tools inherit I15/D10 free: every `ServerSpec` already routes through
   `wrapServerSpec`, so the sandbox is not optional for this path any more than for a connector.

**The transport, the request-issuing helper and the manifest are all Nimbus-authored.** The model
fills a hole in a template it does not control. That is what makes one human approval a sufficient
boundary here, and it is the direct answer to the question I33 left open — *"the LLM cannot invoke
an execution… that is the assumption to re-examine first when an agent-callable path lands"*.

### 4.4 The callback channel

MCP over stdio is bidirectional, and **stdio is the one channel every sandbox forwards on all
three platforms.** This matters because the alternatives are all closed: fd 3/4 is not forwarded
by the Windows AppContainer helper (I35 records this), and a loopback socket cannot reach the
gateway anyway — `--unshare-net` gives the Linux child a fresh netns whose loopback is **its own,
not the host's**, so `127.0.0.1` there is a different machine as far as the gateway is concerned,
and AppContainer blocks loopback on Windows without an explicit `CheckNetIsolation` exemption.
That property is not incidental: it is the same one I33 relies on to keep a sandboxed execution
away from the Gateway's own IPC socket and `127.0.0.1` HTTP API.

Feasibility is confirmed in the libraries already vendored: `@mastra/mcp` registers a
server→client request handler today (`elicitation/create`, `dist/index.js:22037`), and
`@modelcontextprotocol/sdk` 1.30.0 carries both elicitation and sampling.

`nimbusFetch` does **not** reuse `elicitation/create` or `sampling/createMessage` — both mean
something else (ask the human; ask the client's model), and overloading them would put a
generated tool's egress on a method some other component may one day handle. It uses a custom
method whose literal is confined by **D29(a)** to the two files that emit and serve it.

### 4.5 One canonical artifact

`GeneratedToolArtifact` — manifest, body, host list, credential bindings — is canonically
serialized from the start, via the `canonicalizeManifest` that `extensions/canonical-json.ts`
already re-exports from the SDK and that extension signature verification runs on.

The same bytes serve all three consumers: **what the owner approves, what is hashed into the
`tool.generate` audit row, and what PR 3 signs.** Defining this in PR 1 costs almost nothing and
removes a whole class of PR 3 defect — if PR 1 kept loose in-memory fields, PR 3 would have to
invent a canonicalization after the fact, and the failure mode is the nasty one: the approved
bytes and the signed bytes differ, so a signature attests to something the owner never read.

That is I33's rule extended one hop. *Read the script once, so the bytes the owner approved are
the bytes that execute* — **and later the bytes that get signed.**

## 5. The gate — ordered, refusals before consent

`createGeneratedTool()` runs in a fixed order. As with I33 and I35, every refusal that can be
decided without the owner is decided **before** the owner is prompted, so a disabled capability
never advertises itself by asking.

1. **Config off** — `[tool_generation] enabled` is `false` (default). Refuse.
2. **Org policy off** — `EnforcedPolicy.capabilitiesDisabled` (I22) contains `tool_generation`.
   Refuse fail-closed, **and refuse fail-closed when the accessor is absent** rather than
   defaulting to enabled. This is the gap multimodal PR 1 left open and PR 2 closed; it is
   written into the order here rather than deferred to a follow-up.
3. **Initiator not allowed** — an agent-initiated request while `allow_agent_initiated` is
   `false`. Refuse. (PR 2; in PR 1 no agent-initiated path exists to refuse.)
4. **Session budget** — `max_tools_per_session` already spent. Refuse.
5. **Sandbox cannot confine** — `runner.canConfine(policy)` non-null for the **empty-network**
   policy this tool will actually spawn with. Not `degradedReason()` (non-null on Windows even
   when the runner is fully active) and not `isFullyActive()` (reports the Linux per-host helper a
   no-network policy never touches, and CI does not install it). I33 records both traps; this
   asserts the policy that spawns.
6. **Draft, wrap, contract-test** — the model produces the body; `toolgen-stub.ts` wraps it;
   `runSandboxContractTests` runs (§ 7). A red contract test refuses **before** consent.
7. **Owner approves the VERBATIM artifact** — never a digest, which is a rubber stamp with extra
   steps (I33). The prompt shows the full body, the host list, the credential binding per host,
   the initiator, and the § 11 residual.
8. **Register** ephemerally. Spawn lazily on first call through `wrapServerSpec`.

A denied or timed-out approval registers nothing. Every outcome appends one `tool.generate` audit
row: the artifact in full where one exists (a refusal decided before consent records only the
tool id and a reason code — nothing was approved, often nothing was drafted), with
`hitl_status` CHECK-constrained to approved/rejected/not_required. A refusal-before-consent and an
owner denial both record `rejected`, distinguished by `outcome`; **`not_required` is never used on
this action type**, since it would read as "generated a tool without needing approval".

## 6. Egress

### 6.1 A new coverage class

`COVERAGE_CLASSES` (`egress/egress-coverage.ts:29`) gains a tenth member, `tool`, and
`THIS_BINARY_COVERAGE.tool` is raised from `none` to `per-call` **in the same commit that gives
`recordToolEgress` its production caller** — the rule that file states about itself, and that the
`browser` class followed.

No existing appender covers this. `task` fires at `connectors.dispatch` inside `engine/executor.ts`
(I29/D22(a)); a generated tool's outbound request never passes through there. `sync`, `model`,
`chatops` and `browser` are each bound to their own subsystem. Without a new class, a generated
tool's requests would leave the machine with no row and no stated exclusion — the precise defect
the `chatops` class was added to fix.

### 6.2 The appender

One row per brokered request, appended **before** the request is made, `destination` the resolved
host, `payload_summary` the request method and byte length — never the body, never the credential.
An append failure aborts that request (fail-closed), so a zero-row window means no generated tool
reached the network, never that one did so unrecorded.

A refused host appends a `result_status='blocked'` row, mirroring the executor's denied-gate row.

### 6.3 Credentials

**Per-host, not per-tool.** The binding is `{host → vault key}` and the broker attaches by
resolved destination host. Bound per-tool instead, a tool approved for hosts A and B could ask the
broker to hit B carrying A's credential — the tool chooses the URL, so the tool would choose the
recipient of the secret.

**Never inherited.** A generated tool gets its own Vault key or none. An existing connector's
secret confers nothing, the same rule I37 applies to `[llm.remote.<vendor>]` keys not conferring
vision rights: a credential that merely exists must never enable a capability nobody opted into.

**Never in the tool process.** The broker attaches the credential; the tool never receives it. It
cannot be read, so it cannot be exfiltrated — this holds even if the body is fully
attacker-authored.

Keys live under `toolgen.<toolId>.<hostSlug>`, composed in exactly one place
(`toolgen/toolgen-credentials.ts`), which joins `VAULT_KEY_ALLOW_LIST` in
`scripts/structure-audit/check-nimbus-invariants.ts`. **Stated bound:** the keys are composed
dynamically, so the audit's literal scan cannot see them; capability confinement — only this file
is handed the Vault for that prefix — is the real defense, and the allow-list entry documents the
keyspace rather than enforcing it. This mirrors D27(b)'s own stated bound on the `media_grant`
table.

Written only by an explicit `nimbus tool credential set`. Never by the model.

## 7. The contract test finally gets a caller

`runSandboxContractTests(manifestPath)` is exported from `@nimbus-dev/sdk/testing` and has **zero
callers anywhere in this repository today**. What it does is fork a probe binary and verify that
the runtime sandbox actually enforces the manifest's declared `permissions.network` and
`permissions.filesystem`.

The roadmap row says the agent "runs the `@nimbus-dev/sdk` contract test, and on green registers
it", which reads as a claim about the tool's *behaviour*. The test cannot support that claim — the
only other `testing` export is `MockGateway`, which returns `{}`. It can support a **confinement**
claim, and confinement is the claim that actually matters here: green means *this machine's
sandbox really does confine this manifest*, checked on the box the tool will run on rather than
assumed from the platform matrix in § 3.

So the roadmap row is honoured, with its meaning narrowed to what the artifact can bear. This is
also the test's first production caller in the gateway, which is worth noting for the reverse
reason: an SDK export with no callers is an untested contract in both directions.

## 8. Data model

**PR 1 adds no migration.** Ephemeral means in-memory: `toolgen-registry.ts` holds a
session-keyed map and a gateway restart drops it, the same shape as I30's in-memory pairing
window. This is worth stating explicitly because V57, V58, V59 and V60 each carried one and the
reflex is to assume V61 belongs here. It does not — it belongs to PR 3 (§ 10).

Audit rows go to the existing `audit_log`; egress rows to the existing `egress_ledger` (V44).

## 9. Config, IPC, CLI

```toml
[tool_generation]
enabled = false               # lock 1 — default off, like every ai_v2 capability
allow_agent_initiated = false # lock 2 — PR 2; the dangerous half is opt-in ON TOP of lock 1
allowed_hosts = []            # lock 3 — PR 2, and it constrains the AGENT-initiated path only (§ 9.1)
max_tools_per_session = 3
max_requests_per_tool = 50
request_timeout_ms = 10000
```

### 9.1 Why `allowed_hosts` binds only the agent-initiated path

The tempting design is a global outer boundary that per-tool approval can narrow but never widen —
the monotonic-stricter shape I22 uses, and the `[computer_use] allowed_lanes` precedent where
`enabled = true` on its own actuates nothing.

It was rejected for the owner-initiated path, on this argument: **a lock whose error message tells
you how to open it is not a second judgment, it is a second step.** If `nimbus tool create` fails
with *"host not in allowed_hosts — add it"* and the owner edits config in the same minute, the
ceiling bought nothing. Its value depends entirely on the config edit being genuinely out of band
from the approval.

That condition holds in exactly one of the two paths:

- **Owner-initiated** — the human typed the intent. The approval is not a reflex; it is them
  finishing an act they started, reading a short host list against a request they made seconds
  ago. `max_tools_per_session` bounds the fatigue. A config ceiling here is friction without a
  threat.
- **Agent-initiated** — a prompt injection in indexed text can manufacture an approval prompt out
  of nothing. The owner never asked for a tool. Here the config edit really is a separate judgment
  made at a different time, because there was no act in progress to complete.

So the third lock ships with the switch it defends, and PR 1 is simpler for it.

### 9.2 Surface

`toolgen.*` joins the **whole-namespace** LAN-forbidden list in `ipc/lan-rpc.ts` alongside `exec`,
`computer`, `media` and `fleet` — `toolgen.create` is RCE-class by definition and
`toolgen.approvalRespond` is the local owner answering a prompt no peer may answer for them. It
stays absent from the Tauri allowlist (I7).

CLI: `nimbus tool create | list | revoke | credential set`, and `nimbus tool save` in PR 3.

Registration into the agent follows the `buildComputerUseTools` pattern verbatim
(`engine/agent.ts:536`): a conditional spread contributing `{}` — *no tool at all*, not a disabled
tool that errors when called — when no live session holds a generated tool.

## 10. Delivery split

**PR 1 — owner-initiated, ephemeral, brokered.** The `toolgen/` chokepoint, `egress/tool-egress.ts`,
the `tool` coverage class, I39, D29(a)+(b), `[tool_generation]` (`enabled` +
`max_tools_per_session` + `max_requests_per_tool` + `request_timeout_ms`), the `toolgen.*` IPC
namespace, `nimbus tool create|list|revoke|credential set`, the LAN-forbid, and `tool_generation`
enforced at last rather than merely declared. No migration.

**PR 2 — agent-initiated**, behind `allow_agent_initiated` plus `allowed_hosts`: the agent-facing
proposal tool, the mid-turn consent pause, and an approval prompt that states the agent rather
than the owner initiated it.

**PR 3 — persistence**, `nimbus tool save`, schema V61. It carries an unresolved question named
here rather than discovered there: **I16 verifies `publisher` extensions by Ed25519 at install and
at every startup, and a self-authored tool has no publisher.** Either it installs unsigned like a
local dev extension — meaning nothing detects on-disk tampering between sessions — or the owner
gets a signing key and saved tools are signed locally. The second is right, and it is a real chunk
of work, which is why it is its own PR rather than smuggled into PR 1. § 4.5 is what makes it
cheap when it arrives.

## 11. Invariant I39 and static rule D29

**I39 (draft).** *A generated tool reaches the network only through `toolgen/toolgen-broker.ts`'s
brokered fetch, to a host on the envelope the LOCAL owner approved, carrying only the credential
bound to THAT host. The tool process's own `permissions.network` is empty by construction on every
platform — a requested grant is rejected, never dropped — so no other route exists; a raw `fetch()`
in the generated body fails at the OS. One `tool`-class egress row is appended before every
brokered request and an append failure aborts it (fail-closed); a refused host appends a `blocked`
row. Credentials are never inherited from a connector, never enter the tool process, and are bound
per-host rather than per-tool. Registration happens only after a green sandbox contract test and
the owner's approval of the VERBATIM canonical artifact, never a digest.*

***Residual, stated here rather than discovered later: the allow-list bounds WHERE a tool may
send, never WHAT.*** *A tool approved for `api.gitea.example` may send that host anything it can
compute, including data it legitimately received. The gate proves the owner saw the body and the
destinations; it does not prove the body is honest about what it does with what it reads. This
sentence belongs in the approval prompt as well as in this invariant.*

**D29(a)** — the brokered-fetch MCP method literal is confined to `toolgen/toolgen-stub.ts` (which
emits it into the generated skeleton) and `toolgen/toolgen-broker.ts` (which serves it). Nothing
else may name it, so no other path can serve a generated tool's egress.

**D29(b)** — the generated-manifest constructor is confined to `toolgen/toolgen-stub.ts`, and
`permissions.network` may not be assigned a non-empty literal there.

Per the triple rule, wiring + this document's promotion into `docs/SECURITY-INVARIANTS.md` + the
enforcement test in `packages/gateway/src/security-invariants.test.ts` land in the same commit.

## 12. Testing

**The load-bearing test is per-platform, and it needs a positive control.** A generated tool whose
body attempts a **raw `fetch()`** to a host that IS on its approved list must fail on Windows,
macOS and Linux — with the same request run through an **unconfined** process first, exactly as
`test/integration/computer-use/terminal-loopback.test.ts` does. Without the control, "the raw
fetch was blocked" passes for any reason at all, including the test never having reached the
network. That test is what makes § 4.3's claim true rather than lucky.

Then:

- A brokered fetch to a host **not** on the envelope is refused and appends a `blocked` row.
- An egress append failure **aborts** the brokered request (fail-closed).
- A red sandbox contract test refuses **before** consent — the owner is never prompted.
- Each § 5 refusal is decided before consent: assert the consent broker was **not** called, not
  merely that the outcome was a refusal. (Asserting the outcome alone passes for a gate that
  prompts and then refuses, which is the failure this ordering exists to prevent.)
- A credential bound to host A is **not** attached to a request to host B by the same tool.
- The registry is empty after a simulated restart.
- I39 enforcement in `security-invariants.test.ts`; D29(a)/(b) in
  `scripts/structure-audit/check-nimbus-invariants.ts`.
- `toolgen/*` needs an `audit:coverage-scopes` entry; without one it is covered only by the
  repo-wide floor.

## 13. What this spec asserts vs. what it assumes

**Verified against the tree on 2026-09-09:**

- `tool_generation` is in `AI_V2_CAPABILITIES` and referenced nowhere else, tests included.
- The § 3 platform table, at the cited line numbers.
- `runSandboxContractTests` is exported by `@nimbus-dev/sdk/testing` and has zero callers here.
- `@mastra/mcp` registers a server→client handler for `elicitation/create` at
  `dist/index.js:22037`; `@modelcontextprotocol/sdk` 1.30.0 carries elicitation and sampling.
- `COVERAGE_CLASSES` has nine members; seven are non-`none`.
- `connectors/lazy-mesh/user-mcp.ts` already spawns an arbitrary user-declared MCP server through
  `wrapServerSpec` with a zero-permission default manifest — the closest existing precedent.
- `ipc/lan-rpc.ts` forbids `exec`, `computer`, `media` and `fleet` at namespace granularity.
- `extensions/canonical-json.ts` re-exports `canonicalizeManifest` from the SDK.

**Assumed, and to be proven during implementation:**

- That a custom MCP method survives the `@mastra/mcp` client transport in both directions without
  patching the library. If it does not, the fallback is the raw `@modelcontextprotocol/sdk`
  `Client` for this path only — the gateway already resolves it transitively — and generated tools
  do not use `MCPClient`. **This is the single largest implementation risk in PR 1** and should be
  spiked before the rest of the gate is built.
- That the sandbox forwards stdio for a network-empty policy identically on all three platforms
  for a long-lived MCP server, not merely for the short-lived exec child measured by I33.
- That `runSandboxContractTests` runs green on a CI runner for an empty-permission manifest. CI
  installs bubblewrap but not `nimbus-sandbox-helper`; an empty network set should not need it
  (`linux.ts:233-238` says so explicitly), but this has never been exercised from the gateway.
