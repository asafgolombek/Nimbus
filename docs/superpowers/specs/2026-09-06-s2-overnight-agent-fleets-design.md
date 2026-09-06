# S2 — Overnight Sub-Agent Fleets on Zero-Marginal Local Compute

> **Status: DESIGN ONLY, 2026-09-06. Nothing in this document is implemented.** Schema **V60**,
> invariant **I38**, static rule **D28**, the `fleet` `ClientKind` member and the
> `agent_fleet` capability name are all RESERVED by this spec and do not exist in the code.
>
> **Slot:** [Spine S2 — Local Compute Fleet](../../roadmap.md#active), the row
> *"[NEW] Overnight sub-agent fleets on zero-marginal local compute"*. Detail source:
> [Phase 27 — The Agent Society](../../roadmap.md#phase-27--the-agent-society), from which this
> primitive was harvested forward by the 2026-06-17 overlay.
>
> With multimodal I/O closed on 2026-09-05, S2 has **two** rows left: this one and runtime tool
> generation. Read [§ Active](../../roadmap.md#active) for delivery status, never Phase 14's or
> Phase 27's own checkboxes — S2 tracks delivery in § Active and the phase checkboxes lag.
>
> **Predecessors this document leans on, by name:**
> [S2 slice 1 — Sandboxed Code Execution](./2026-08-22-s2-sandboxed-code-execution-design.md)
> (I33's ordering discipline: refuse before consent, never advertise a disabled capability),
> [S2 — Computer Use](./2026-08-30-s2-computer-use-design.md) (I35's default-off-with-empty-allow-list
> posture), and [S2 — Multimodal I/O](./2026-09-02-s2-multimodal-io-design.md) (I37's
> *a grant widens, never narrows* shape, which I38 copies deliberately).

---

## 1. Goal

Use compute the user has already paid for, at times they are not using it, to make the briefs they
will want tomorrow already exist.

Today every one of the fourteen built-in agents is a cold, synchronous read: the user asks, waits,
and reads. That is fine for a question you knew you had. It is the wrong shape for the two things
this row exists to enable:

- **Latency.** `nimbus catchup` at 09:00 should be instant, not a thirty-second wait, because the
  machine had eight idle hours to build it.
- **Coverage** (PR 2). Nobody runs `nimbus ownership` against every service every week, so bus-factor
  drift is discovered when someone leaves rather than before. A fleet can sweep what a human would
  never think to ask.

The moat argument that put this in S2: idle local compute is free and rate-limit-free, and a metered
cloud structurally cannot match it. That argument is only honest if the fleet actually yields to the
user's real work, which is why § 4 is the load-bearing section of this document rather than an
appendix.

## 2. Non-goals, stated so they are not re-litigated

- **No autonomous action, no writes, no standing approvals.** The fleet reads and reports. The
  Captain — Phase 17's copilot minus the human on reversible actions — stays in
  [Phase 27 Wave 1](../../roadmap.md#phase-27--the-agent-society), behind Phase 26 capability leases
  and the Phase 10 taint barrier. Neither exists.
- **No new agents.** This slice schedules the agents that already ship. If a brief is not useful
  when a human asks for it, scheduling it does not help.
- **No agent-callable execution path.** Nothing here lets the LLM invoke `nimbus exec`. I33's scope
  bound — *"the LLM cannot invoke an execution, so no indexed untrusted text reaches the prompt"* —
  survives this slice untouched.
- **No subject discovery in PR 1.** The owner names the subject in config. Enumeration is PR 2.

## 3. Delivery split

**PR 1 — the substrate, proved against precomputed briefs.** Host-activity PAL capability, the
fleet scheduler, durable run + brief storage, the `[fleet]` config surface, the `nimbus fleet` CLI,
invariant I38, static rule D28, schema V60.

**PR 2 — the sweep.** Subject enumeration per agent, a change/threshold notion so the digest reports
what moved rather than everything, and the digest surface itself. Briefs become inputs rather than
the output. Not designed here; PR 1 is designed so as not to foreclose it.

Everything below is PR 1 unless a section says otherwise.

## 4. Host admission — the load-bearing section

Phase 27 calls this the *"load-bearing prerequisite"* and gives the reason in one sentence worth
quoting, because it is the whole argument: *"'Free FLOPs' is real on an idle workstation and a
thermal / UX disaster on a laptop on battery; this scheduler is what makes standing autonomy
honest."*

### 4.1 The capability does not exist today

**Verified 2026-09-06:** there is no power, thermal or idle probe anywhere in
`packages/gateway/src/platform/`. Nothing reads AC state, nothing reads user idle time.

**And there is an inert config key claiming otherwise.** `[embedding] pause_on_battery` is parsed in
`config/nimbus-toml.ts:233`, defaults to `true`, appears in a test fixture at
`embedding/create-embedding-runtime.test.ts:31`, and **has no consumer anywhere in the repository**.
A user who sets it gets nothing. It is not documented in `docs/`, so it is inert rather than falsely
advertised — but it is a key that lies about what it does.

**This slice fixes that as part of its own work.** Once `HostActivity` exists, wiring
`pause_on_battery` to it is a few lines, and building the exact capability a known-dead key needs
while leaving the key dead is not a defensible place to stop.

### 4.2 `HostActivity` on `PlatformServices`

A new PAL service, reached the way every other OS-specific behaviour is — never by importing
`win32` / `darwin` / `linux` from business logic.

```ts
export interface HostActivityProbe {
  power: "ac" | "battery" | "unknown";
  /** Milliseconds since last user input, or null when genuinely unmeasurable on this host. */
  idleMs: number | null;
  /** How much of this probe is real. */
  source: "measured" | "power_only";
}

export interface HostActivity {
  probe(): Promise<HostActivityProbe>;
}
```

### 4.3 Per-platform mechanisms, and the honest gap

| | AC / battery | User idle |
|---|---|---|
| Windows | `GetSystemPowerStatus` | `GetLastInputInfo` |
| macOS | IOKit / `pmset -g batt` | `ioreg -c IOHIDSystem` `HIDIdleTime` |
| Linux | `/sys/class/power_supply/AC*/online` | **no universal source** |

Linux idle is the gap and it is a real one: X11, Wayland and headless each answer differently, and a
gateway running on a server has no user session to be idle from. Platform equality
(non-negotiable #5) does not mean pretending the signal exists — it means all three platforms get
a *defined, tested* behaviour.

### 4.4 Admission, and degrading loudly

```text
admit  ⟺  ¬( require_ac_power ∧ power === "battery" )
          ∧ ( idleMs === null  ∨  idleMs ≥ min_idle_seconds × 1000 )
```

**Note the predicate blocks on `battery`, it does not require `ac`** — and that distinction is not
cosmetic. A desktop or a server has no battery to report and will answer `unknown`; a rule written
as `power === "ac"` would refuse to admit on exactly the hardware this row exists for, and the
failure would be silent (a fleet that simply never runs). `unknown` admits.

An unmeasurable idle signal **degrades to power-only admission and says so**: the run records
`host_source = "power_only"`, and any brief produced under it carries that fact. The fleet never
claims a check it did not perform. This is the deliberate alternative to refusing outright, which
would make the whole row inert on headless Linux — the platform most likely to have genuinely idle
compute.

### 4.5 Yielding

Admission is not the only decision; the fleet re-probes between jobs. When the user returns
mid-run it stops **at the next job boundary**, not mid-brief, and records the run as `yielded` with
the count of jobs not attempted. A half-written brief is worse than an absent one, and a run that
silently reports fewer jobs than it was configured for is the disclosure failure this avoids.

### 4.6 Two implementation traps, both previously paid for here

- **`bun:ffi` is synchronous and freezes the event loop.** A `Promise.race` cannot bound an FFI call.
  Prefer file reads and short-lived subprocesses; where FFI is genuinely the only route (Windows),
  the call must be one that returns in microseconds.
- **A bare `Bun.spawn` on Windows pops a console window per child.** Every probe spawn needs
  `windowsHide: true`, and the test must assert the **value** — a guard that checks for the presence
  of the token passes `windowsHide: false`.

## 5. Architecture

New subsystem `packages/gateway/src/fleet/`, laid out like `sync/`:

| File | Responsibility |
|---|---|
| `fleet-scheduler.ts` | The loop: which jobs are due, ask admission, run, re-probe, record. |
| `fleet-invoker.ts` | Dispatches one job. The only file that may name the `fleet` caller kind (D28). |
| `fleet-store.ts` | Sole writer of the V60 tables. |
| `fleet-eligible.ts` | The eligibility map and its written justification. |
| `config/fleet-toml.ts` | `[fleet]` + `[[fleet.job]]` parsing. |

### 5.1 The dispatch seam

**Verified against the code:** `agent-runs/agent-http-invoke.ts`'s `buildAgentHttpInvoker` is
already the template. It reaches agents through `dispatchAgentsRpc` and never imports an
`agents/<name>.ts` emitter — which static rule **D22(d)** forbids anyway, for both static and
dynamic import forms, so *"a new entry point cannot serve a brief without going through the
appending dispatcher."*

`buildFleetInvoker` is that function differing in exactly three places:

1. **`resolveFleetAgentMethod`** instead of `resolveExternalAgentMethod` — its own eligibility, its
   own reasoning (§ 6). It lives in `ipc/agents-rpc.ts` beside its sibling, because
   `AGENTS_RPC_HANDLERS` is deliberately **not exported** — that file's own comment says handing the
   map out *"would let another file invoke an agent directly — a bypass D22(d) cannot see."* A
   fleet-local copy of the same names is the drift shape this repo has paid for repeatedly.
2. **`notify` writes into the durable brief store** rather than `AgentRunController.observe`. The
   capture pattern is identical; only the lifetime differs.
3. **`caller: { clientId: <job id>, kind: "fleet" }`.**

### 5.2 Why `AgentRunController` is not reused

It is deliberately ephemeral — `AGENT_RUN_TTL_MS` is 10 minutes, `MAX_CONCURRENT_AGENT_RUNS` is 3,
`MAX_RETAINED_TERMINAL_AGENT_RUNS` is 16 — all tuned for an HTTP client polling `{runId}`. An
overnight run read at 09:00 wants the opposite of every one of those numbers, and changing them
reaches into the live HTTP path. The fleet owns its own durability instead.

### 5.3 Why `SyncScheduler` is not extended

It would supply timing and backoff for free. It is also load-bearing for the whole of I29's `sync`
coverage class — `isConnectorConfigured`, `recordSyncEgress`, the per-run append, the
`LOCAL_ONLY_SYNC_SERVICES` carve-out. Adding a second, differently-classified job kind means every
future reader holds two egress stories at once in the file where that must not be ambiguous. The
saving is timer code; the cost is muddying a chokepoint.

### 5.4 The `fleet` `ClientKind`

`fleet` joins the `ClientKind` union in `ipc/server/client-kind.ts` but **not** the `RECOGNISED`
set, for the reason that file already states about `http` and `chatops`: those are *derived* —
*"facts the gateway verified rather than a client's word"* — and *"adding them here would let any
local process on the socket file its briefs under that stronger attribution, turning an observation
back into a claim."* A fleet run is the gateway's own scheduler; its attribution is a fact.

Because `egress/egress-bearing-kinds.ts` is `Record<ClientKind, AgentBriefSourceType | null>` and
**TOTAL by construction**, adding the member does not compile until its egress status is decided.
That is the mechanism working as designed, and § 7 makes the decision.

## 6. Eligibility

### 6.1 A total map, not an exclusion set

`FLEET_ELIGIBILITY: Record<AgentMethod, FleetEligibility>` over the handler map's keys. A sixteenth
agent **does not compile** until someone classifies it. This is strictly better than an exclusion
`Set`, which fails **open**: a new agent silently becomes fleet-eligible. Same trick, same reason, as
`egress-bearing-kinds.ts`.

`FleetEligibility` is a reason, not a boolean — `"eligible"`, `"excluded_side_effects"`,
`"excluded_shape"`, `"deferred"` — so the map carries *why* alongside *whether*, and a classification
of "we have not decided yet" is an explicit value rather than an absence. Every agent in § 6.3 has
one, including the deferred case.

### 6.2 Why not reuse `EXTERNAL_EXCLUDED_AGENT_METHODS`

That set exists and excludes four methods, each with recorded reasoning. But it was reasoned about
for an **arbitrary network caller**, and a fleet is a different principal: owner-configured in
advance, but **not present when it fires**. Silently inheriting one threat model for the other is how
a wrong exclusion ships. The overlap is large; the justification is not transferable.

### 6.3 The classifications

| Agent | Fleet-eligible | Why |
|---|---|---|
| `preflight` | **No** | Queues HITL consent prompts on the owner's machine (I24). Unattended at 03:00 this is worse than the HTTP case it is already excluded for — a prompt nobody is there to answer. |
| `premortem` | **No** | **Not a pure read.** `runPremortem` calls `proposeWatchers`, which writes paused `watcher` rows and a `premortem_watcher_proposal` tombstone via `insertWatcherIfAbsent`; `repropose: true` deletes tombstones outright. Nightly and unattended, that accumulates state nobody asked for. |
| `whyPeek` | **No** | Synchronous: returns its payload directly and never calls `notify`. Structurally incompatible with a capture-by-notify run model. |
| `negotiate` | **Deferred to PR 2** | No side effects and the shape fits, so neither criterion above applies. But `--person` makes it a dossier builder, and *scheduled* dossier-building on indexed people is a different proposition from an owner running it once. Revisit with the sweep, where the subject-enumeration question is already on the table. |
| `catchup`, `huddle`, `glossary`, `decisions`, `ownership`, `why`, `ghost`, `conflicts`, `impact`, `expert`, `janitor` | **Yes** | Pure reads over the local index, `notify`-based, no owner-machine side effects. |

## 7. Egress

### 7.1 The brief-origination path appends nothing

`egressSourceTypeForClientKind("fleet") → null`, the same as `cli` and `ui`.

Stated in full so it cannot later read as an oversight: I29's second append path covers briefs
*"handed to whatever model the calling client uses"* — an MCP client's model, or an HTTP caller's.
A fleet brief is written to local SQLite and read by the owner on the same machine. Nothing crosses
the boundary. Unattendedness does not change that: egress is about bytes leaving, not about whether
someone is watching them not leave.

### 7.2 Remote synthesis is already covered

If `[fleet] allow_remote` is on, synthesis calls ride the existing `model` class through
`egress/model-egress.ts`'s `wrapLedgeredProvider`, which decorates at `LlmRegistry.addRoute` and
requires no cooperation from the fleet. **No new coverage class**, and none is claimed.

### 7.3 PR 2 note

A digest posted to a ChatOps channel *is* egress and is covered by the `chatops` class
(`egress/chatops-egress.ts`). Out of PR 1 scope; recorded so PR 2 does not have to rediscover it.

## 8. Invariant I38

> **I38** — an unattended fleet run reaches a NON-LOCAL model only when `[fleet] allow_remote` is
> true **and** the run's remaining call budget covers the call. Absent either, the run resolves to
> the local provider: a grant **widens** what may happen and never narrows the capability the fleet
> already had, so a fleet with no remote permission produces exactly the briefs it would otherwise
> have produced. A frontier key configured under `[llm.remote.<vendor>]` for interactive use grants
> the fleet nothing on its own — that permission is `[fleet] allow_remote`'s alone. Locality is
> DERIVED from `provider.isLocal` (I34), never from a caller-supplied flag. Budget exhaustion
> mid-run is DISCLOSED in the run record and in every affected brief, never a silent downgrade.

The shape is copied from **I37** on purpose: same *widens-never-narrows* rule, same
capability-is-not-inherited-from-a-key rule, same fail-to-local rather than fail-to-refuse.

**Static rule D28:** the `"fleet"` `ClientKind` literal is confined to `ipc/server/client-kind.ts`,
`egress/egress-bearing-kinds.ts` and `fleet/fleet-invoker.ts`, so no other file can originate a call
wearing that attribution.

### 8.1 Open implementation question — do not guess this

**The mechanism for pinning a fleet run's synthesis to local providers is NOT settled by this
document.** `buildAgentSynthesisRunner` takes a `SynthesisRouter`; whether the local pin is a
restricted router instance, a per-call task pin, or a reuse of `enforce_air_gap`'s refusal path
requires reading `llm/router.ts`, which has not been done. Settle it in the plan, against the code.

## 9. Data model — V60

`index/fleet-v60-sql.ts`, registered as
`simpleStep(59, 60, "agent fleet scheduling", FLEET_V60_SQL)` in `index/migrations/runner.ts`.
V59 (`media_grant`) is the current head, verified 2026-09-06.

- **`fleet_job_state`** — per-job scheduling state keyed by a config-derived job id: last attempt,
  last success, consecutive failures, backoff. Config remains the source of truth for job
  *definitions*; this table holds only what config cannot. Same split as
  `sync/scheduler-state-repository.ts`.
- **`fleet_run`** — one row per **attempted** run: window, admission verdict, `host_power`,
  `host_idle_ms`, `host_source`, outcome (`completed` / `yielded` / `deferred` / `failed`), jobs
  attempted vs. completed, remote calls made vs. budget.
- **`fleet_brief`** — run id, job id, agent method, markdown, findings, synthesis provenance,
  created-at.

**Prune is a plain TTL, not HITL-gated**, and the reason is stated so it does not read as a missing
defense: `egress.prune` is gated because the ledger is the audit record and deleting it destroys
evidence. Fleet briefs are *derived* data, recomputable from the index. A retention window is a
retention window.

## 10. Config, CLI, org policy

### 10.1 Config

```toml
[fleet]
enabled = false          # DEFAULT OFF
allow_remote = false     # DEFAULT OFF — a frontier key alone grants nothing
remote_call_budget = 0   # per run; MUST be > 0 when allow_remote is true, refused otherwise
min_idle_seconds = 900
require_ac_power = true
```

`[[fleet.job]]` gets its own module, `config/fleet-toml.ts`, following `config/filesystem-toml.ts`
— the existing array-of-tables precedent, and cleaner than the inline `[[security.allowlist]]`
handling in `nimbus-toml.ts`.

**Open question, to be answered against the parser and not from memory:** the TOML parser here is
hand-rolled, and whether it supports **inline tables** is unverified. If it does not, per-job params
cannot be `params = { sinceMs = ... }` and must be flat, per-agent-validated keys.

### 10.2 CLI

`nimbus fleet status | list | briefs | show <id> | run <job>`.

### 10.3 Org policy

`agent_fleet` becomes the sixth member of `AI_V2_CAPABILITIES` in `policy/types.ts`, read through
`EnforcedPolicy.capabilitiesDisabled` (I22) — never raw policy TOML.

Ordering follows I33 exactly: **config-disabled and policy-disabled are both checked before any
other work**, so a disabled capability never advertises itself by doing something. And, per the
posture multimodal PR 2 established, an **absent** policy accessor refuses fail-closed rather than
defaulting to enabled.

## 11. Testing

- **Admission truth table:** `{ac, battery, unknown} × {idle above threshold, below, null}`.
- **Eligibility totality:** a test proving the map is total over the handler map's keys, so a new
  agent forces a classification.
- **Integration on real SQLite with an injected `HostActivity`:** user-return yields at a job
  boundary and records `yielded` with an accurate unattempted count; budget exhaustion aborts the
  remote arm and discloses it; `allow_remote = false` produces **zero** non-local calls.
- **Per-platform probe tests that verify their own premise** rather than `skipIf`-ing. A
  platform-skipped test never runs on the author's machine, so CI is its first execution — and a
  skip that is silently always-true passes vacuously forever.
- **`windowsHide` asserted by value, not presence.**
- **I38 enforcement test** in `security-invariants.test.ts` and **D28** in
  `scripts/structure-audit/check-nimbus-invariants.ts`, landing in the **same commit** as the wiring
  and the `docs/SECURITY-INVARIANTS.md` row. Triple rule; no drift.

## 12. What this spec asserts vs. what it assumes

Recorded explicitly, because the difference is where specs rot.

**Verified against the code on 2026-09-06:**

- No power / thermal / idle capability exists in the PAL.
- `[embedding] pause_on_battery` parses and has no consumer.
- `dispatchAgentsRpc` is the sole agent seam; `AGENTS_RPC_HANDLERS` is unexported; D22(d) forbids
  emitter imports elsewhere.
- `buildAgentHttpInvoker` is the second consumer and the template for a third.
- `ClientKind` excludes derived kinds from `RECOGNISED`; `egress-bearing-kinds.ts` is total.
- `EXTERNAL_EXCLUDED_AGENT_METHODS` holds exactly `preflight`, `premortem`, `whyPeek`, `negotiate`,
  with the recorded reasoning quoted in § 6.3.
- `AgentRunController`'s TTL / concurrency / retention constants.
- `AI_V2_CAPABILITIES` has five members; V59 is the schema head; `simpleStep` is the registration
  form; `config/filesystem-toml.ts` is the array-of-tables precedent.

**Assumed and NOT verified — settle in the plan:**

- The mechanism for pinning synthesis to local providers (§ 8.1).
- Whether the hand-rolled TOML parser supports inline tables (§ 10.1).
- That `ioreg` / `pmset` / `GetLastInputInfo` behave as described on the CI runners, as opposed to
  on a developer machine.
