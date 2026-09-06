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
> **Reviewed 2026-09-06** — see
> [`…-design-review.md`](./2026-09-06-s2-overnight-agent-fleets-design-review.md). Nine findings
> folded in; § 12 records which of its claims were verified against the code and which remain
> expectations. The one that changed the design is § 5.1.1.
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
while leaving the key dead is not a defensible place to stop. Concretely: `platform/assemble.ts`
threads `hostActivity` into the embedding runtime deps, and the background backfill loop pauses
chunk processing while `pauseOnBattery && probe().power === "battery"`, resuming when power returns.

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
| Linux | scan `/sys/class/power_supply/*` (see below) | **no universal source** |

**The Linux power probe must scan, not glob `AC*`.** Mains adapters are named `ADP1`, `ACAD`,
`AC`, `Mains` and others depending on distribution and hardware, and laptops carry multiple battery
entries (`BAT0`, `BAT1`). A `AC*` glob silently misses `ADP1` — and the failure mode is a fleet
that reports `unknown` forever on a machine that knows perfectly well it is plugged in. The rule:

1. Any entry with `type == Battery` and `status == Discharging` → `"battery"`.
2. Else any entry with `type` in `{Mains, AC}` and `online == 1` → `"ac"`.
3. Else, no battery discharging and no directory → `"unknown"` (admits, per § 4.4).

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

### 4.6 Overdue is not the same as due — the sleep/wake case

**A timer that was due during sleep fires the moment the machine wakes**, which is the single most
likely real-world way this feature makes itself hated: the job scheduled for 03:00 runs at 08:31
while the user is typing their first email on battery.

So *overdue* never implies *run now*. `FleetScheduler` probes `HostActivity` immediately on waking
a timer and **before** starting any overdue batch; an overdue run that fails admission is recorded
`deferred` and waits for the next idle window. It does not accumulate a backlog to burn through
either — a missed daily job runs once when conditions allow, not five times because five days
were missed.

### 4.7 Three implementation traps

- **`bun:ffi` is synchronous and freezes the event loop.** A `Promise.race` cannot bound an FFI call.
  Prefer file reads and short-lived subprocesses; where FFI is genuinely the only route (Windows —
  `GetSystemPowerStatus` and `GetLastInputInfo` have no file equivalent), the call must be one that
  returns in microseconds. Both of those do.
- **A bare `Bun.spawn` on Windows pops a console window per child.** Every probe spawn needs
  `windowsHide: true`, and the test must assert the **value** — a guard that checks for the presence
  of the token passes `windowsHide: false`.
- **Windows idle time wraps every 49.7 days.** `LASTINPUTINFO.dwTime` and `GetTickCount()` are both
  32-bit unsigned millisecond counters. Naive signed arithmetic
  (`getTickCount() - dwTime`) goes negative or absurd after a wrap, which would either freeze
  admission permanently or admit falsely — on a machine with long uptime, i.e. exactly the always-on
  workstation this row targets. Compute with unsigned 32-bit semantics: `(tick - dwTime) >>> 0`.

## 5. Architecture

New subsystem `packages/gateway/src/fleet/`, laid out like `sync/`:

| File | Responsibility |
|---|---|
| `fleet-scheduler.ts` | The loop: which jobs are due, ask admission, run, re-probe, record. |
| `fleet-invoker.ts` | Dispatches one job and awaits its completion (§ 5.1.1). The only file that may name the `fleet` caller kind (D28). |
| `fleet-store.ts` | Sole writer of the V60 tables. |
| `fleet-synthesis-router.ts` | The I38 budget/locality decorator (§ 8.1). |
| `config/fleet-toml.ts` | `[fleet]` + `[[fleet.job]]` parsing. |

There is deliberately **no** `fleet/fleet-eligible.ts`: the eligibility map lives in
`ipc/agents-rpc.ts` beside `EXTERNAL_EXCLUDED_AGENT_METHODS`, for the reason given in § 6.1.

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
2. **`notify` writes into the durable brief store** rather than `AgentRunController.observe`, and —
   see § 5.1.1 — is also what tells the invoker the job is *finished*.
3. **`caller: { clientId: <job id>, kind: "fleet" }`.**

### 5.1.1 Awaiting `dispatchAgentsRpc` does NOT await the brief

**Verified 2026-09-06, and it invalidates the naive scheduler loop.**
`agents/_lib/emit-brief.ts`'s `emitBriefWithSynthesis` is fire-and-forget by design:

```ts
void (async () => { … opts.notify(opts.briefReadyMethod, …); })()
  .catch(() => opts.notify(opts.briefErrorMethod, …));
return { sessionId: opts.sessionId };
```

The brief is built and synthesised on a detached promise; the dispatch returns `{ sessionId }` in
about a millisecond. That is correct for the two existing consumers — the socket client waits for a
`briefReady` notification, and the HTTP client polls `{runId}` — but it means **`await
dispatchAgentsRpc(...)` awaits the scheduling of the work, not the work**.

A scheduler that looped over jobs awaiting that call would therefore launch every configured job
**concurrently**, which breaks three things at once: it saturates the CPU and GPU it was supposed to
use gently, it makes the between-jobs re-probe meaningless, and it makes yield-at-job-boundary
(§ 4.5) unreachable because there are no boundaries.

**So `fleet-invoker.ts` returns a promise that settles on the completion notification**, resolving
when `notify` receives `<agent>.briefReady` for the dispatch's own `sessionId`, rejecting on
`<agent>.briefError`, and settling `failed` on a per-job timeout. The scheduler then genuinely
runs one job at a time. The timeout is not optional: without it a hung synthesis wedges the fleet
until the process restarts, and the detached promise means nothing else would ever notice.

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

**Where it lives, and the wrinkle that forces it.** `AGENTS_RPC_HANDLERS` is deliberately
**not exported** — that file's comment says handing it out *"would let another file invoke an agent
directly — a bypass D22(d) cannot see."* So a `Record<AgentMethod, …>` in `fleet/` could not name
its own key type, and a test in `fleet/` could not compare the two key sets. Two consequences:

- `FLEET_ELIGIBILITY` and `resolveFleetAgentMethod` live in `ipc/agents-rpc.ts`, beside
  `EXTERNAL_EXCLUDED_AGENT_METHODS`. The eligibility *reasoning* is fleet domain; the *map* belongs
  where the handler map is, or it cannot be total.
- `agents-rpc.ts` exports a **type-only** `export type AgentMethod = keyof typeof
  AGENTS_RPC_HANDLERS`. A type export carries no runtime value, so it grants no ability to invoke
  anything and does not weaken the confinement above.

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
> the local provider — or, when no local provider is available at all, to the DETERMINISTIC render,
> exactly as `[agents] synthesis = "off"` would. (The earlier wording said only "the local
> provider", which was imprecise: `resolveForSynthesis(preferLocal)` returning a remote provider
> means no local one existed, so the honest fallback there is the deterministic render, not a local
> model that is not there.) A grant **widens** what may happen and never narrows the capability the
> fleet already had, so a fleet with no remote permission produces exactly the briefs it would
> otherwise have produced. A frontier key configured under `[llm.remote.<vendor>]` for interactive use grants
> the fleet nothing on its own — that permission is `[fleet] allow_remote`'s alone. Locality is
> DERIVED from `provider.isLocal` (I34), never from a caller-supplied flag. Budget exhaustion
> mid-run is DISCLOSED in the run record and in every affected brief, never a silent downgrade.

The shape is copied from **I37** on purpose: same *widens-never-narrows* rule, same
capability-is-not-inherited-from-a-key rule, same fail-to-local rather than fail-to-refuse.

**Static rule D28:** the `"fleet"` `ClientKind` literal is confined to `ipc/server/client-kind.ts`,
`egress/egress-bearing-kinds.ts` and `fleet/fleet-invoker.ts`, so no other file can originate a call
wearing that attribution.

### 8.1 How the local pin is enforced — RESOLVED 2026-09-06

The spec originally left this open. It is now settled against the code.

**`SynthesisRouter` is a two-method interface** (`agents/_lib/synthesis-llm.ts:40`):
`resolveForSynthesis(preferLocal?)` and `generateMarkdown(prompt, provider, egressMethod?)`. The
`ResolvedSynthesisProvider` it hands back carries `isLocal` (`llm/router.ts:56`) — the same field
I34 pins and I29's `model` appender reads.

**So the pin is a DECORATOR over that interface**, `fleet/fleet-synthesis-router.ts`, wrapping the
router before it reaches `buildAgentSynthesisRunner`. `resolveForSynthesis` returns `undefined`
rather than a remote provider when remote is not permitted or the budget is spent;
`generateMarkdown` refuses a non-local provider on the same conditions and decrements the budget
when it allows one. Locality is read from `provider.isLocal`, never recomputed.

**How `remote_call_budget` is PER RUN, given one budget instance.** `platform/assemble.ts` builds a
single `FleetRemoteBudget` at boot and shares it with the invoker, so the cap would otherwise be a
process-lifetime one: `remote_call_budget = 5` would mean five remote calls for the entire life of
the gateway, and a machine up for a week would get five in total. `FleetScheduler.execute` therefore
calls `budget.reset()` at the run boundary, before `openRun`, restoring the full cap. That is safe
without re-threading a fresh budget through the invoker because `runOnce`'s `inFlight` guard
serialises every entry path — the 60-second tick, `--force`, and a named single job all reach
`execute` only through it — so a reset can never land mid-run. `fleet_run.remote_call_budget` is
then recorded off the freshly reset budget's `remaining()`, not the raw config number: the two
differ whenever `allow_remote = false`, where the cap is clamped to 0 while the parser still accepts
a non-zero `remote_call_budget` beside it.

**Two rejected alternatives, so they are not revisited:**

- **`LlmRouter.setTaskPin`** mutates a router-wide map. A background fleet run and a concurrent
  interactive `nimbus ask` share that router, so a pin set for the fleet would silently re-route the
  user's own question — and un-setting it races.
- **`enforce_air_gap`** is a gateway-wide refusal. It would disable remote for everything, not for
  the fleet.

The decorator shape is also the one this codebase already uses for exactly this class of problem —
`wrapLedgeredProvider` (I29), `wrapServerSpec` (I15), `wrapLedgeredVlm` (D22(g)) — so it covers
every caller including ones written later, without their cooperation.

## 9. Data model — V60

`index/fleet-v60-sql.ts`, registered as
`simpleStep(59, 60, "agent fleet scheduling", FLEET_V60_SQL)` in `index/migrations/runner.ts`.
V59 (`media_grant`) is the current head, verified 2026-09-06.

- **`fleet_job_state`** — per-job scheduling state keyed by a config-derived job id: last attempt,
  last success, consecutive failures, backoff, last error. Config remains the source of truth for job
  *definitions*; this table holds only what config cannot. Same split as
  `sync/scheduler-state-repository.ts`.

  **A failing job is isolated, not fatal to the run.** One job's bad `resourceRef`, missing path or
  synthesis timeout records against *that* job — incrementing `consecutive_failures` and setting an
  exponential `backoff_until` (1h → 2h → 4h, capped at 24h) — and the scheduler proceeds to the next
  job. A run that aborts wholesale on the first bad entry would let one stale config line silence
  every other brief indefinitely, and overnight nobody is there to notice.
- **`fleet_run`** — one row per **attempted** run: window, admission verdict, `host_power`,
  `host_idle_ms`, `host_source`, outcome (`completed` / `yielded` / `deferred` / `failed`), jobs
  attempted vs. completed, remote calls made vs. budget.
- **`fleet_brief`** — run id, job id, agent method, markdown, findings, synthesis provenance,
  created-at.

`fleet_brief.run_id` is `REFERENCES fleet_run(id) ON DELETE CASCADE`. That cascade is **live, not
decorative**: `index/local-index.ts:279` runs `PRAGMA foreign_keys = ON`, and `cu_action` →
`cu_session` (V57) is the same parent/child shape. Verified 2026-09-06 — worth verifying because
SQLite defaults foreign keys **off**, and a cascade written against a database that never enabled
them is a silent no-op that leaves orphans forever.

**Prune is a plain TTL, not HITL-gated**, and the reason is stated so it does not read as a missing
defense: `egress.prune` is gated because the ledger is the audit record and deleting it destroys
evidence. Fleet briefs are *derived* data, recomputable from the index. A retention window is a
retention window.

**But local retention does not get to be shorter than org policy allows.** `policy/types.ts:26`
carries `retention: { minDays: number }`, resolved through the I22 signed-policy gate. Effective
retention is therefore `max(config.retention_days, enforcedPolicy.retention.minDays)` — a floor, not
an override, so an org that requires 30 days of evidence cannot have it deleted by a local
`retention_days = 7`. Pruning runs at gateway startup and after each completed run.

## 10. Config, CLI, org policy

### 10.1 Config

```toml
[fleet]
enabled = false          # DEFAULT OFF
allow_remote = false     # DEFAULT OFF — a frontier key alone grants nothing
remote_call_budget = 0   # per run; MUST be > 0 when allow_remote is true, refused otherwise
min_idle_seconds = 900
require_ac_power = true
retention_days = 14
```

`[[fleet.job]]` gets its own module, `config/fleet-toml.ts`, following `config/filesystem-toml.ts`
— the existing array-of-tables precedent, and cleaner than the inline `[[security.allowlist]]`
handling in `nimbus-toml.ts`.

**Inline tables are NOT available — RESOLVED 2026-09-06.** `config/toml-primitives.ts` exports
exactly `stripComment`, `hasUnterminatedString`, `parseString`, `parseIntDec`, `isTableHeader`,
`splitKeyValue` and `parseStringArray`. It is a line-scanner: there is no inline-table parser and no
multi-line nested value support. So per-job params are **flat, per-agent-validated keys**, mapped to
each agent's RPC parameter shape in the invoker:

```toml
[[fleet.job]]
name = "morning_catchup"
agent = "catchup"
interval_seconds = 86400
since_ms = 86400000
service = "github"
```

### 10.2 CLI

- `nimbus fleet status [--json]` — scheduler state, the current power/idle probe, last run, next
  due job, remaining remote budget.
- `nimbus fleet list [--json]` — configured jobs with interval, last run, health.
- `nimbus fleet briefs [--limit N] [--agent <name>] [--json]` — recent briefs.
- `nimbus fleet show <brief-id>` — the brief markdown on stdout.
- `nimbus fleet run <job> [--force]` — manual trigger.

**`--force` bypasses host admission ONLY** — the idle and power checks of § 4.4, which exist to
protect the user's machine and which the user is by definition present to override. It does **not**
bypass `[fleet] enabled`, the `agent_fleet` policy lockoff, eligibility (§ 6), or I38's remote
permission and budget. Saying so here because "force" is the kind of flag that grows into "skip the
checks" if nobody wrote down which checks.

### 10.3 Org policy

`agent_fleet` becomes the sixth member of `AI_V2_CAPABILITIES` in `policy/types.ts`, read through
`EnforcedPolicy.capabilitiesDisabled` (I22) — never raw policy TOML.

Ordering follows I33 exactly: **config-disabled and policy-disabled are both checked before any
other work**, so a disabled capability never advertises itself by doing something. And, per the
posture multimodal PR 2 established, an **absent** policy accessor refuses fail-closed rather than
defaulting to enabled.

## 11. Testing

- **Admission truth table**, against an injected `HostActivity`:

  | power | idle | config | verdict |
  |---|---|---|---|
  | `battery` | 1200 s | `require_ac_power = true` | refused, `deferred` |
  | `battery` | 1200 s | `require_ac_power = false` | admitted |
  | `ac` | 300 s | `min_idle_seconds = 900` | refused, `deferred` |
  | `ac` | 1200 s | `min_idle_seconds = 900` | admitted |
  | `unknown` | `null` | default | admitted, `source: power_only` |

- **Eligibility totality:** the map is total over `AgentMethod`, so a new agent forces a
  classification. Note this must be enforced **inside `ipc/agents-rpc.ts`** (or through the
  type-only `AgentMethod` export of § 6.1) — a test in `fleet/` cannot compare against
  `AGENTS_RPC_HANDLERS`, which is not exported. Compile-time totality is the real gate; the unit
  test asserts the classifications, not the key set.
- **Sequencing:** two configured jobs run strictly one at a time — the second does not start before
  the first's `briefReady` (§ 5.1.1). Red-prove this by reverting to a bare `await
  dispatchAgentsRpc`, which must make it fail.
- **Per-job timeout:** a synthesis that never settles fails that job and the run continues.
- **Failure isolation:** a job that throws records backoff and does not abort the run.
- **Overdue-on-wake:** a job overdue by days, with the probe reporting `battery`, is `deferred`
  and does not run — and does not then run once per missed interval.
- **Integration on real SQLite with an injected `HostActivity`:** user-return yields at a job
  boundary and records `yielded` with an accurate unattempted count; `allow_remote = false`
  produces **zero** `model`-class ledger rows; `allow_remote = true, remote_call_budget = 1`
  permits exactly one, and the second job's synthesis falls back with the exhaustion disclosed in
  its provenance.
- **Retention floor:** `retention_days = 7` under a policy `retention.minDays = 30` prunes at 30.
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

**Added by the 2026-09-06 review pass, verified then:**

- `emitBriefWithSynthesis` is fire-and-forget; `dispatchAgentsRpc` returns before the brief exists
  (§ 5.1.1). This one changed the design.
- `SynthesisRouter` is a two-method interface and `ResolvedSynthesisProvider` carries `isLocal`,
  making the § 8.1 decorator viable — and `LlmRouter.setTaskPin` is router-wide, making the pin
  alternative unsafe.
- `config/toml-primitives.ts` has no inline-table parser (§ 10.1).
- `policy/types.ts:26` carries `retention: { minDays: number }` (§ 9).
- `PRAGMA foreign_keys = ON` is set at `index/local-index.ts:279`, so the § 9 cascade is live.

**Assumed and NOT verified — settle during implementation:**

- **Probe behaviour on the CI runners specifically.** The expectation is that Windows runners report
  `ACLineStatus` 1 or 255; that headless macOS runners may expose no usable `HIDIdleTime`; and that
  Linux runners have no `/sys/class/power_supply` at all — so all three land on
  `source: "power_only"` and admit. That is an expectation, not a measurement: none of it has been
  run. The probe tests must **verify their own premise** rather than skip, since a platform-skipped
  test never executes on the author's machine and CI is its first run.
- Exact V60 DDL. The shapes and the cascade are settled; column-level detail belongs to the plan.
