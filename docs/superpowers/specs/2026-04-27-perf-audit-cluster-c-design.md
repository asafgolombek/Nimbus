# Perf Audit (B2) — Cluster C Workload Drivers Design

**Status:** Design

**Parent spec:** [`2026-04-26-perf-audit-design.md`](./2026-04-26-perf-audit-design.md) — defines the surface table, threshold semantics, reference-hardware protocol, and PR sequence (PR-A → PR-B-1 → PR-B-2a → **PR-B-2b** → PR-C → PR-D-N). Read it first; this doc only fills in the architectural decisions for the cluster-C drivers.

**Predecessor plan:** [`2026-04-26-perf-audit-phase-1b.md`](../plans/2026-04-26-perf-audit-phase-1b.md) (PR-B-2a, merged in PR #116) — landed the 7 cluster-A/B drivers (S1, S2-b, S2-c, S4, S11-a, S11-b) plus 2 stubs (S3, S5) and the published UX SLO sheet `docs/perf/slo-ux.md`.

---

## 1. Goal

Land the 7 cluster-C *workload* surface classes (S6 sync throughput, S7-a/b/c memory RSS, S8 embedding throughput, S9 LLM round-trip, S10 SQLite write contention) plus their fixtures, helpers, and registry entries — closing **Phase 1** of the perf audit. Workload-threshold values stay TBD until PR-C measures on reference hardware (per parent spec § 2 Phase 2).

After this work merges, every surface row in parent spec § 3.2 has a registered driver. PR-C can then run on reference hardware, populate `slo.md`, and wire up `_perf.yml` without further driver work.

---

## 2. Context — what's already in place

Frozen as of PR-B-2a:

- `BenchHarness` API: `runBench`, `BenchSurfaceResult`, `appendHistoryLine`, `HistoryLineSurface` (carrying `throughput_per_sec`, `rss_bytes_p95`, `tokens_per_sec`, `first_token_ms`, `stub_reason`). One additive field — `busy_retries?: number` — is added in PR-B-2b-2 for S10 (see § 6.5).
- Cross-process timing helper `process-spawn-bench.ts` (used by S1, S4, S11-a/b).
- Synthetic-corpus fixture generator `buildSyntheticIndex` (small / medium / large tiers).
- 9 registered surface IDs: S1, S2-a, S2-b, S2-c, S3 (stub), S4, S5 (stub), S11-a, S11-b.
- Gating sets in `bench-cli.ts`: `REFERENCE_ONLY` (currently `{S2-c}`) and `STUB_SURFACES` (currently `{S3, S5}`).
- `docs/perf/slo-ux.md` published; UX-only; PR-C will rename it to `slo.md` and add the workload rows.

---

## 3. PR boundary

PR-B-2b ships as **two sub-PRs** along the infrastructure seam:

| Sub-PR | Surfaces | New infra | DevDeps added |
|---|---|---|---|
| **PR-B-2b-1** | S6-drive, S6-gmail, S6-github, S7-a, S7-b, S7-c | `gateway-spawn-bench.ts`, `rss-sampler.ts`, `fixtures/` (synthetic Drive/Gmail/GitHub traces, MSW handlers) | `pidusage`, `msw` |
| **PR-B-2b-2** | S8 (12 cells), S9 (stub), S10 | `worker-bench.ts`, `fixtures/synthetic-text.ts`, 3 `sqlite-worker-*.ts` Worker scripts | (none) |

The two sub-PRs can merge in either order; PR-C blocks on both. A future **PR-B-2b-3** lands the real Ollama-driven S9 driver and the real Tauri-renderer instrumentation that turns S3 / S5 from stubs into measurements. That PR is *not* in this design's scope; it's noted in § 9.

---

## 4. Surface registry expansion

Twenty new surface IDs (registry total: 9 → 29):

| Class | Surface IDs | Count |
|---|---|---|
| S6 sync throughput | `S6-drive`, `S6-gmail`, `S6-github` | 3 |
| S7 memory RSS | `S7-a`, `S7-b`, `S7-c` | 3 |
| S8 embedding throughput | `S8-l50-b1`, `S8-l50-b8`, `S8-l50-b32`, `S8-l50-b64`, `S8-l500-b1`, …, `S8-l5000-b64` | 12 |
| S9 LLM round-trip (stub) | `S9` | 1 |
| S10 SQLite contention | `S10` | 1 |

**Why split S6 and S8 into multiple IDs:** parent spec § 3.2 defines one threshold per row in `slo.md`. Per-connector and per-(length, batch) thresholds are meaningfully different metrics — collapsing them into a single matrix-shaped value would force PR-C to invent a new "matrix-aware" comparator. Splitting them honours the existing thresholding machinery and the bidirectional driver↔row mapping (parent spec § 6 criterion 7) literally.

S8 ships as **one driver file** (`bench-embedding-throughput.ts`) exporting a parameterised core (`runEmbeddingThroughputOnce({ length, batch })`) plus 12 thin wrapper functions, one per cell — matches PR-B-2a's `bench-query-latency-100k.ts` / `-1m.ts` precedent.

---

## 5. New helpers

### 5.1 `gateway-spawn-bench.ts`

Spawns a real gateway, waits for a stdout marker, runs a workload (with optional concurrent sampler), tears down. Distinct from `process-spawn-bench.ts` — that times spawn-to-marker; this one drives bench work *during* the warm phase.

```typescript
export interface SpawnGatewayForBenchOptions<W, S = void> {
  cmd: string;
  args: string[];
  readyMarker: RegExp;
  readyTimeoutMs?: number;              // default 30_000
  workload: (ctx: { pid: number; signal: AbortSignal }) => Promise<W>;
  sampler?: (ctx: { pid: number; signal: AbortSignal }) => Promise<S>;
  env?: Record<string, string>;
  spawn?: typeof Bun.spawn;             // injectable for tests
}
export interface SpawnGatewayResult<W, S> {
  workloadResult: W;
  samplerResult: S | undefined;
  totalMs: number;                      // wall-clock from ready to workload done
}
export async function spawnGatewayForBench<W, S = void>(
  opts: SpawnGatewayForBenchOptions<W, S>,
): Promise<SpawnGatewayResult<W, S>>;
```

Cleanup contract: SIGTERM the child after workload resolves *or* throws; await `proc.exited`; same `finally` shape as `process-spawn-bench`'s `runMarkerMode`.

### 5.2 `rss-sampler.ts`

Polls `pidusage(pid)` at a configurable cadence; returns RSS sample array + p95.

```typescript
export interface SampleRssOptions {
  pid: number;
  durationMs: number;                   // 60_000 in prod; tests pass ~200
  intervalMs?: number;                  // default 1000
  signal?: AbortSignal;
  pidusage?: (pid: number) => Promise<{ memory: number }>;  // injectable
}
export interface SampleRssResult {
  samples: number[];                    // RSS bytes per poll
  p95: number;
  intervalsMissed: number;              // count of polls that errored
}
export async function sampleRss(opts: SampleRssOptions): Promise<SampleRssResult>;
```

`p95` reuses the existing `BenchHarness` percentile helper. `intervalsMissed > durationMs / intervalMs / 2` is the caller's signal to record `stub_reason: "driver-failed: gateway died during sampling"`; the helper itself does not throw.

**Per-surface sampling resolution** — drivers tune `intervalMs` to workload variability:

| Surface | `intervalMs` | Rationale |
|---|---|---|
| S7-a (idle) | 1000 | Low memory variance; 60 polls is sufficient for stable p95 |
| S7-b (heavy sync) | 250 | Sync bursts can spike RSS between coarser samples; 240 polls catches peaks |
| S7-c (multi-agent) | 250 | Sub-agent decomposition produces transient allocation peaks |

Tighter sampling on S7-b/c trades CPU (negligible — `pidusage` reads `/proc` or `task_info`) for better tail-latency fidelity in the metric PR-C will threshold.

### 5.3 `worker-bench.ts`

Bun-Worker coordinator for S10. Spawns N Workers, each with its own SQLite connection, drives them for `durationMs`, aggregates writes/sec.

```typescript
export interface WorkerSpec {
  name: string;                         // "sync" | "watcher" | "audit"
  url: URL;
  config: Record<string, unknown>;
}
export interface WorkerBenchOptions {
  workers: WorkerSpec[];
  durationMs: number;
  sharedDbPath: string;
  WorkerCtor?: new (url: URL, opts: WorkerOptions) => Worker;
  timeoutMs?: number;                   // default durationMs + 5_000
}
export interface WorkerBenchResult {
  perWorker: { name: string; writes: number; throughputPerSec: number }[];
  totalThroughputPerSec: number;
  errors: { name: string; message: string }[];
}
export async function runWorkerBench(opts: WorkerBenchOptions): Promise<WorkerBenchResult>;
```

**Worker protocol** (JSON-serialisable, schema-validated):
- Parent → Worker: `{ kind: "init", config, dbPath }` → `{ kind: "start", durationMs }` → `{ kind: "stop" }`.
- Worker → Parent: `{ kind: "ready" }` → `{ kind: "done", writes, busyRetries }` *or* `{ kind: "error", message, stack? }`.

`busyRetries` counts every `BEGIN IMMEDIATE` retry triggered by `SQLITE_BUSY` — a richer signal than throughput alone (mild contention with retries vs. high throughput at no cost). The coordinator sums `busyRetries` across Workers and surfaces it on `WorkerBenchResult` (see below).

`stack` (optional) carries the Worker's error stack when one is available — `Database is locked` / `SQLITE_FULL` failures are otherwise hard to attribute to a specific query under load.

A Worker that fails to ack `stop` within 2 s of receiving it is `terminate()`d; its `errors[]` entry is recorded but the run still reports a `totalThroughputPerSec` from the surviving Workers.

`WorkerBenchResult` extended:

```typescript
export interface WorkerBenchResult {
  perWorker: { name: string; writes: number; throughputPerSec: number; busyRetries: number }[];
  totalThroughputPerSec: number;
  totalBusyRetries: number;
  errors: { name: string; message: string; stack?: string }[];
}
```

---

## 6. Per-surface wiring

### 6.1 S6 — sync throughput (3 surfaces)

> **Teardown safety note** — every gateway-spawn sets a fresh `NIMBUS_HOME`. The IPC socket path is derived from `NIMBUS_HOME` (per-process unique tmpdir), so socket collision between consecutive runs is structurally impossible regardless of how slowly the previous gateway shuts down. The `finally` block in `gateway-spawn-bench` still awaits `proc.exited` after SIGTERM for clean PID accounting.

```
bench-sync-throughput-{drive,gmail,github}.ts (per run, 5 runs):
  1. mkdtempSync → fresh NIMBUS_HOME
  2. setupServer({connector}Handlers(traceTier="small"))   // MSW v2
  3. spawnGatewayForBench({
       readyMarker: /\[gateway\] ready/,
       env: { NIMBUS_BENCH_TRACE: "<tier>" },
       workload: async (ctx) => {
         const countSql = "SELECT COUNT(*) AS c FROM item WHERE service = ?";
         const before = (await ipc("index.querySql", { sql: countSql, params: [service] }))[0].c;
         const t0 = performance.now();
         await ipc("connector.sync", { service, full: true });
         const elapsed = performance.now() - t0;
         const after  = (await ipc("index.querySql", { sql: countSql, params: [service] }))[0].c;
         return { items: after - before, ms: elapsed };
       },
     })
  4. throughput = items / (ms / 1000)
samples[] = [run1_throughput, run2_throughput, …]
→ throughput_per_sec = median(samples)
```

The throughput metric is *items landed in the local index* (delta from `SELECT COUNT(*)`), not items the connector emitted — more honest, no IPC-contract change. Both IPC methods are pre-existing:
- `connector.sync` — `packages/gateway/src/ipc/connector-rpc-handlers.ts:474`; returns `{ ok: true }` after `syncScheduler.forceSync(id)` resolves.
- `index.querySql` — `packages/gateway/src/ipc/diagnostics-rpc.ts:450`; bench uses the same `SELECT COUNT(*) FROM item WHERE service = ?` shape that `data-rpc.ts:212` already executes.

### 6.2 S7-a / S7-b / S7-c — memory RSS

```
S7-a (idle):
  spawnGatewayForBench({
    workload: ({ signal }) => sleep(60_000, { signal }),
    sampler:  ({ pid, signal }) => sampleRss({ pid, durationMs: 60_000, signal }),
  })
  samples[] = sampler.samples
  → rss_bytes_p95 = sampler.p95

S7-b (heavy sync):
  same shape, workload fires parallel triggerSync("drive"|"gmail"|"github")
  sampler still reads RSS over the sync window

S7-c (multi-agent, REFERENCE_ONLY):
  workload triggers a 3-sub-agent decomposition via agent.ask
  on --gha runs, skipped + recorded as
    { stub_reason: "reference-only; requires loaded LLM + GPU" }
```

Per-run wall-clock ≈ 65 s (60 s sample + ~3 s spawn + ~2 s teardown). 5 runs × 65 s ≈ 5.5 min. CI-acceptable for a nightly perf job; unit tests pass `durationMs: 200`.

### 6.3 S8 — embedding throughput (12 surfaces)

```
bench-embedding-throughput.ts:
  function runEmbeddingThroughputOnce({ length, batch }):
    texts = synthesizeText({ length, count: batch * 1000 })
    const provider = new MiniLMProvider(...)
    // Warm-up: one throwaway embed so model load + ONNX cache prime
    // are excluded from the timed window. Ignore the result.
    await provider.embed(texts.slice(0, 1))
    const t0 = performance.now()
    for (let i = 0; i < texts.length; i += batch)
      await provider.embed(texts.slice(i, i + batch))
    const elapsed = performance.now() - t0
    return texts.length / (elapsed / 1000)   // items/sec
```

**Registry generation in `bench-cli.ts`** — cross-product loop over `LENGTHS × BATCHES` rather than 12 named exports:

```typescript
const S8_LENGTHS = [50, 500, 5000] as const;
const S8_BATCHES = [1, 8, 32, 64] as const;
for (const length of S8_LENGTHS) {
  for (const batch of S8_BATCHES) {
    SURFACE_REGISTRY[`S8-l${length}-b${batch}`] = () =>
      runEmbeddingThroughputOnce({ length, batch });
  }
}
```

This guarantees naming consistency (one `S8-l{len}-b{batch}` template), keeps the driver file small (one parameterised function instead of 12 wrappers), and makes adding a new tier (e.g., length=10000) a single literal change.

In-process; no gateway spawn; uses the existing `MiniLMProvider` from `packages/gateway/src/embedding/`. Each cell is its own surface ID with its own threshold in `slo.md` (set by PR-C).

### 6.4 S9 — LLM round-trip (stub)

Same shape as S3 / S5 in PR-B-2a: returns `[]` samples; `STUB_SURFACES["S9"] = "reference-only; full Ollama harness in PR-B-2b-3 follow-up"`. Bidirectional driver↔row mapping holds.

### 6.5 S10 — SQLite contention (1 surface)

```
bench-sqlite-contention.ts (per run, 5 runs):
  1. mkdtempSync → fresh DB; migrateAll()
  2. runWorkerBench({
       workers: [
         { name: "sync",    url: …/sqlite-worker-sync.ts,    config: { batchSize: 100 } },
         { name: "watcher", url: …/sqlite-worker-watcher.ts, config: {} },
         { name: "audit",   url: …/sqlite-worker-audit.ts,   config: {} },
       ],
       durationMs: 5_000,
     })
  3. samples.push(result.totalThroughputPerSec)
→ throughput_per_sec = median(samples)
```

Each Worker opens its own `bun:sqlite` handle → real OS-level file-lock contention. **All three Worker scripts go through the production `db/write.ts` wrapper** — never raw `db.exec()`. This guarantees that the production `SQLITE_FULL` → `DiskFullError` semantics are exercised under contention, and that the actual `appendAudit()` BLAKE3 chain hash, watcher-event insert path, and sync bulk-insert path are what we're measuring. `BEGIN IMMEDIATE` + 100 ms retry budget on `SQLITE_BUSY`; retries are the metric we want, not errors. Per-Worker `busyRetries` is reported alongside `writes`; the surface-line carries `busy_retries` (sum across Workers) — see § 6.6.

### 6.6 Schema additivity — `busy_retries`

PR-B-2b-2 adds one optional field to `HistoryLineSurface`:

```typescript
export interface HistoryLineSurface {
  // … existing fields …
  /** S10 only — sum of SQLITE_BUSY retries across the 3 contention Workers. */
  busy_retries?: number;
}
```

Same additivity contract as `stub_reason` in PR-B-2a: optional, omitted when not applicable, downstream consumers ignore unknown fields. PR-C's threshold logic for S10 then has two signals to choose from (raw throughput, retry rate per write) — choice deferred to PR-C.

### 6.7 Data flow into history.jsonl

| Surface | Metric field |
|---|---|
| `S6-*` | `throughput_per_sec` |
| `S7-*` | `rss_bytes_p95`, `samples_count`, `raw_samples` (RSS bytes) |
| `S8-*` | `throughput_per_sec` |
| `S9` | `stub_reason` (no samples) |
| `S10` | `throughput_per_sec`, `busy_retries` |

---

## 7. Gating

Three sets in `bench-cli.ts`:

| Set | Members after this PR | Behaviour |
|---|---|---|
| `REFERENCE_ONLY` | `{ S2-c, S7-c, S9 }` | Skipped on `--gha`, recorded as `incomplete: true` for that surface |
| `LINUX_ONLY_THRESHOLDS` *(new)* | `{ S7-a, S7-b, S7-c }` | Drivers run on all OSes; PR-C's threshold comparator consults this set to skip gating on macOS/Windows. **No schema change** — set is code-data PR-C imports |
| `STUB_SURFACES` | `{ S3, S5, S9 }` | Returns `[]` samples; carries fixed `stub_reason` |

---

## 8. Error handling

- **Driver throws inside a run** → `runBench` catches → `stub_reason: "driver-failed: <message>"` for that surface. Other surfaces unaffected (per PR-B-2a Note 4 semantics).
- **Driver throws before run 1** (setup failure) → same as above; zero samples.
- **Gateway ready-marker timeout** (30 s default) → driver records `stub_reason: "driver-failed: gateway not ready in 30s"`.
- **Child crashes pre-marker** → `spawnGatewayForBench` throws (mirrors `process-spawn-bench.runMarkerMode`).
- **Workload throws** → `finally` block SIGTERMs child + awaits exit; original error rethrown.
- **RSS sampling: child exits during sample** → `pidusage` errors → `intervalsMissed++`. Caller checks `intervalsMissed > 50 %` of polls and records `stub_reason: "driver-failed: gateway died during sampling"`.
- **Worker hangs past `durationMs + 2 s`** → `terminate()`d; `errors[]` populated; surviving Workers' contribution still reported.
- **All Workers fail before `ready`** → coordinator throws → driver `stub_reason`.
- **MSW unmatched URL** → 404 → connector treats as failure → counted as 0 items for that page → throughput drops accordingly. Tests assert handler completeness.

---

## 9. Acceptance criteria (per sub-PR)

### PR-B-2b-1

- [ ] `pidusage` and `msw` added to `packages/gateway/package.json` devDependencies.
- [ ] `gateway-spawn-bench.ts` + tests; coverage ≥80 % (perf gate).
- [ ] `rss-sampler.ts` + tests with injectable `pidusage` fake; per-surface `intervalMs` (S7-a = 1000, S7-b/c = 250) verified.
- [ ] `fixtures/` directory with synthetic Drive/Gmail/GitHub trace generators + MSW handler composer + per-connector tests asserting URL-shape coverage of the real connector. **Each connector test runs MSW with `onUnhandledRequest: "error"` (sentinel)**.
- [ ] § 13 verification matrix: each connector's HTTP layer confirmed `fetch`-compatible during plan phase; any connector that fails → custom interceptor or stub.
- [ ] 6 driver files (`bench-sync-throughput-{drive,gmail,github}.ts`, `bench-rss-{idle,heavy-sync,multi-agent}.ts`) + tests.
- [ ] `bench-cli.ts` registers 6 new surface IDs in `SURFACE_REGISTRY`; extends `REFERENCE_ONLY` with `S7-c`; introduces `LINUX_ONLY_THRESHOLDS = { S7-a, S7-b, S7-c }`.
- [ ] `bench-runner.ts` help text updated.
- [ ] `nimbus bench --all --runs 1 --corpus small --gha` writes one valid history line including the 6 new surfaces (S7-c carries `stub_reason`).
- [ ] Three-OS CI matrix passes.
- [ ] Bidirectional driver↔row mapping holds for the 6 new IDs (parent spec § 6 criterion 7).

### PR-B-2b-2

- [ ] `worker-bench.ts` + tests with injectable `WorkerCtor`; coverage ≥80 % (perf gate). `errors[].stack` populated when Worker errors carry one.
- [ ] `fixtures/synthetic-text.ts` + tests (deterministic; tier-scaling).
- [ ] 4 driver files (`bench-embedding-throughput.ts` with parameterised core + cross-product registration in `bench-cli.ts`, `bench-llm-roundtrip.ts` stub, `bench-sqlite-contention.ts`) + tests.
- [ ] **S8 driver performs one throwaway `embed()` before the timer starts** (model-load not in metric); test asserts the warm-up call.
- [ ] 3 SQLite Worker scripts (`sqlite-worker-{sync,watcher,audit}.ts`) + tests; **all three Workers route writes through `db/write.ts`** (real `DiskFullError` semantics under contention) — verified by reading the Worker source.
- [ ] `bench-cli.ts` registers 14 new surface IDs (12 S8 cells via cross-product loop over `LENGTHS × BATCHES` + S9 + S10); extends `REFERENCE_ONLY` with `S9`; extends `STUB_SURFACES` with `S9`.
- [ ] `HistoryLineSurface` adds optional `busy_retries?: number`; S10 surface line populates it; PR-B-2a consumers (none yet) ignore the unknown field cleanly.
- [ ] Bidirectional driver↔row mapping holds for the 14 new IDs.
- [ ] Three-OS CI matrix passes.

### Joint (verified after both sub-PRs merge)

- [ ] Registry has all 16 parent-spec § 3.2 surface classes covered (counting expansions: S6 → 3, S8 → 12, others 1:1).
- [ ] `test:coverage:perf` ≥80 % lines.
- [ ] PR-C can compute thresholds for every measurable surface from a single reference-hardware run without further driver work.

---

## 10. Out of scope (future work)

- **PR-B-2b-3** (separate, not part of this design): real Ollama-driven S9 driver replacing the stub; real Tauri-renderer perf-mark instrumentation replacing the S3 / S5 stubs. Lands the same way PR-B-2b-1/2 do — small, targeted, incremental.
- **PR-C** (Phase 2): measurement on reference hardware; populated `slo.md` / `baseline.md` / `missed.md`; `_perf.yml` CI workflow; migration of existing `benchmark.yml` + `scripts/capture-benchmarks.ts`; docs-site integration decision.
- **PR-D-1 … PR-D-N** (Phase 3): top-5 fix plans.
- **Schema bumps** to `HistoryLineSurface`: not needed — every metric in this PR (throughput, RSS p95, stub reason) fits the PR-B-2a schema.

---

## 11. Non-negotiables verification

- No `any` types — TypeScript strict already enforced.
- No `0.0.0.0` defaults — bench code does not touch IPC network bind.
- No new vault / IPC surface — only existing `connector.sync` and `query` methods are called.
- No new HITL action types — bench drives only read paths and the existing connector-sync IPC method.
- All security invariants (I1–I12) untouched — perf code lives outside connector mesh, vault, IPC server, and updater modules.
- AGPL-3.0 — `pidusage` is MIT, `msw` is MIT; both compatible.

---

## 12. Sources

- Parent spec: [`docs/superpowers/specs/2026-04-26-perf-audit-design.md`](./2026-04-26-perf-audit-design.md)
- Predecessor plan: [`docs/superpowers/plans/2026-04-26-perf-audit-phase-1b.md`](../plans/2026-04-26-perf-audit-phase-1b.md)
- PR-B-2a (merged): [PR #116](https://github.com/asafgolombek/Nimbus/pull/116)
- `pidusage` package: <https://www.npmjs.com/package/pidusage>
- MSW v2 docs: <https://mswjs.io/>

---

## 13. MSW interceptor coverage — verification matrix

The parent spec verified at the time it was written that none of the Drive / Gmail / GitHub MCP connectors used `node:http`, `axios`, or `got` directly. MSW v2 intercepts `fetch` (and Node's `http`/`https` modules transparently), but it does **not** intercept HTTP requests issued by a service-specific SDK that uses an internal binary protocol or a custom transport.

The plan phase confirms each connector's HTTP layer at file-read time. If verification fails for a connector, that connector either gets a custom MSW interceptor or ships as a stub (with the rest of the cluster shipping normally).

| Connector | Expected HTTP layer | Fallback if not fetch-only |
|---|---|---|
| Drive (`packages/mcp-connectors/google-drive`) | Direct `fetch` against `https://www.googleapis.com/drive/v3/*` | Stub `S6-drive`, defer to PR-B-2b-3 |
| Gmail (`packages/mcp-connectors/gmail`) | Direct `fetch` against `https://gmail.googleapis.com/*` | Stub `S6-gmail`, defer to PR-B-2b-3 |
| GitHub (`packages/mcp-connectors/github`) | Octokit (transitively `fetch`) — **verify Octokit's request layer hits MSW** | Custom interceptor or stub `S6-github` |

**Sentinel assertion** (added in every `bench-sync-throughput-{connector}.test.ts`): MSW's `setupServer` is initialised with `onUnhandledRequest: "error"`. Any URL the connector hits that is not covered by handlers fails the test with a diagnostic identifying the URL — making this a regression test against future connector changes.
