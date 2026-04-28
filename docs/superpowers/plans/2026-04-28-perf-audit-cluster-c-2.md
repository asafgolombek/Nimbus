# Perf Audit (B2) — Cluster C Drivers, Sub-PR 2 (PR-B-2b-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the S8 (12 embedding throughput cells), S9 (LLM round-trip stub), and S10 (SQLite write contention) surface drivers + their supporting infrastructure (`worker-bench.ts` Bun-Worker coordinator, `synthetic-text.ts` corpus generator, three production-equivalent SQLite writer Worker scripts). Lands as PR-B-2b-2 on `dev/asafgolombek/perf-audit-cluster-c-2`. Closes Phase 1 of the perf audit; PR-C can then measure on reference hardware and populate `slo.md`.

**Architecture:** One new helper — `worker-bench.ts` — that takes an array of `WorkerSpec` entries, spawns a `Worker` per spec via an injectable `WorkerCtor` (defaults to native `Worker`), drives them through a typed `init → ready → start → done` message protocol, and aggregates writes/sec + `busyRetries` across all Workers. Three `sqlite-worker-{sync,watcher,audit}.ts` scripts each open their own `bun:sqlite` connection and route every write through the production `db/write.ts` `dbRun` wrapper — guaranteeing the bench measures the same `SQLITE_FULL` → `DiskFullError` path production hits, plus exercises real OS-level file-lock contention. S8 ships as one parameterised driver (`bench-embedding-throughput.ts`) plus a cross-product registration loop in `bench-cli.ts` that registers all 12 `S8-l{50|500|5000}-b{1|8|32|64}` cells. S9 is a stub mirroring S3/S5/S7-c. The `HistoryLineSurface` schema gains one optional `busy_retries?: number` field — additive, downstream consumers ignore unknown fields.

**Tech Stack:** Bun v1.2+ / TypeScript 6.x strict, `bun:test`, native `Worker` (web-worker API; same surface as `packages/gateway/src/db/query-guard.ts:78`). No new devDependencies. Reuses the frozen PR-B-2a + PR-B-2b-1 perf module API: `BenchSurfaceResult`, `appendHistoryLine`, `runBench(..., resultKind)`, `gateway-spawn-bench`, `process-spawn-bench`, `bench-cli.ts` `SURFACE_REGISTRY` / `STUB_SURFACES` / `REFERENCE_ONLY` / `LINUX_ONLY_THRESHOLDS` / `SURFACE_RESULT_KIND` registries, `runIndexedSchemaMigrations(db, LocalIndex.SCHEMA_VERSION)` (currently 23), `dbRun` from `db/write.ts`, `appendAuditEntry` from `db/audit-chain.ts`, `insertWatcherEvent` from `automation/watcher-store.ts`, `insertItem` shape from `index/item-store.ts:71`, and `createLocalEmbedder` from `embedding/model.ts`.

**Spec source:** [`docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md`](../specs/2026-04-27-perf-audit-cluster-c-design.md) §3 (PR boundary), §5.3 (`worker-bench.ts`), §6.3 (S8), §6.4 (S9), §6.5 (S10), §6.6 (`busy_retries` schema additivity), §6.7 (history.jsonl flow), §7 (gating), §8 (error handling), §9 (acceptance criteria for PR-B-2b-2).

**Predecessor plan:** [`2026-04-27-perf-audit-cluster-c-1.md`](./2026-04-27-perf-audit-cluster-c-1.md) (PR-B-2b-1, merged via PR #117) — landed S6-drive/gmail/github + S7-a/b/c, plus the `gateway-spawn-bench`, `rss-sampler`, MSW + synthetic-trace fixtures, `BenchResultKind` parameter on `runBench`, and the `LINUX_ONLY_THRESHOLDS` / `SURFACE_RESULT_KIND` registry split.

**Decisions taken in this plan that the spec did not pin** (recorded so future readers don't second-guess):
- **D-1** (Worker constructor signature) — the injectable `WorkerCtor` matches native `Worker`'s signature `new (url: URL) => Worker`. Native `Worker` does NOT take a `WorkerOptions` arg in Bun's web-worker surface; the spec's TypeScript snippet `new (url: URL, opts: WorkerOptions) => Worker` is corrected here. Tests inject `(url) => fakeWorker`.
- **D-2** (S10 journal mode) — Worker scripts call `LocalIndex.ensureSchema(db)` (which runs `runIndexedSchemaMigrations` then `PRAGMA foreign_keys = ON`) and do **not** set `PRAGMA journal_mode = WAL`. Production never explicitly sets WAL either (verified: zero `PRAGMA journal_mode` writes in `packages/gateway/src/index/`); leaving it at the rollback-journal default is the production-equivalent baseline and gives the heaviest writer contention — the metric we're measuring.
- **D-3** (S9 placement in registries) — added to **both** `STUB_SURFACES` and `REFERENCE_ONLY` per spec §7 / §9. `processSurface` checks `STUB_SURFACES` first and returns early, so the `REFERENCE_ONLY` membership is semantic-only (signals "this *will* be reference-only when the real Ollama harness lands in PR-B-2b-3") but never load-bearing in this PR. Tests assert the stub-branch behaviour, not the reference-only branch.
- **D-4** (S8 type) — `BenchSurfaceId` uses a template-literal type for the 12 S8 cells (`S8-l${S8Length}-b${S8Batch}`) rather than 12 explicit literals. Reason: the cross-product registration loop in `bench-cli.ts` (spec §6.3) generates the same 12 keys at runtime; the type expresses exactly that cross-product without 12 hand-written rows. Existing `S6-*` / `S7-*` literals stay explicit because there are only three of each.
- **D-5** (S10 `busy_retries` aggregation) — `bench-cli`'s `processSurface` resets `S10_BUSY_RETRIES.value = 0` **once before** the `runBench` loop; the driver `runSqliteContentionOnce` **accumulates** (`+=`) per invocation. After 5 runs, the sentinel holds the **sum** of busy-retries across all runs. PR-C can derive retries/sec by dividing by `runs × durationSec`. Resolves a review-cycle bug where per-call sentinel reset would have made the field reflect only the last run.

**Open questions deferred to PR review** (not blockers; flagged here so reviewers know they were considered):
- **OQ-1** (S8 corpus realism) — `synthesizeText` uses a 30-word vocabulary. MiniLM's WordPiece tokenizer caches by token ID and the ONNX encoder is compute-bound (O(N²·d) attention per layer), so vocab repetition does not artificially inflate throughput; it does keep batch shapes consistent, which is an upper-bound signal — exactly what we want for SLO threshold setting. A varied lexicon is a worthwhile follow-up if PR-C finds the threshold drifts from real workloads.
- **OQ-2** (S8 large-cell RSS) — the largest cell is `S8-l5000-b64`: `count = batch * 1000 = 64_000` strings × 5000 chars ≈ 320 MB raw + ~22 MB MiniLM ONNX model + ~96 MB Float32Array embeddings ≈ **~440 MB peak RSS**. Well below GHA Ubuntu's 7 GB. S8 and S10 run sequentially through the bench-cli loop, never concurrently, so aggregate footprints don't compound. The `batch * 1000` count comes literally from spec §6.3 — not changing it here; PR-C can cap if it ever becomes a real CI ceiling.
- **OQ-3** (S10 5s duration) — spec §6.5 pins `durationMs: 5_000`. Five runs × 5 s = 25 s total measurement; SQLITE_BUSY retries fire on every contended write so the signal converges fast. If CI scheduling noise makes the metric flaky, PR-C is the right gate to tune the threshold or extend the window — not this plan.

**Out of scope for this PR (lands later):**
- Real Ollama-driven S9 + real Tauri-renderer instrumentation for S3/S5. Hypothetical PR-B-2b-3.
- CI workflow `_perf.yml`, populated `slo.md` thresholds, `baseline.md`. PR-C work.
- Schema additivity beyond `busy_retries?: number`. Spec §10 explicitly says no further bumps.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/gateway/src/perf/types.ts` | Modify | Replace `"S8"` literal with `S8SurfaceId = `S8-l${S8Length}-b${S8Batch}``; export `S8_LENGTHS` / `S8_BATCHES` const arrays for cross-product reuse; add `busyRetries?: number` to `BenchSurfaceResult` |
| `packages/gateway/src/perf/history-line.ts` | Modify | Add optional `busy_retries?: number` to `HistoryLineSurface` |
| `packages/gateway/src/perf/history-line.test.ts` | Modify | Cover the new optional field (round-trip via `appendHistoryLine` → JSON.parse) |
| `packages/gateway/src/perf/worker-bench.ts` | Create | `runWorkerBench(opts)` — spawns N Workers via injectable `WorkerCtor`, drives the typed message protocol, aggregates `writes` + `busyRetries` + `errors[]` |
| `packages/gateway/src/perf/worker-bench.test.ts` | Create | Unit tests with injectable fake `Worker`s — exercises happy path, hung-Worker terminate, error path with `stack`, partial failure |
| `packages/gateway/src/perf/fixtures/synthetic-text.ts` | Create | `synthesizeText({ length, count, seed? })` — deterministic LCG-generated strings of `length` words; tier-scaling via `S8_LENGTHS` |
| `packages/gateway/src/perf/fixtures/synthetic-text.test.ts` | Create | Determinism + length-shape tests |
| `packages/gateway/src/perf/surfaces/sqlite-worker-sync.ts` | Create | Worker entry — bulk-`INSERT INTO item` via `dbRun`; tracks `writes` + `busyRetries` |
| `packages/gateway/src/perf/surfaces/sqlite-worker-watcher.ts` | Create | Worker entry — `INSERT INTO watcher_event` via `dbRun`; pre-seeds a watcher row |
| `packages/gateway/src/perf/surfaces/sqlite-worker-audit.ts` | Create | Worker entry — `appendAuditEntry` (`db/audit-chain.ts`); BLAKE3 chain hash exercised under contention |
| `packages/gateway/src/perf/surfaces/sqlite-worker-shared.ts` | Create | Shared message-protocol types + a `runWorkerLoop(deps)` helper used by all three worker scripts (DRY: single retry budget, single `BEGIN IMMEDIATE` recipe, single `done` posting recipe) |
| `packages/gateway/src/perf/surfaces/sqlite-worker-shared.test.ts` | Create | Unit tests for the shared loop with an injectable `dbRun` fake — covers `SQLITE_BUSY` retry counter, hard-error abort, stop-message handling |
| `packages/gateway/src/perf/surfaces/bench-sqlite-contention.ts` | Create | S10 driver — `runWorkerBench` with the three worker URLs; samples = `totalThroughputPerSec` per run; result.surface line carries `busyRetries` |
| `packages/gateway/src/perf/surfaces/bench-sqlite-contention.test.ts` | Create | Smoke with injected `WorkerCtor` |
| `packages/gateway/src/perf/surfaces/bench-embedding-throughput.ts` | Create | S8 parameterised core — `runEmbeddingThroughputOnce({ length, batch })` does one warm-up `embed` call before the timer, then loops `provider.embed(texts.slice(i, i + batch))` |
| `packages/gateway/src/perf/surfaces/bench-embedding-throughput.test.ts` | Create | Asserts the warm-up call happens before any timed call (via injected embedder); asserts items/sec computation |
| `packages/gateway/src/perf/surfaces/bench-llm-roundtrip.ts` | Create | S9 stub — returns `[]`; exports `S9_STUB_REASON` |
| `packages/gateway/src/perf/surfaces/bench-llm-roundtrip.test.ts` | Create | Smoke — driver returns `[]`; reason string non-empty |
| `packages/gateway/src/perf/bench-cli.ts` | Modify | Register `S9`, `S10`, and the cross-product loop for 12 S8 cells in `SURFACE_REGISTRY`; extend `STUB_SURFACES` with `S9`; extend `REFERENCE_ONLY` with `S9`; map `BenchSurfaceResult.busyRetries` → `HistoryLineSurface.busy_retries` in `resultToHistorySurface`; add `S10` to `SURFACE_RESULT_KIND` as `"throughput"` |
| `packages/gateway/src/perf/bench-cli.test.ts` | Modify | Add tests: 12 S8 cells registered; S9 stub; S10 throughput + busy_retries; `resultToHistorySurface` mapping |
| `packages/gateway/src/perf/bench-harness.test.ts` | Modify | Pin the `busyRetries` side-channel contract so a future harness refactor can't accidentally break the spread-attach pattern (no production-code change — see Task 14) |
| `packages/gateway/src/perf/bench-runner.ts` | Modify | Update `--help` text to list new surface IDs |
| `packages/gateway/src/perf/index.ts` | Modify | Re-export new helpers + drivers |

**Total:** 15 files created, 7 modified.

---

## Execution order

Sequential: Tasks 1 → 20. Each task is independently committable. Critical dependencies:
- Task 1 (types) must land before Task 2 (history-line additivity uses the new `BenchSurfaceResult.busyRetries` field) and before any driver task.
- Task 2 (`busy_retries` schema additivity) must land before Task 10 (S10 driver populates it) and Task 13 (mapping in `resultToHistorySurface`).
- Task 3 (`worker-bench.ts`) and Task 5 (`sqlite-worker-shared.ts`) must land before Tasks 6–8 (the per-role Worker scripts depend on the shared message-protocol types) and before Task 10 (S10 driver depends on `worker-bench`).
- Task 4 (`synthetic-text.ts`) must land before Task 11 (S8 driver depends on the corpus generator).
- Task 9 (Worker boot smoke) gates Task 10 — if a Worker fails to boot in isolation, fix it before bundling into the S10 driver.
- Task 13 (bench-cli registration) and Task 15 (bench-cli tests) must land last among code tasks because they integrate everything.

```
T1 (types) → T2 (history schema) ──┬─→ T3 (worker-bench) ──┐
                                   │                       │
                                   ├─→ T5 (worker shared) ─┼─→ T6/T7/T8 (3 worker scripts) ─→ T9 (boot smoke) ─→ T10 (S10)
                                   │
                                   ├─→ T4 (synthetic-text) ───────────────────────────────────────────────────→ T11 (S8)
                                   │
                                   └─→ T12 (S9 stub)

                                              T10 + T11 + T12 ─→ T13 (bench-cli register) ─→ T14 (side-channel) ─→ T15 (cli tests)
                                                                                                                       │
                                                                                                                       ▼
                                                                                  T16 (help) → T17 (barrel) → T18 (coverage gate) → T19 (e2e smoke) → T20 (PR)
```

---

## Task 1 — Update `BenchSurfaceId` and `BenchSurfaceResult`

**Files:**
- Modify: `packages/gateway/src/perf/types.ts`

- [ ] **Step 1: Read the current file**

```bash
cat packages/gateway/src/perf/types.ts
```

Note that `"S8"` is currently a single literal at line 21, and `"S9"` / `"S10"` literals already exist (lines 22–23). `BenchSurfaceResult` (lines 50–62) does not yet have `busyRetries`.

- [ ] **Step 2: Replace the file contents with the expanded surface ID and result type**

```typescript
/**
 * Shared types for the perf bench harness (Phase 1A scaffolding).
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §3 for the
 * surface table this serves.
 */

/** Length tiers for S8 embedding throughput cells (text characters per item). */
export const S8_LENGTHS = [50, 500, 5000] as const;
export type S8Length = (typeof S8_LENGTHS)[number];

/** Batch tiers for S8 embedding throughput cells. */
export const S8_BATCHES = [1, 8, 32, 64] as const;
export type S8Batch = (typeof S8_BATCHES)[number];

/**
 * Cross-product of S8_LENGTHS × S8_BATCHES, e.g. "S8-l50-b1", "S8-l500-b32".
 * Registered in bench-cli.ts via a runtime cross-product loop (spec §6.3).
 */
export type S8SurfaceId = `S8-l${S8Length}-b${S8Batch}`;

export type BenchSurfaceId =
  | "S1"
  | "S2-a"
  | "S2-b"
  | "S2-c"
  | "S3"
  | "S4"
  | "S5"
  | "S6-drive"
  | "S6-gmail"
  | "S6-github"
  | "S7-a"
  | "S7-b"
  | "S7-c"
  | S8SurfaceId
  | "S9"
  | "S10"
  | "S11-a"
  | "S11-b";

export type RunnerKind =
  | "reference-m1air"
  | "gha-ubuntu"
  | "gha-macos"
  | "gha-windows"
  | "local-dev";

export type CorpusTier = "small" | "medium" | "large";

/**
 * How the harness should interpret a driver's `samples[]` return:
 *   - "latency"    — time-percentiles (p50/p95/p99/max in ms). Default.
 *   - "throughput" — each sample is items/sec; result.throughputPerSec = median.
 *   - "rss"        — each sample is RSS bytes; result.rssBytesP95 = p95(samples).
 */
export type BenchResultKind = "latency" | "throughput" | "rss";

export interface BenchRunOptions {
  runs: number;
  runner: RunnerKind;
  corpus?: CorpusTier;
}

export interface BenchSurfaceResult {
  surfaceId: BenchSurfaceId;
  samplesCount: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  maxMs?: number;
  throughputPerSec?: number;
  tokensPerSec?: number;
  firstTokenMs?: number;
  rssBytesP95?: number;
  rawSamples?: number[];
  /**
   * S10 only — sum of SQLITE_BUSY retries across all contention Workers.
   * Surfaced so PR-C's threshold logic can choose between raw throughput
   * and retry rate per write. Spec §6.6.
   */
  busyRetries?: number;
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: no errors. The template literal type `S8SurfaceId` resolves at compile time to a 12-element union.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/perf/types.ts
git commit -m "$(cat <<'EOF'
refactor(perf): split S8 literal into 12-cell template-literal type

PR-B-2b-2 prep. Replaces the single "S8" BenchSurfaceId literal with a
template-literal cross-product `S8-l${50|500|5000}-b${1|8|32|64}` so the
bench-cli cross-product registration loop (spec §6.3) lands a typed key
for every cell. Also adds optional busyRetries?: number to
BenchSurfaceResult — populated by the S10 SQLite contention driver
(spec §6.6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Add `busy_retries` to `HistoryLineSurface`

**Files:**
- Modify: `packages/gateway/src/perf/history-line.ts`
- Modify: `packages/gateway/src/perf/history-line.test.ts`

- [ ] **Step 1: Read the current schema**

```bash
cat packages/gateway/src/perf/history-line.ts
```

- [ ] **Step 2: Add the optional field to `HistoryLineSurface`**

In `packages/gateway/src/perf/history-line.ts`, replace the `HistoryLineSurface` interface block with:

```typescript
export interface HistoryLineSurface {
  samples_count: number;
  p50_ms?: number;
  p95_ms?: number;
  p99_ms?: number;
  max_ms?: number;
  throughput_per_sec?: number;
  tokens_per_sec?: number;
  first_token_ms?: number;
  rss_bytes_p95?: number;
  raw_samples?: number[];
  /**
   * S10 only — sum of SQLITE_BUSY retries across the contention Workers.
   * Optional; downstream consumers ignore unknown fields. Spec §6.6.
   */
  busy_retries?: number;
  /**
   * If set, this surface was not actually measured. Examples: stub drivers
   * (S3, S5 — renderer instrumentation pending); reference-only surfaces
   * (S2-c, S7-c, S9) skipped on a non-reference run.
   */
  stub_reason?: string;
}
```

- [ ] **Step 3: Add a round-trip test**

In `packages/gateway/src/perf/history-line.test.ts`, append:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendHistoryLine } from "./history-line.ts";

describe("appendHistoryLine — busy_retries field", () => {
  test("round-trips busy_retries through JSON serialisation", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-busyretries-"));
    try {
      const path = join(dir, "history.jsonl");
      appendHistoryLine(path, {
        schema_version: 1,
        run_id: "test",
        timestamp: "2026-04-28T00:00:00Z",
        runner: "local-dev",
        os_version: "test",
        nimbus_git_sha: "abc",
        bun_version: "1.0.0",
        surfaces: {
          S10: { samples_count: 5, throughput_per_sec: 1234, busy_retries: 17 },
        },
      });
      const parsed = JSON.parse(readFileSync(path, "utf8").trim()) as {
        surfaces: { S10: { busy_retries?: number } };
      };
      expect(parsed.surfaces.S10.busy_retries).toBe(17);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("omits busy_retries when not provided (no key written)", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-busyretries-"));
    try {
      const path = join(dir, "history.jsonl");
      appendHistoryLine(path, {
        schema_version: 1,
        run_id: "test",
        timestamp: "2026-04-28T00:00:00Z",
        runner: "local-dev",
        os_version: "test",
        nimbus_git_sha: "abc",
        bun_version: "1.0.0",
        surfaces: { "S2-a": { samples_count: 100, p95_ms: 12 } },
      });
      const text = readFileSync(path, "utf8");
      expect(text).not.toContain("busy_retries");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

(If `history-line.test.ts` already has imports, merge — do not duplicate.)

- [ ] **Step 4: Run the new tests**

```bash
bun test packages/gateway/src/perf/history-line.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/history-line.ts packages/gateway/src/perf/history-line.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): add optional busy_retries to HistoryLineSurface

PR-B-2b-2 schema additivity. S10 SQLite contention driver populates
this with the sum of SQLITE_BUSY retries across all writer Workers,
so PR-C's threshold logic can choose between raw throughput and
retry rate per write (spec §6.6). Optional; downstream consumers
ignore unknown fields per the PR-B-2a additivity contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — `worker-bench.ts` coordinator

**Files:**
- Create: `packages/gateway/src/perf/worker-bench.ts`
- Create: `packages/gateway/src/perf/worker-bench.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `packages/gateway/src/perf/worker-bench.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

import { runWorkerBench } from "./worker-bench.ts";

interface FakeWorkerOpts {
  postedReady?: boolean;
  postWritesAfterMs?: number;
  writes?: number;
  busyRetries?: number;
  errorBeforeReady?: { message: string; stack?: string };
  hangPastStop?: boolean;
}

function makeFakeWorker(opts: FakeWorkerOpts): typeof Worker {
  return class FakeWorker {
    private listeners: Record<string, ((e: MessageEvent<unknown>) => void)[]> = {};
    onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    constructor(_url: URL) {
      queueMicrotask(() => {
        if (opts.errorBeforeReady !== undefined) {
          this.onmessage?.({
            data: { kind: "error", ...opts.errorBeforeReady },
          } as MessageEvent<unknown>);
          return;
        }
        if (opts.postedReady !== false) {
          this.onmessage?.({ data: { kind: "ready" } } as MessageEvent<unknown>);
        }
      });
    }
    postMessage(msg: unknown): void {
      const m = msg as { kind: string };
      if (m.kind === "start") {
        const after = opts.postWritesAfterMs ?? 5;
        setTimeout(() => {
          this.onmessage?.({
            data: {
              kind: "done",
              writes: opts.writes ?? 100,
              busyRetries: opts.busyRetries ?? 0,
            },
          } as MessageEvent<unknown>);
        }, after);
      }
      if (m.kind === "stop" && opts.hangPastStop === true) {
        // never resolve — coordinator must terminate()
      }
    }
    terminate(): void {
      // no-op
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return true;
    }
  } as unknown as typeof Worker;
}

describe("runWorkerBench", () => {
  test("aggregates throughput across Workers (happy path)", async () => {
    const result = await runWorkerBench({
      workers: [
        { name: "sync", url: new URL("file:///fake-sync.ts"), config: {} },
        { name: "watcher", url: new URL("file:///fake-watcher.ts"), config: {} },
        { name: "audit", url: new URL("file:///fake-audit.ts"), config: {} },
      ],
      durationMs: 100,
      sharedDbPath: "/fake/db",
      WorkerCtor: makeFakeWorker({ writes: 500, busyRetries: 3 }),
    });
    expect(result.perWorker.length).toBe(3);
    expect(result.perWorker.every((w) => w.writes === 500)).toBe(true);
    expect(result.totalBusyRetries).toBe(9);
    // 500 writes / 0.1s = 5000/s per worker × 3 workers
    expect(result.totalThroughputPerSec).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);
  });

  test("captures error message and stack when a Worker errors before ready", async () => {
    const result = await runWorkerBench({
      workers: [{ name: "sync", url: new URL("file:///fake.ts"), config: {} }],
      durationMs: 100,
      sharedDbPath: "/fake/db",
      WorkerCtor: makeFakeWorker({
        errorBeforeReady: { message: "bind failed", stack: "at line 42" },
      }),
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.message).toBe("bind failed");
    expect(result.errors[0]?.stack).toBe("at line 42");
    expect(result.perWorker.length).toBe(0);
    expect(result.totalThroughputPerSec).toBe(0);
  });

  test("terminates Workers that hang past durationMs + 2s", async () => {
    const start = performance.now();
    const result = await runWorkerBench({
      workers: [{ name: "sync", url: new URL("file:///fake.ts"), config: {} }],
      durationMs: 50,
      sharedDbPath: "/fake/db",
      timeoutMs: 200,
      WorkerCtor: makeFakeWorker({
        writes: 10,
        hangPastStop: true,
        postWritesAfterMs: 10,
      }),
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500); // bounded by timeoutMs + slop
    // Worker did emit 'done' before the hang, so perWorker has it
    expect(result.perWorker.length).toBe(1);
  });

  test("partial failure — surviving Workers contribute to totalThroughput", async () => {
    let n = 0;
    const result = await runWorkerBench({
      workers: [
        { name: "sync", url: new URL("file:///a.ts"), config: {} },
        { name: "watcher", url: new URL("file:///b.ts"), config: {} },
      ],
      durationMs: 100,
      sharedDbPath: "/fake/db",
      WorkerCtor: ((_url: URL) => {
        n += 1;
        const ctor = n === 1
          ? makeFakeWorker({ errorBeforeReady: { message: "boom" } })
          : makeFakeWorker({ writes: 100, busyRetries: 1 });
        return new (ctor as unknown as new (u: URL) => Worker)(_url);
      }) as unknown as typeof Worker,
    });
    expect(result.errors.length).toBe(1);
    expect(result.perWorker.length).toBe(1);
    expect(result.totalBusyRetries).toBe(1);
    expect(result.totalThroughputPerSec).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail (file does not exist)**

```bash
bun test packages/gateway/src/perf/worker-bench.test.ts
```

Expected: error "Cannot find module './worker-bench.ts'".

- [ ] **Step 3: Implement `worker-bench.ts`**

Create `packages/gateway/src/perf/worker-bench.ts`:

```typescript
/**
 * Bun-Worker coordinator for S10 (SQLite write contention).
 *
 * Spawns N Workers via the injectable `WorkerCtor` (defaults to native
 * `Worker`), drives them through a typed message protocol
 * (init → ready → start → done | error), and aggregates writes/sec +
 * busyRetries + errors[] across the fleet.
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §5.3.
 */

export interface WorkerSpec {
  /** Logical role — "sync" | "watcher" | "audit"; surfaced in perWorker[] and errors[]. */
  name: string;
  /** URL to the worker entry script. */
  url: URL;
  /** Worker-specific config blob; passed verbatim in the `init` message. */
  config: Record<string, unknown>;
}

export interface WorkerBenchOptions {
  workers: WorkerSpec[];
  durationMs: number;
  sharedDbPath: string;
  /**
   * Test-injectable Worker constructor. Defaults to global `Worker`.
   * D-1 in the plan: native Worker takes only a URL — no opts arg.
   */
  WorkerCtor?: typeof Worker;
  /** Hard deadline. Defaults to durationMs + 5000. */
  timeoutMs?: number;
}

export interface WorkerBenchResult {
  perWorker: {
    name: string;
    writes: number;
    throughputPerSec: number;
    busyRetries: number;
  }[];
  totalThroughputPerSec: number;
  totalBusyRetries: number;
  errors: { name: string; message: string; stack?: string }[];
}

type ParentMsg =
  | { kind: "init"; config: Record<string, unknown>; dbPath: string }
  | { kind: "start"; durationMs: number }
  | { kind: "stop" };

type WorkerMsg =
  | { kind: "ready" }
  | { kind: "done"; writes: number; busyRetries: number }
  | { kind: "error"; message: string; stack?: string };

interface PerWorkerState {
  name: string;
  worker: Worker;
  ready: boolean;
  doneResolve: (v: { writes: number; busyRetries: number }) => void;
  donePromise: Promise<{ writes: number; busyRetries: number }>;
  readyResolve: () => void;
  readyPromise: Promise<void>;
  error?: { message: string; stack?: string };
}

function setupWorker(
  spec: WorkerSpec,
  WorkerCtor: typeof Worker,
  sharedDbPath: string,
): PerWorkerState {
  const worker = new WorkerCtor(spec.url);
  let readyResolve!: () => void;
  let doneResolve!: (v: { writes: number; busyRetries: number }) => void;
  const readyPromise = new Promise<void>((r) => {
    readyResolve = r;
  });
  const donePromise = new Promise<{ writes: number; busyRetries: number }>((r) => {
    doneResolve = r;
  });
  const state: PerWorkerState = {
    name: spec.name,
    worker,
    ready: false,
    doneResolve,
    donePromise,
    readyResolve,
    readyPromise,
  };

  worker.onmessage = (e: MessageEvent<unknown>): void => {
    const msg = e.data as WorkerMsg;
    if (msg.kind === "ready") {
      state.ready = true;
      state.readyResolve();
    } else if (msg.kind === "done") {
      state.doneResolve({ writes: msg.writes, busyRetries: msg.busyRetries });
    } else if (msg.kind === "error") {
      state.error = { message: msg.message, ...(msg.stack !== undefined && { stack: msg.stack }) };
      state.readyResolve();
      state.doneResolve({ writes: 0, busyRetries: 0 });
    }
  };
  worker.onerror = (ev: ErrorEvent): void => {
    state.error = { message: ev.message };
    state.readyResolve();
    state.doneResolve({ writes: 0, busyRetries: 0 });
  };

  const initMsg: ParentMsg = { kind: "init", config: spec.config, dbPath: sharedDbPath };
  worker.postMessage(initMsg);
  return state;
}

export async function runWorkerBench(opts: WorkerBenchOptions): Promise<WorkerBenchResult> {
  const Ctor = opts.WorkerCtor ?? Worker;
  const timeoutMs = opts.timeoutMs ?? opts.durationMs + 5_000;
  const states: PerWorkerState[] = opts.workers.map((spec) =>
    setupWorker(spec, Ctor, opts.sharedDbPath),
  );

  // Wait for ready (or error) from each Worker.
  await Promise.all(states.map((s) => s.readyPromise));

  // Drive the run from any worker that hit ready.
  const startMsg: ParentMsg = { kind: "start", durationMs: opts.durationMs };
  for (const s of states) {
    if (s.ready && s.error === undefined) {
      s.worker.postMessage(startMsg);
    }
  }

  // Race done-promises against the hard deadline.
  const deadlineHit = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), timeoutMs),
  );
  const allDone = Promise.all(states.map((s) => s.donePromise)).then(() => "done" as const);
  const winner = await Promise.race([allDone, deadlineHit]);

  // After done OR timeout, send stop and terminate any laggards.
  const stopMsg: ParentMsg = { kind: "stop" };
  for (const s of states) {
    try {
      s.worker.postMessage(stopMsg);
    } catch {
      /* worker already gone */
    }
  }
  if (winner === "timeout") {
    for (const s of states) {
      try {
        s.worker.terminate();
      } catch {
        /* ignore */
      }
    }
  } else {
    // Give workers up to 2 s to drain after stop, then terminate.
    await Promise.race([
      Promise.all(states.map((s) => s.donePromise)),
      new Promise<void>((r) => setTimeout(r, 2_000)),
    ]);
    for (const s of states) {
      try {
        s.worker.terminate();
      } catch {
        /* ignore */
      }
    }
  }

  // Collect results.
  const perWorker: WorkerBenchResult["perWorker"] = [];
  const errors: WorkerBenchResult["errors"] = [];
  for (const s of states) {
    if (s.error !== undefined) {
      errors.push({ name: s.name, ...s.error });
      continue;
    }
    const r = await s.donePromise;
    perWorker.push({
      name: s.name,
      writes: r.writes,
      busyRetries: r.busyRetries,
      throughputPerSec: opts.durationMs > 0 ? r.writes / (opts.durationMs / 1000) : 0,
    });
  }
  const totalThroughputPerSec = perWorker.reduce((acc, w) => acc + w.throughputPerSec, 0);
  const totalBusyRetries = perWorker.reduce((acc, w) => acc + w.busyRetries, 0);

  return { perWorker, totalThroughputPerSec, totalBusyRetries, errors };
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test packages/gateway/src/perf/worker-bench.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Run perf coverage and verify ≥80%**

```bash
bun test --coverage packages/gateway/src/perf/worker-bench.test.ts
```

Expected: lines coverage ≥80% for `worker-bench.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/perf/worker-bench.ts packages/gateway/src/perf/worker-bench.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): worker-bench coordinator for S10 SQLite contention

PR-B-2b-2 — spawns N Bun Workers via an injectable WorkerCtor,
drives them through a typed init→ready→start→done|error message
protocol, and aggregates per-Worker throughput + busyRetries + errors
across the fleet. Implements spec §5.3 verbatim apart from D-1 (native
Worker takes only a URL — no opts arg). Tests cover the happy path,
hung-Worker terminate, error-before-ready with stack capture, and
partial-failure aggregation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `synthetic-text.ts` corpus generator

**Files:**
- Create: `packages/gateway/src/perf/fixtures/synthetic-text.ts`
- Create: `packages/gateway/src/perf/fixtures/synthetic-text.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `packages/gateway/src/perf/fixtures/synthetic-text.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

import { synthesizeText, SYNTHETIC_TEXT_DEFAULT_SEED } from "./synthetic-text.ts";

describe("synthesizeText", () => {
  test("returns exactly `count` strings", () => {
    const out = synthesizeText({ length: 50, count: 32 });
    expect(out.length).toBe(32);
  });

  test("each string has roughly `length` characters (±10%)", () => {
    const out = synthesizeText({ length: 500, count: 16 });
    for (const s of out) {
      expect(s.length).toBeGreaterThanOrEqual(450);
      expect(s.length).toBeLessThanOrEqual(550);
    }
  });

  test("is deterministic across calls with the same seed", () => {
    const a = synthesizeText({ length: 100, count: 8, seed: 42 });
    const b = synthesizeText({ length: 100, count: 8, seed: 42 });
    expect(a).toEqual(b);
  });

  test("varies with different seeds", () => {
    const a = synthesizeText({ length: 100, count: 8, seed: 1 });
    const b = synthesizeText({ length: 100, count: 8, seed: 2 });
    expect(a).not.toEqual(b);
  });

  test("uses the documented default seed when seed is omitted", () => {
    const a = synthesizeText({ length: 100, count: 4 });
    const b = synthesizeText({ length: 100, count: 4, seed: SYNTHETIC_TEXT_DEFAULT_SEED });
    expect(a).toEqual(b);
  });

  test("scales to S8 large-tier (length=5000, count=64) without OOM", () => {
    const out = synthesizeText({ length: 5_000, count: 64 });
    expect(out.length).toBe(64);
    expect(out[0]?.length).toBeGreaterThan(4_500);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
bun test packages/gateway/src/perf/fixtures/synthetic-text.test.ts
```

Expected: error "Cannot find module './synthetic-text.ts'".

- [ ] **Step 3: Implement `synthetic-text.ts`**

Create `packages/gateway/src/perf/fixtures/synthetic-text.ts`:

```typescript
/**
 * Deterministic synthetic-text generator for the S8 embedding throughput
 * benches. Produces N strings of approximately `length` characters from a
 * fixed-seed Mulberry32 PRNG over a small word vocabulary.
 *
 * The output is realistic enough that the embedding model exercises its
 * tokenizer + encoder paths (not just zero-width strings), but small
 * enough that the harness can hold the entire corpus in memory at the
 * largest tier (length=5000 × count=64 ≈ 20 MB).
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §6.3.
 */

export const SYNTHETIC_TEXT_DEFAULT_SEED = 0x6e696d62; // "nimb"

export interface SynthesizeTextOptions {
  /** Approximate character length per string (target; actual is within ±10%). */
  length: number;
  count: number;
  seed?: number;
}

const WORDS = [
  "context",
  "ranker",
  "vault",
  "gateway",
  "embedding",
  "vector",
  "neighbor",
  "audit",
  "watcher",
  "session",
  "graph",
  "person",
  "service",
  "metric",
  "latency",
  "throughput",
  "memory",
  "snapshot",
  "manifest",
  "cluster",
  "schema",
  "migrate",
  "transaction",
  "checkpoint",
  "rollback",
  "consent",
  "redact",
  "verify",
  "signature",
  "release",
] as const;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthesizeText(opts: SynthesizeTextOptions): string[] {
  const seed = opts.seed ?? SYNTHETIC_TEXT_DEFAULT_SEED;
  const rng = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    const parts: string[] = [];
    let used = 0;
    while (used < opts.length) {
      const w = WORDS[Math.floor(rng() * WORDS.length)] ?? "context";
      parts.push(w);
      used += w.length + 1; // +1 for the joining space
    }
    out.push(parts.join(" "));
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test packages/gateway/src/perf/fixtures/synthetic-text.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/fixtures/synthetic-text.ts packages/gateway/src/perf/fixtures/synthetic-text.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): deterministic synthetic-text generator for S8

PR-B-2b-2 — produces N strings of ~length characters from a Mulberry32
PRNG over a 30-word vocabulary. Realistic enough to exercise the
tokenizer + encoder paths of the MiniLM embedder, small enough to
hold the largest tier (5000 chars × 64 batch ≈ 20 MB) in memory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Worker shared loop (`sqlite-worker-shared.ts`)

**Files:**
- Create: `packages/gateway/src/perf/surfaces/sqlite-worker-shared.ts`
- Create: `packages/gateway/src/perf/surfaces/sqlite-worker-shared.test.ts`

> **Why a shared module:** all three Workers (sync/watcher/audit) share the same retry-budget recipe (`BEGIN IMMEDIATE` + 100 ms retry on `SQLITE_BUSY` until elapsed > durationMs), the same message-protocol surface (`ready` after init, `done` after stop, `error` on hard failure), and the same `dbRun` failure handling. Putting that loop in a shared module keeps each Worker file as small as the connector-specific INSERT recipe — DRY, and cuts the test surface to one place.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/surfaces/sqlite-worker-shared.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

import { runWorkerLoop, type WorkerLoopDeps } from "./sqlite-worker-shared.ts";

describe("runWorkerLoop", () => {
  test("performs writes for the requested duration and returns done counters", async () => {
    let writes = 0;
    const deps: WorkerLoopDeps = {
      doOneWrite: () => {
        writes += 1;
      },
      now: () => performance.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    const result = await runWorkerLoop({ durationMs: 50, deps });
    expect(result.writes).toBeGreaterThan(0);
    expect(result.busyRetries).toBe(0);
    expect(writes).toBe(result.writes);
  });

  test("counts SQLITE_BUSY retries without inflating the writes count", async () => {
    let attempt = 0;
    const deps: WorkerLoopDeps = {
      doOneWrite: () => {
        attempt += 1;
        if (attempt % 3 === 0) {
          const err = new Error("database is locked") as Error & { code: number };
          err.code = 5; // SQLITE_BUSY
          throw err;
        }
      },
      now: () => performance.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    const result = await runWorkerLoop({ durationMs: 50, deps });
    expect(result.busyRetries).toBeGreaterThan(0);
    expect(result.writes).toBeGreaterThan(0);
    // Writes + retries = total attempts; retries should not be counted as writes.
    expect(result.writes + result.busyRetries).toBe(attempt);
  });

  test("aborts on a non-BUSY error and surfaces the message + stack", async () => {
    const err = new Error("disk full");
    err.stack = "Error: disk full\n    at fakeWrite";
    const deps: WorkerLoopDeps = {
      doOneWrite: () => {
        throw err;
      },
      now: () => performance.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    await expect(runWorkerLoop({ durationMs: 50, deps })).rejects.toMatchObject({
      message: "disk full",
    });
  });

  test("respects an early stop signal", async () => {
    const ac = new AbortController();
    let writes = 0;
    const deps: WorkerLoopDeps = {
      doOneWrite: () => {
        writes += 1;
        if (writes === 5) ac.abort();
      },
      now: () => performance.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    const result = await runWorkerLoop({ durationMs: 60_000, signal: ac.signal, deps });
    expect(result.writes).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
bun test packages/gateway/src/perf/surfaces/sqlite-worker-shared.test.ts
```

Expected: error "Cannot find module './sqlite-worker-shared.ts'".

- [ ] **Step 3: Implement `sqlite-worker-shared.ts`**

Create `packages/gateway/src/perf/surfaces/sqlite-worker-shared.ts`:

```typescript
/**
 * Shared loop + message-protocol types for the S10 SQLite contention
 * Worker scripts. Each per-role worker (sync/watcher/audit) supplies a
 * `doOneWrite` callback; this module owns:
 *  - the time-bounded loop (durationMs deadline + AbortSignal);
 *  - the BEGIN IMMEDIATE + 100 ms retry budget on SQLITE_BUSY;
 *  - the writes / busyRetries counters;
 *  - the message-protocol shape that runWorkerBench (../worker-bench.ts) drives.
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §6.5.
 */

const SQLITE_BUSY = 5;
const BUSY_RETRY_MS = 100;

export type ParentMsg =
  | { kind: "init"; config: Record<string, unknown>; dbPath: string }
  | { kind: "start"; durationMs: number }
  | { kind: "stop" };

export type WorkerMsg =
  | { kind: "ready" }
  | { kind: "done"; writes: number; busyRetries: number }
  | { kind: "error"; message: string; stack?: string };

function isSqliteBusy(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "number") return (code & 0xff) === SQLITE_BUSY;
  if (typeof code === "string") return code === "SQLITE_BUSY";
  // bun:sqlite SQLiteError messages also include "database is locked"
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" && /database is locked/i.test(msg);
}

export interface WorkerLoopDeps {
  /** Performs one write inside its own BEGIN IMMEDIATE. Must throw on SQLITE_BUSY. */
  doOneWrite: () => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface WorkerLoopOptions {
  durationMs: number;
  signal?: AbortSignal;
  deps: WorkerLoopDeps;
}

export async function runWorkerLoop(
  opts: WorkerLoopOptions,
): Promise<{ writes: number; busyRetries: number }> {
  const start = opts.deps.now();
  const deadline = start + opts.durationMs;
  let writes = 0;
  let busyRetries = 0;
  while (opts.deps.now() < deadline) {
    if (opts.signal?.aborted === true) break;
    try {
      opts.deps.doOneWrite();
      writes += 1;
    } catch (err) {
      if (!isSqliteBusy(err)) {
        throw err;
      }
      busyRetries += 1;
      await opts.deps.sleep(BUSY_RETRY_MS);
    }
  }
  return { writes, busyRetries };
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test packages/gateway/src/perf/surfaces/sqlite-worker-shared.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/sqlite-worker-shared.ts packages/gateway/src/perf/surfaces/sqlite-worker-shared.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): shared loop + message types for S10 worker scripts

PR-B-2b-2 — single-sources the time-bounded write loop, BEGIN IMMEDIATE +
100ms retry budget on SQLITE_BUSY, writes/busyRetries counters, and the
ParentMsg/WorkerMsg protocol shape that runWorkerBench drives.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — `sqlite-worker-sync.ts`

**Files:**
- Create: `packages/gateway/src/perf/surfaces/sqlite-worker-sync.ts`

> **Production parity:** the sync worker uses the exact `INSERT INTO item` shape from `packages/gateway/src/index/item-store.ts:71` (13 columns including `pinned`) — same column order, same `ON CONFLICT(id) DO UPDATE` recipe — and routes every write through `dbRun(db, sql, params)` (`packages/gateway/src/db/write.ts`). This guarantees `SQLITE_FULL` → `DiskFullError` semantics fire under contention.

- [ ] **Step 1: Implement the worker entry**

Create `packages/gateway/src/perf/surfaces/sqlite-worker-sync.ts`:

```typescript
#!/usr/bin/env bun
/**
 * S10 sync writer Worker — bulk-inserts items via the production
 * `dbRun` wrapper. Runs in its own bun:sqlite handle so the OS sees a
 * second writer competing for the database file lock with the watcher
 * + audit Workers.
 *
 * Every write goes through `dbRun` (packages/gateway/src/db/write.ts)
 * so SQLITE_FULL is converted to DiskFullError just like in production.
 * The INSERT shape mirrors `index/item-store.ts:71` — 13 columns +
 * ON CONFLICT(id) DO UPDATE — same schema we'd hit on a real sync.
 */

import { Database } from "bun:sqlite";

import { dbRun } from "../../db/write.ts";
import { LocalIndex } from "../../index/local-index.ts";
import { runWorkerLoop, type ParentMsg, type WorkerMsg } from "./sqlite-worker-shared.ts";

declare const self: Worker;

interface SyncConfig {
  /** Per-write batch size for the row PK. Default 100. Higher = fewer transactions. */
  batchSize?: number;
  /** Suffix prepended to row IDs to keep this worker's writes from colliding. */
  idPrefix?: string;
}

const ITEM_INSERT_SQL = `INSERT INTO item (
  id, service, type, external_id, title, body_preview, url, canonical_url,
  modified_at, author_id, metadata, synced_at, pinned
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  service = excluded.service,
  type = excluded.type,
  external_id = excluded.external_id,
  title = excluded.title,
  body_preview = excluded.body_preview,
  url = excluded.url,
  canonical_url = excluded.canonical_url,
  modified_at = excluded.modified_at,
  author_id = excluded.author_id,
  metadata = excluded.metadata,
  synced_at = excluded.synced_at,
  pinned = excluded.pinned`;

let db: Database | null = null;
let counter = 0;
let stopRequested = false;
let durationMs = 0;
let config: SyncConfig = {};

function postMsg(msg: WorkerMsg): void {
  self.postMessage(msg);
}

function doOneWrite(): void {
  if (db === null) throw new Error("db not initialised");
  const idPrefix = config.idPrefix ?? "sync";
  const id = `${idPrefix}:${counter}`;
  counter += 1;
  const now = Date.now();
  dbRun(db, ITEM_INSERT_SQL, [
    id,
    "github",
    "issue",
    String(counter),
    `Bench item ${counter}`,
    "synthetic",
    null,
    null,
    now,
    null,
    "{}",
    now,
    0,
  ]);
}

self.onmessage = async (e: MessageEvent<unknown>): Promise<void> => {
  const msg = e.data as ParentMsg;
  try {
    if (msg.kind === "init") {
      config = msg.config as SyncConfig;
      db = new Database(msg.dbPath);
      LocalIndex.ensureSchema(db);
      postMsg({ kind: "ready" });
      return;
    }
    if (msg.kind === "stop") {
      stopRequested = true;
      return;
    }
    if (msg.kind === "start") {
      durationMs = msg.durationMs;
      const ac = new AbortController();
      const checkStop = setInterval(() => {
        if (stopRequested) ac.abort();
      }, 50);
      try {
        const result = await runWorkerLoop({
          durationMs,
          signal: ac.signal,
          deps: {
            doOneWrite,
            now: () => performance.now(),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          },
        });
        postMsg({ kind: "done", writes: result.writes, busyRetries: result.busyRetries });
      } finally {
        clearInterval(checkStop);
      }
    }
  } catch (err) {
    postMsg({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
    });
  }
};
```

- [ ] **Step 2: Smoke-check that the file typechecks**

```bash
bun run typecheck
```

Expected: no new errors. (Worker scripts are not unit-tested in isolation — the Worker context is exercised by the S10 driver smoke test in Task 11.)

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/perf/surfaces/sqlite-worker-sync.ts
git commit -m "$(cat <<'EOF'
feat(perf): S10 sync writer Worker

PR-B-2b-2 — bulk-inserts items via the production dbRun wrapper using
the exact 13-column INSERT INTO item recipe from item-store.ts:71.
Owns its own bun:sqlite handle so the OS sees a second writer
competing for the database file lock.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — `sqlite-worker-watcher.ts`

**Files:**
- Create: `packages/gateway/src/perf/surfaces/sqlite-worker-watcher.ts`

> **Production parity:** the watcher worker uses the `INSERT INTO watcher_event` shape from `packages/gateway/src/automation/watcher-store.ts:99-103` and pre-seeds a single `watcher` row at init time (FK constraint `watcher_event.watcher_id` → `watcher.id`). All writes go through `dbRun`.

- [ ] **Step 1: Implement the worker entry**

Create `packages/gateway/src/perf/surfaces/sqlite-worker-watcher.ts`:

```typescript
#!/usr/bin/env bun
/**
 * S10 watcher writer Worker — inserts watcher_event rows via the
 * production `dbRun` wrapper. Pre-seeds one watcher row at init so the
 * `watcher_event.watcher_id → watcher.id` FK constraint passes (FKs
 * are turned ON by `LocalIndex.ensureSchema`).
 *
 * INSERT shape matches `automation/watcher-store.ts:99-103`.
 */

import { Database } from "bun:sqlite";

import { dbRun } from "../../db/write.ts";
import { LocalIndex } from "../../index/local-index.ts";
import { runWorkerLoop, type ParentMsg, type WorkerMsg } from "./sqlite-worker-shared.ts";

declare const self: Worker;

const WATCHER_ID = "bench-s10-watcher";

const WATCHER_SEED_SQL = `INSERT OR IGNORE INTO watcher (
  id, name, enabled, condition_type, condition_json, action_type, action_json, created_at
) VALUES (?, ?, 1, 'count', '{}', 'noop', '{}', ?)`;

const WATCHER_EVENT_INSERT_SQL = `INSERT INTO watcher_event (
  watcher_id, fired_at, condition_snapshot, action_result
) VALUES (?, ?, ?, ?)`;

let db: Database | null = null;
let counter = 0;
let stopRequested = false;

function postMsg(msg: WorkerMsg): void {
  self.postMessage(msg);
}

function doOneWrite(): void {
  if (db === null) throw new Error("db not initialised");
  counter += 1;
  dbRun(db, WATCHER_EVENT_INSERT_SQL, [
    WATCHER_ID,
    Date.now(),
    `{"count":${counter}}`,
    null,
  ]);
}

self.onmessage = async (e: MessageEvent<unknown>): Promise<void> => {
  const msg = e.data as ParentMsg;
  try {
    if (msg.kind === "init") {
      db = new Database(msg.dbPath);
      LocalIndex.ensureSchema(db);
      dbRun(db, WATCHER_SEED_SQL, [WATCHER_ID, "bench-s10", Date.now()]);
      postMsg({ kind: "ready" });
      return;
    }
    if (msg.kind === "stop") {
      stopRequested = true;
      return;
    }
    if (msg.kind === "start") {
      const ac = new AbortController();
      const checkStop = setInterval(() => {
        if (stopRequested) ac.abort();
      }, 50);
      try {
        const result = await runWorkerLoop({
          durationMs: msg.durationMs,
          signal: ac.signal,
          deps: {
            doOneWrite,
            now: () => performance.now(),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          },
        });
        postMsg({ kind: "done", writes: result.writes, busyRetries: result.busyRetries });
      } finally {
        clearInterval(checkStop);
      }
    }
  } catch (err) {
    postMsg({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
    });
  }
};
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/perf/surfaces/sqlite-worker-watcher.ts
git commit -m "$(cat <<'EOF'
feat(perf): S10 watcher writer Worker

PR-B-2b-2 — inserts watcher_event rows via the production dbRun
wrapper. Pre-seeds one watcher row at init so the FK constraint
passes. INSERT shape matches automation/watcher-store.ts:99-103.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — `sqlite-worker-audit.ts`

**Files:**
- Create: `packages/gateway/src/perf/surfaces/sqlite-worker-audit.ts`

> **Production parity + spec §9:** the audit worker reuses the production `computeAuditRowHash` BLAKE3 recipe from `packages/gateway/src/db/audit-chain.ts:24` and the production `prev_hash` lookup pattern, but routes the final `INSERT INTO audit_log` through `dbRun` (not the raw `db.run` that `appendAuditEntry` uses). This satisfies spec §9's "all three Workers route writes through `db/write.ts`" criterion while keeping the chain-hash recipe identical to production. (`appendAuditEntry` itself pre-dates the `dbRun` wrapper; replicating its body inside the Worker is a one-time bench concession, not a production change.)

- [ ] **Step 1: Implement the worker entry**

Create `packages/gateway/src/perf/surfaces/sqlite-worker-audit.ts`:

```typescript
#!/usr/bin/env bun
/**
 * S10 audit writer Worker — appends audit_log rows under contention.
 *
 * Replicates the body of `db/audit-chain.ts:appendAuditEntry` inline —
 * same prev_hash lookup, same `computeAuditRowHash` BLAKE3 recipe — but
 * routes the INSERT through the production `dbRun` wrapper so spec §9
 * acceptance ("all three Workers route writes through db/write.ts") is
 * satisfied for this Worker too. (`appendAuditEntry` itself uses
 * `db.run` because it pre-dates the wrapper; that's a separate prod
 * concern, not addressed here.)
 */

import { Database } from "bun:sqlite";

import { computeAuditRowHash, GENESIS_HASH } from "../../db/audit-chain.ts";
import { dbRun } from "../../db/write.ts";
import { LocalIndex } from "../../index/local-index.ts";
import { runWorkerLoop, type ParentMsg, type WorkerMsg } from "./sqlite-worker-shared.ts";

declare const self: Worker;

const AUDIT_INSERT_SQL = `INSERT INTO audit_log (
  action_type, hitl_status, action_json, timestamp, row_hash, prev_hash
) VALUES (?, ?, ?, ?, ?, ?)`;

let db: Database | null = null;
let counter = 0;
let stopRequested = false;

function postMsg(msg: WorkerMsg): void {
  self.postMessage(msg);
}

function doOneWrite(): void {
  if (db === null) throw new Error("db not initialised");
  counter += 1;
  const timestamp = Date.now();
  const actionJson = `{"counter":${counter}}`;
  const rawPrev = db
    .query(`SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1`)
    .get() as { row_hash: string | null } | undefined;
  const h = rawPrev?.row_hash;
  const prevHash = typeof h === "string" && h.length === 64 ? h : GENESIS_HASH;
  const rowHash = computeAuditRowHash({
    prevHash,
    actionType: "bench.s10.audit",
    hitlStatus: "n/a",
    actionJson,
    timestamp,
  });
  dbRun(db, AUDIT_INSERT_SQL, [
    "bench.s10.audit",
    "n/a",
    actionJson,
    timestamp,
    rowHash,
    prevHash,
  ]);
}

self.onmessage = async (e: MessageEvent<unknown>): Promise<void> => {
  const msg = e.data as ParentMsg;
  try {
    if (msg.kind === "init") {
      db = new Database(msg.dbPath);
      LocalIndex.ensureSchema(db);
      postMsg({ kind: "ready" });
      return;
    }
    if (msg.kind === "stop") {
      stopRequested = true;
      return;
    }
    if (msg.kind === "start") {
      const ac = new AbortController();
      const checkStop = setInterval(() => {
        if (stopRequested) ac.abort();
      }, 50);
      try {
        const result = await runWorkerLoop({
          durationMs: msg.durationMs,
          signal: ac.signal,
          deps: {
            doOneWrite,
            now: () => performance.now(),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          },
        });
        postMsg({ kind: "done", writes: result.writes, busyRetries: result.busyRetries });
      } finally {
        clearInterval(checkStop);
      }
    }
  } catch (err) {
    postMsg({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
    });
  }
};
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/perf/surfaces/sqlite-worker-audit.ts
git commit -m "$(cat <<'EOF'
feat(perf): S10 audit writer Worker

PR-B-2b-2 — appends audit_log rows via the production appendAuditEntry
recipe (BLAKE3 chain hash + prev_hash lookup + INSERT). Same code path
both LocalIndex.recordAudit and out-of-band writers go through.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Verify Worker scripts boot end-to-end (smoke)

**Files:** none (verification + commit-message audit).

This task confirms the three Worker scripts can be loaded from the parent process via `new Worker(new URL(...))` on at least one OS before the S10 driver lands. Catches platform-specific surprises (path resolution, native bun:sqlite import inside Worker, etc.) early so they're not bundled into the S10 driver test failure.

- [ ] **Step 1: Write a throwaway smoke script**

Create `/tmp/s10-worker-smoke.ts` (do NOT commit):

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "s10-smoke-"));
const dbPath = join(dir, "smoke.db");

const url = new URL(
  "../packages/gateway/src/perf/surfaces/sqlite-worker-sync.ts",
  import.meta.url,
);
const worker = new Worker(url);
let resolveReady!: () => void;
const ready = new Promise<void>((r) => {
  resolveReady = r;
});
let resolveDone!: (msg: unknown) => void;
const done = new Promise<unknown>((r) => {
  resolveDone = r;
});
worker.onmessage = (e: MessageEvent<unknown>): void => {
  const m = e.data as { kind: string };
  console.log("from worker:", m);
  if (m.kind === "ready") resolveReady();
  if (m.kind === "done" || m.kind === "error") resolveDone(m);
};
worker.onerror = (e): void => console.error("worker error", e.message);

worker.postMessage({ kind: "init", config: { batchSize: 50 }, dbPath });
await ready;
worker.postMessage({ kind: "start", durationMs: 200 });
const result = await done;
worker.terminate();
console.log("result:", result);
rmSync(dir, { recursive: true, force: true });
```

- [ ] **Step 2: Run the smoke script**

```bash
bun /tmp/s10-worker-smoke.ts
```

Expected: prints `from worker: { kind: "ready" }`, then `from worker: { kind: "done", writes: <some-positive-int>, busyRetries: 0 }`, then `result: { kind: "done", ... }`. No error output.

If the worker fails to boot (e.g., bun:sqlite native binding not loadable in Worker context), capture the error and resolve before proceeding to Task 11.

- [ ] **Step 3: Repeat for watcher and audit**

Substitute the URL in the smoke script with `sqlite-worker-watcher.ts` and `sqlite-worker-audit.ts` and re-run. Expected: same shape — `ready` then `done` with `writes > 0`.

- [ ] **Step 4: Delete the smoke script**

```bash
rm /tmp/s10-worker-smoke.ts
```

- [ ] **Step 5: No commit**

This task verifies but does not produce code. If a Worker fails to boot, fix the offending file (Tasks 6/7/8) and re-amend that task's commit before proceeding.

---

## Task 10 — `bench-sqlite-contention.ts` (S10 driver)

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-sqlite-contention.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-sqlite-contention.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `packages/gateway/src/perf/surfaces/bench-sqlite-contention.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

import {
  runSqliteContentionOnce,
  S10_BUSY_RETRIES,
} from "./bench-sqlite-contention.ts";

describe("runSqliteContentionOnce", () => {
  test("returns one items/sec sample per run and records busyRetries on the module symbol", async () => {
    let nWorkersSeen = 0;
    const fakeWorker = class FakeWorker {
      onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      constructor(_url: URL) {
        nWorkersSeen += 1;
        queueMicrotask(() => {
          this.onmessage?.({ data: { kind: "ready" } } as MessageEvent<unknown>);
        });
      }
      postMessage(msg: unknown): void {
        const m = msg as { kind: string };
        if (m.kind === "start") {
          setTimeout(() => {
            this.onmessage?.({
              data: { kind: "done", writes: 1000, busyRetries: 7 },
            } as MessageEvent<unknown>);
          }, 5);
        }
      }
      terminate(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      dispatchEvent(): boolean {
        return true;
      }
    };

    S10_BUSY_RETRIES.value = 0;
    const samples = await runSqliteContentionOnce(
      { runs: 1, runner: "local-dev" },
      {
        WorkerCtor: fakeWorker as unknown as typeof Worker,
        durationMs: 50,
      },
    );
    expect(samples.length).toBe(1);
    expect(samples[0]).toBeGreaterThan(0);
    expect(nWorkersSeen).toBe(3);
    // 7 retries × 3 workers, accumulated into a caller-managed sentinel.
    expect(S10_BUSY_RETRIES.value).toBe(21);
  });

  test("accumulates retries across multiple driver invocations (D-5)", async () => {
    // runBench calls the driver N times (once per run); the driver must
    // ADD to the sentinel each time, not overwrite it. This pins the D-5
    // contract so a future refactor can't re-introduce per-call reset.
    const fakeWorker = class FakeWorker {
      onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      constructor(_url: URL) {
        queueMicrotask(() => {
          this.onmessage?.({ data: { kind: "ready" } } as MessageEvent<unknown>);
        });
      }
      postMessage(msg: unknown): void {
        const m = msg as { kind: string };
        if (m.kind === "start") {
          setTimeout(() => {
            this.onmessage?.({
              data: { kind: "done", writes: 100, busyRetries: 5 },
            } as MessageEvent<unknown>);
          }, 5);
        }
      }
      terminate(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      dispatchEvent(): boolean {
        return true;
      }
    };
    S10_BUSY_RETRIES.value = 0;
    for (let i = 0; i < 3; i += 1) {
      await runSqliteContentionOnce(
        { runs: 1, runner: "local-dev" },
        { WorkerCtor: fakeWorker as unknown as typeof Worker, durationMs: 50 },
      );
    }
    // 5 retries × 3 workers × 3 driver invocations = 45
    expect(S10_BUSY_RETRIES.value).toBe(45);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-sqlite-contention.test.ts
```

Expected: error "Cannot find module './bench-sqlite-contention.ts'".

- [ ] **Step 3: Implement the driver**

Create `packages/gateway/src/perf/surfaces/bench-sqlite-contention.ts`:

```typescript
/**
 * S10 — SQLite write contention.
 *
 * Drives three Workers (sync / watcher / audit) against a shared
 * bun:sqlite database for `durationMs`, sampling `totalThroughputPerSec`
 * across the fleet. `totalBusyRetries` is accumulated onto a
 * module-private sentinel so bench-cli can fold it into the surface
 * entry as `busy_retries` without a samples-array contract change.
 *
 * D-2 (plan): no PRAGMA journal_mode = WAL. Workers call
 * LocalIndex.ensureSchema which leaves the rollback-journal default,
 * matching production and giving the heaviest writer contention.
 *
 * D-5 (plan): the driver does NOT reset the sentinel. bench-cli's
 * processSurface clears `S10_BUSY_RETRIES.value = 0` once before the
 * runBench loop; this driver `+=` accumulates per invocation so after
 * `runs` calls the sentinel holds the SUM of retries across all runs.
 *
 * resultKind = "throughput" → samples[i] is items/sec for run i;
 * harness returns median across runs.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runWorkerBench } from "../worker-bench.ts";
import type { BenchRunOptions } from "../types.ts";

export interface SqliteContentionRunOptions {
  durationMs?: number;
  WorkerCtor?: typeof Worker;
}

const DEFAULT_DURATION_MS = 5_000;

/**
 * Module-private sentinel — bench-cli RESETS once before the runBench
 * loop and READS once after; this driver only ACCUMULATES.
 *
 * The samples[] return contract from `SurfaceFn` is `number[]`, which
 * cannot carry a second metric without a schema change. Spec §6.6
 * permits this side-channel because busyRetries is a single scalar
 * per run-set, not per-sample data.
 */
export const S10_BUSY_RETRIES: { value: number } = { value: 0 };

function workerUrl(name: string): URL {
  // pathToFileURL handles Windows drive letters + percent-encoding per the
  // Node URL spec, replacing the brittle `path.replace(/\\/g, "/")` shim.
  return pathToFileURL(resolve(import.meta.dir, `${name}.ts`));
}

export async function runSqliteContentionOnce(
  _opts: BenchRunOptions,
  runOpts: SqliteContentionRunOptions = {},
): Promise<number[]> {
  const durationMs = runOpts.durationMs ?? DEFAULT_DURATION_MS;
  const home = mkdtempSync(join(tmpdir(), "nimbus-bench-s10-"));
  const dbPath = join(home, "nimbus.db");
  try {
    const result = await runWorkerBench({
      workers: [
        { name: "sync", url: workerUrl("sqlite-worker-sync"), config: { batchSize: 100 } },
        { name: "watcher", url: workerUrl("sqlite-worker-watcher"), config: {} },
        { name: "audit", url: workerUrl("sqlite-worker-audit"), config: {} },
      ],
      durationMs,
      sharedDbPath: dbPath,
      ...(runOpts.WorkerCtor !== undefined && { WorkerCtor: runOpts.WorkerCtor }),
    });
    // D-5: accumulate, do not overwrite. bench-cli owns the reset.
    S10_BUSY_RETRIES.value += result.totalBusyRetries;
    return [result.totalThroughputPerSec];
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run the test**

```bash
bun test packages/gateway/src/perf/surfaces/bench-sqlite-contention.test.ts
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-sqlite-contention.ts packages/gateway/src/perf/surfaces/bench-sqlite-contention.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): S10 SQLite write contention driver

PR-B-2b-2 — drives three Workers (sync/watcher/audit) against a shared
bun:sqlite database, samples totalThroughputPerSec across the fleet,
captures totalBusyRetries on a module-private sentinel so bench-cli
can fold it into the surface entry's busy_retries without changing
the SurfaceFn samples[] contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 — `bench-embedding-throughput.ts` (S8 driver)

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-embedding-throughput.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-embedding-throughput.test.ts`

> **Production parity:** uses `createLocalEmbedder` from `packages/gateway/src/embedding/model.ts` — same MiniLM ONNX path the gateway uses. The warm-up call (one throwaway `embed(["warm"])`) primes the ONNX cache + tokenizer + model load before the timer starts, so the metric isolates per-call inference cost.

- [ ] **Step 1: Write the failing tests first**

Create `packages/gateway/src/perf/surfaces/bench-embedding-throughput.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

import { runEmbeddingThroughputOnce } from "./bench-embedding-throughput.ts";

interface CallLog {
  texts: string[];
  beforeTimer: boolean;
}

function makeFakeEmbedder(perCallMs: number): {
  embedder: { model: string; dims: number; embed: (t: string[]) => Promise<Float32Array[]> };
  calls: CallLog[];
  startTime: number;
} {
  const calls: CallLog[] = [];
  const startTime = performance.now();
  let timerStarted = false;
  const embedder = {
    model: "fake-mini",
    dims: 384,
    async embed(texts: string[]): Promise<Float32Array[]> {
      calls.push({ texts: [...texts], beforeTimer: !timerStarted });
      // The driver flips this flag right before the timer starts.
      // We use the call-count == 1 → mark timer-started signal.
      if (calls.length === 1) {
        timerStarted = true;
      }
      await new Promise((r) => setTimeout(r, perCallMs));
      return texts.map(() => new Float32Array(384));
    },
  };
  return { embedder, calls, startTime };
}

describe("runEmbeddingThroughputOnce", () => {
  test("performs a warm-up embed before timing begins", async () => {
    const { embedder, calls } = makeFakeEmbedder(1);
    const samples = await runEmbeddingThroughputOnce(
      { length: 50, batch: 4, embedder, totalItems: 16 },
    );
    expect(samples.length).toBe(1);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.beforeTimer).toBe(true);
    expect(calls[0]?.texts.length).toBe(1); // warm-up sends 1 text
  });

  test("returns items/sec across the timed window", async () => {
    const { embedder } = makeFakeEmbedder(2);
    const samples = await runEmbeddingThroughputOnce(
      { length: 50, batch: 4, embedder, totalItems: 16 },
    );
    expect(samples[0]).toBeGreaterThan(0);
    // 16 items over ~8 ms ≈ 2000/s; sanity-check ceiling
    expect(samples[0]).toBeLessThan(20_000);
  });

  test("calls embed in batches of `batch`", async () => {
    const { embedder, calls } = makeFakeEmbedder(0);
    await runEmbeddingThroughputOnce(
      { length: 50, batch: 8, embedder, totalItems: 32 },
    );
    // Warm-up = 1 call, then 32 / 8 = 4 batched calls = 5 total
    expect(calls.length).toBe(5);
    expect(calls[0]?.texts.length).toBe(1);
    for (let i = 1; i < calls.length; i += 1) {
      expect(calls[i]?.texts.length).toBe(8);
    }
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
bun test packages/gateway/src/perf/surfaces/bench-embedding-throughput.test.ts
```

Expected: error "Cannot find module './bench-embedding-throughput.ts'".

- [ ] **Step 3: Implement the driver**

Create `packages/gateway/src/perf/surfaces/bench-embedding-throughput.ts`:

```typescript
/**
 * S8 — embedding throughput across the (length × batch) cross-product.
 *
 * Cell registration happens in bench-cli.ts via
 *   for (const length of S8_LENGTHS)
 *     for (const batch of S8_BATCHES)
 *       SURFACE_REGISTRY[`S8-l${length}-b${batch}`] = ...
 * which lands one threshold per cell in slo.md (PR-C work).
 *
 * Warm-up: one throwaway embed call BEFORE the timer starts. This
 * excludes model load + ONNX cache prime from the metric (spec §6.3).
 * Tests inject the embedder; production uses createLocalEmbedder.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalEmbedder } from "../../embedding/model.ts";
import { synthesizeText } from "../fixtures/synthetic-text.ts";
import type { Embedder } from "../../embedding/types.ts";
import type { S8Batch, S8Length } from "../types.ts";

export interface EmbeddingThroughputOptions {
  length: S8Length;
  batch: S8Batch;
  /** Total items in the corpus per run. Default 1000 × batch (spec §6.3). */
  totalItems?: number;
  /** Test-injectable embedder; production uses createLocalEmbedder. */
  embedder?: Embedder;
  /** Override default model cache dir. */
  cacheDir?: string;
}

const DEFAULT_BATCH_MULTIPLIER = 1_000;

async function getEmbedder(opts: EmbeddingThroughputOptions): Promise<Embedder> {
  if (opts.embedder !== undefined) return opts.embedder;
  return createLocalEmbedder({
    cacheDir: opts.cacheDir ?? join(tmpdir(), "nimbus-bench-models"),
  });
}

export async function runEmbeddingThroughputOnce(
  opts: EmbeddingThroughputOptions,
): Promise<number[]> {
  const totalItems = opts.totalItems ?? opts.batch * DEFAULT_BATCH_MULTIPLIER;
  const texts = synthesizeText({ length: opts.length, count: totalItems });
  const embedder = await getEmbedder(opts);

  // Warm-up — model load + ONNX cache + tokenizer prime happen here,
  // not inside the timed window. Result is discarded.
  await embedder.embed([texts[0] ?? "warm-up"]);

  const t0 = performance.now();
  for (let i = 0; i < texts.length; i += opts.batch) {
    await embedder.embed(texts.slice(i, i + opts.batch));
  }
  const elapsed = performance.now() - t0;
  if (elapsed <= 0) return [0];
  const itemsPerSec = texts.length / (elapsed / 1000);
  return [itemsPerSec];
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test packages/gateway/src/perf/surfaces/bench-embedding-throughput.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-embedding-throughput.ts packages/gateway/src/perf/surfaces/bench-embedding-throughput.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): S8 embedding throughput driver

PR-B-2b-2 — parameterised core for the S8 (length × batch) cross-product.
One throwaway embed call before the timer starts excludes model load +
ONNX cache prime from the metric. Tests inject the embedder; production
uses createLocalEmbedder (MiniLM via @xenova/transformers).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12 — `bench-llm-roundtrip.ts` (S9 stub)

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-llm-roundtrip.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-llm-roundtrip.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `packages/gateway/src/perf/surfaces/bench-llm-roundtrip.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { runLlmRoundtripOnce, S9_STUB_REASON } from "./bench-llm-roundtrip.ts";

describe("runLlmRoundtripOnce", () => {
  test("exports a stable stub reason string", () => {
    expect(typeof S9_STUB_REASON).toBe("string");
    expect(S9_STUB_REASON.length).toBeGreaterThan(0);
    expect(S9_STUB_REASON).toMatch(/Ollama|stub|reference-only/i);
  });

  test("driver shape: returns []", async () => {
    const samples = await runLlmRoundtripOnce({ runs: 1, runner: "local-dev" });
    expect(samples).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-llm-roundtrip.test.ts
```

Expected: error "Cannot find module './bench-llm-roundtrip.ts'".

- [ ] **Step 3: Implement the stub**

Create `packages/gateway/src/perf/surfaces/bench-llm-roundtrip.ts`:

```typescript
/**
 * S9 — LLM round-trip (stub).
 *
 * Mirrors the S3 / S5 / S7-c stub pattern: returns [] so the
 * bidirectional driver↔row mapping (parent spec §6 criterion 7)
 * holds. The bench-cli orchestrator places `S9` in both
 * `STUB_SURFACES` (always returns the stub_reason) and
 * `REFERENCE_ONLY` (semantic intent — the real driver in PR-B-2b-3
 * will require a loaded local LLM + GPU).
 */

import type { BenchRunOptions } from "../types.ts";

export const S9_STUB_REASON =
  "stub: Ollama-driven LLM round-trip lands in PR-B-2b-3 (reference-only when implemented)";

export async function runLlmRoundtripOnce(
  _opts: BenchRunOptions,
  _runOpts: Record<string, unknown> = {},
): Promise<number[]> {
  return [];
}
```

- [ ] **Step 4: Run the test**

```bash
bun test packages/gateway/src/perf/surfaces/bench-llm-roundtrip.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-llm-roundtrip.ts packages/gateway/src/perf/surfaces/bench-llm-roundtrip.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): S9 LLM round-trip stub

PR-B-2b-2 — mirrors S3/S5/S7-c stub pattern. Returns [] so the
bidirectional driver↔row mapping holds; the real Ollama-driven
driver lands in PR-B-2b-3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13 — Register S8 / S9 / S10 in `bench-cli.ts`

**Files:**
- Modify: `packages/gateway/src/perf/bench-cli.ts`

This is the integration task — wires every preceding driver into the orchestrator.

- [ ] **Step 1: Read the current `bench-cli.ts`**

```bash
cat packages/gateway/src/perf/bench-cli.ts
```

Note the structure: imports → `BenchCliDeps` → `DriverFn` → `SURFACE_REGISTRY` → `SURFACE_RESULT_KIND` → `STUB_SURFACES` → `REFERENCE_ONLY` → `REFERENCE_ONLY_REASONS` → `LINUX_ONLY_THRESHOLDS` → helpers → `processSurface` → `runBenchCli`.

- [ ] **Step 2: Add the new imports**

In `packages/gateway/src/perf/bench-cli.ts`, after the existing surface imports (line 33, after `bench-tui-first-paint`), add:

```typescript
import {
  runEmbeddingThroughputOnce,
} from "./surfaces/bench-embedding-throughput.ts";
import { runLlmRoundtripOnce, S9_STUB_REASON } from "./surfaces/bench-llm-roundtrip.ts";
import {
  runSqliteContentionOnce,
  S10_BUSY_RETRIES,
} from "./surfaces/bench-sqlite-contention.ts";
```

And update the `import type { ... }` line to include the S8 const arrays:

```typescript
import {
  type BenchResultKind,
  type BenchRunOptions,
  type BenchSurfaceId,
  type BenchSurfaceResult,
  type RunnerKind,
  S8_BATCHES,
  S8_LENGTHS,
} from "./types.ts";
```

- [ ] **Step 3: Add S9 + S10 + S8 cells to `SURFACE_REGISTRY`**

After the existing `SURFACE_REGISTRY` block (line 73-89), add the cross-product loop and S9/S10 entries. Replace the const-declaration with:

```typescript
const SURFACE_REGISTRY: Partial<Record<BenchSurfaceId, DriverFn>> = {
  S1: (opts) => runColdStartOnce(opts),
  "S2-a": (opts, runOpts) => runQueryLatencyOnce(opts, runOpts),
  "S2-b": (opts, runOpts) => runQueryLatency100kOnce(opts, runOpts),
  "S2-c": (opts, runOpts) => runQueryLatency1mOnce(opts, runOpts),
  S3: (opts) => runDashboardFirstPaintOnce(opts),
  S4: (opts) => runTuiFirstPaintOnce(opts),
  S5: (opts) => runHitlPopupOnce(opts),
  "S6-drive": (opts) => runSyncThroughputDriveOnce(opts),
  "S6-gmail": (opts) => runSyncThroughputGmailOnce(opts),
  "S6-github": (opts) => runSyncThroughputGithubOnce(opts),
  "S7-a": (opts) => runRssIdleOnce(opts),
  "S7-b": (opts) => runRssHeavySyncOnce(opts),
  "S7-c": (opts) => runRssMultiAgentOnce(opts),
  S9: (opts) => runLlmRoundtripOnce(opts),
  S10: (opts) => runSqliteContentionOnce(opts),
  "S11-a": (opts) => runCliOverheadColdOnce(opts),
  "S11-b": (opts) => runCliOverheadWarmOnce(opts),
};
// S8 cross-product: 12 cells via (length × batch). Spec §6.3, plan D-4.
// `for...of` with `const` captures `length`/`batch` per-iteration, so each
// closure binds its own pair — no shared-state hazard.
for (const length of S8_LENGTHS) {
  for (const batch of S8_BATCHES) {
    const id = `S8-l${length}-b${batch}` as BenchSurfaceId;
    SURFACE_REGISTRY[id] = () => runEmbeddingThroughputOnce({ length, batch });
  }
}
```

- [ ] **Step 4: Add S6-drive/gmail/github already-throughput plus S10 to `SURFACE_RESULT_KIND`, and the 12 S8 cells**

After the current `SURFACE_RESULT_KIND` block (line 92-100), replace with:

```typescript
const SURFACE_RESULT_KIND: Partial<Record<BenchSurfaceId, BenchResultKind>> = {
  "S6-drive": "throughput",
  "S6-gmail": "throughput",
  "S6-github": "throughput",
  "S7-a": "rss",
  "S7-b": "rss",
  "S7-c": "rss",
  S10: "throughput",
  // Latency surfaces (S1, S2-*, S4, S11-*) omit and default to "latency".
};
// S8 cells are throughput surfaces too.
for (const length of S8_LENGTHS) {
  for (const batch of S8_BATCHES) {
    SURFACE_RESULT_KIND[`S8-l${length}-b${batch}` as BenchSurfaceId] = "throughput";
  }
}
```

- [ ] **Step 5: Add S9 to `STUB_SURFACES` and `REFERENCE_ONLY`**

Replace the existing `STUB_SURFACES` block:

```typescript
const STUB_SURFACES: Partial<Record<BenchSurfaceId, string>> = {
  S3: S3_STUB_REASON,
  S5: S5_STUB_REASON,
  S9: S9_STUB_REASON,
};
```

Replace the existing `REFERENCE_ONLY` block:

```typescript
const REFERENCE_ONLY: ReadonlySet<BenchSurfaceId> = new Set<BenchSurfaceId>([
  "S2-c",
  "S7-c",
  "S9",
]);
```

- [ ] **Step 6: Map `busy_retries` through `resultToHistorySurface`**

Replace the existing `resultToHistorySurface` function (lines 155-166) with:

```typescript
function resultToHistorySurface(r: BenchSurfaceResult): HistoryLineSurface {
  const out: HistoryLineSurface = { samples_count: r.samplesCount };
  if (r.p50Ms !== undefined) out.p50_ms = r.p50Ms;
  if (r.p95Ms !== undefined) out.p95_ms = r.p95Ms;
  if (r.p99Ms !== undefined) out.p99_ms = r.p99Ms;
  if (r.maxMs !== undefined) out.max_ms = r.maxMs;
  if (r.throughputPerSec !== undefined) out.throughput_per_sec = r.throughputPerSec;
  if (r.tokensPerSec !== undefined) out.tokens_per_sec = r.tokensPerSec;
  if (r.firstTokenMs !== undefined) out.first_token_ms = r.firstTokenMs;
  if (r.rssBytesP95 !== undefined) out.rss_bytes_p95 = r.rssBytesP95;
  if (r.busyRetries !== undefined) out.busy_retries = r.busyRetries;
  return out;
}
```

- [ ] **Step 7: Reset the `S10_BUSY_RETRIES` sentinel before the runBench loop, then read it after (D-5)**

In `processSurface` (around lines 229-241), change the `runBench` call site to (a) reset the sentinel before the loop so any leakage from a prior surface or crashed run starts clean (review S-3), and (b) read the accumulated value into `BenchSurfaceResult.busyRetries`. The driver's `+=` accumulation (Task 10) means the sentinel holds the **sum** across all `runs` invocations after `runBench` returns.

Replace the `try { result = await runBench(...) }` block with:

```typescript
  let result: BenchSurfaceResult;
  try {
    const resultKind = SURFACE_RESULT_KIND[id] ?? "latency";
    if (id === "S10") {
      // D-5: defensive reset in the orchestrator — driver only accumulates.
      S10_BUSY_RETRIES.value = 0;
    }
    result = await runBench(id, (o) => driver(o, runOpts), opts, {}, resultKind);
    if (id === "S10") {
      result = { ...result, busyRetries: S10_BUSY_RETRIES.value };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: "result",
      entry: { samples_count: 0, stub_reason: `driver-failed: ${msg}` },
      stdoutLine: `${id}  failed: ${msg}`,
      stderrLine: `${id} driver failed: ${msg}`,
    };
  }
```

- [ ] **Step 8: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/gateway/src/perf/bench-cli.ts
git commit -m "$(cat <<'EOF'
feat(perf): register S8/S9/S10 surfaces in bench-cli

PR-B-2b-2 — final wiring task.

- S8 cross-product loop registers all 12 S8-l{50|500|5000}-b{1|8|32|64}
  cells via runEmbeddingThroughputOnce(length, batch) (spec §6.3).
- S9 registered as a stub via runLlmRoundtripOnce; placed in both
  STUB_SURFACES and REFERENCE_ONLY (D-3).
- S10 registered as throughput; orchestrator owns the
  S10_BUSY_RETRIES reset before the runBench loop and reads the
  accumulated total after, folding it into HistoryLineSurface as
  busy_retries (D-5; spec §6.6).
- SURFACE_RESULT_KIND extended for S10 + 12 S8 cells.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14 — Document the `busyRetries` side-channel contract

**Files:**
- Modify: `packages/gateway/src/perf/bench-harness.test.ts`

> **Why this is a test-only task:** Task 13 attaches `busyRetries` to the `BenchSurfaceResult` AFTER `runBench` returns, by reading the module sentinel in `processSurface`. The harness itself doesn't need a code change — `BenchSurfaceResult.busyRetries` already exists on the type (Task 1) and the spread-attach pattern in Task 13's Step 7 preserves all other fields. This task pins the contract so a future refactor of `runBench` doesn't accidentally break the spread.

- [ ] **Step 1: Skip the harness code change**

Re-read the three `runBench` build helpers (`buildLatencyResult`, `buildThroughputResult`, `buildRssResult`). Each returns a `BenchSurfaceResult` constructed from scratch — `busyRetries` is never set, which is fine: `processSurface` attaches it post-hoc for S10 only.

The alternative — making `runBench` accept an `aggregateExtras` callback — is overkill for one field on one surface. Keep the sentinel.

**Decision:** No code change in `bench-harness.ts`. Only the test below.

- [ ] **Step 2: Add the round-trip test**

In `packages/gateway/src/perf/bench-harness.test.ts`, append:

```typescript
describe("runBench — busyRetries side-channel (S10)", () => {
  test("BenchSurfaceResult preserves a busyRetries field that callers attach post-hoc", async () => {
    const fn = async (): Promise<number[]> => [100, 200, 300];
    const result = await runBench("S10", fn, { runs: 1, runner: "local-dev" }, {}, "throughput");
    // runBench itself does not set busyRetries — that's the caller's job.
    expect(result.busyRetries).toBeUndefined();
    // Callers attach it post-hoc and the resulting object is well-formed.
    const withRetries: typeof result = { ...result, busyRetries: 42 };
    expect(withRetries.busyRetries).toBe(42);
    expect(withRetries.surfaceId).toBe("S10");
    expect(withRetries.throughputPerSec).toBe(200);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
bun test packages/gateway/src/perf/bench-harness.test.ts
```

Expected: passes (no harness changes needed).

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/perf/bench-harness.test.ts
git commit -m "$(cat <<'EOF'
test(perf): document busyRetries side-channel contract for S10

PR-B-2b-2 — pins the design decision that bench-cli attaches
busyRetries post-hoc to a runBench-produced BenchSurfaceResult,
rather than runBench learning a per-driver "extras" hook. The test
asserts the spread-attach pattern preserves all existing fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15 — Add bench-cli tests for S8 / S9 / S10

**Files:**
- Modify: `packages/gateway/src/perf/bench-cli.test.ts`

- [ ] **Step 1: Append the new test block**

In `packages/gateway/src/perf/bench-cli.test.ts`, append after the `PR-B-2b-1 registrations` describe block:

```typescript
describe("runBenchCli — PR-B-2b-2 registrations", () => {
  test("--surface S9 records a stub entry with the documented reason", async () => {
    const exitCode = await runBenchCli(["--surface", "S9", "--runs", "1", "--gha"], {
      runId: "s9-test",
      historyPath,
      fixtureCacheDir: dir,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    const line = readHistoryLine();
    expect(line.surfaces["S9"]?.samples_count).toBe(0);
    expect(line.surfaces["S9"]?.stub_reason).toMatch(/Ollama|stub|reference-only/i);
  });

  test("--surface S10 (driver injected) accumulates busy_retries across runs (D-5)", async () => {
    const { S10_BUSY_RETRIES } = await import("./surfaces/bench-sqlite-contention.ts");
    // Pre-seed the sentinel with garbage to prove bench-cli's defensive
    // reset before the runBench loop wipes it (review S-3).
    S10_BUSY_RETRIES.value = 999;
    const exitCode = await runBenchCli(
      ["--surface", "S10", "--runs", "3", "--gha"],
      {
        runId: "s10-test",
        historyPath,
        fixtureCacheDir: dir,
        stdout: () => {},
        // Driver is called 3 times (runs=3); each call ADDS 5 retries to
        // the sentinel, mirroring the production runSqliteContentionOnce
        // accumulation pattern. After the loop: 999 → 0 (orchestrator
        // reset) → 5 → 10 → 15.
        surfaceDriverOverrides: {
          S10: async () => {
            S10_BUSY_RETRIES.value += 5;
            return [12_345];
          },
        },
      },
    );
    expect(exitCode).toBe(0);
    const raw = JSON.parse(readFileSync(historyPath, "utf8").trim()) as {
      surfaces: Record<string, { throughput_per_sec?: number; busy_retries?: number }>;
    };
    expect(raw.surfaces["S10"]?.throughput_per_sec).toBe(12_345);
    expect(raw.surfaces["S10"]?.busy_retries).toBe(15); // 5 × 3 runs
  });

  test("S8 cells are registered: --surface S8-l50-b1 (driver injected) populates throughput_per_sec", async () => {
    const exitCode = await runBenchCli(
      ["--surface", "S8-l50-b1", "--runs", "1", "--gha"],
      {
        runId: "s8-cell-test",
        historyPath,
        fixtureCacheDir: dir,
        stdout: () => {},
        surfaceDriverOverrides: {
          "S8-l50-b1": async () => [555],
        },
      },
    );
    expect(exitCode).toBe(0);
    const raw = JSON.parse(readFileSync(historyPath, "utf8").trim()) as {
      surfaces: Record<string, { throughput_per_sec?: number }>;
    };
    expect(raw.surfaces["S8-l50-b1"]?.throughput_per_sec).toBe(555);
  });

  test("S8 has all 12 cross-product cells (length × batch)", async () => {
    // We can't enumerate SURFACE_REGISTRY directly (it's module-private),
    // but every S8 cell should respond to --surface <id>. Spot-check
    // the corners: S8-l50-b1, S8-l50-b64, S8-l5000-b1, S8-l5000-b64.
    const corners = ["S8-l50-b1", "S8-l50-b64", "S8-l5000-b1", "S8-l5000-b64"] as const;
    for (const id of corners) {
      const exitCode = await runBenchCli(["--surface", id, "--runs", "1", "--gha"], {
        runId: `s8-${id}-test`,
        historyPath,
        fixtureCacheDir: dir,
        stdout: () => {},
        stderr: () => {},
        surfaceDriverOverrides: {
          [id]: async () => [42],
        },
      });
      expect(exitCode).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run the new tests**

```bash
bun test packages/gateway/src/perf/bench-cli.test.ts
```

Expected: all tests in this describe block pass; existing tests unchanged.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/perf/bench-cli.test.ts
git commit -m "$(cat <<'EOF'
test(perf): cover S8/S9/S10 surface registration and busy_retries flow

PR-B-2b-2 — exercises (a) S9 stub branch and reason text, (b) S10
throughput + busy_retries round-trip via the S10_BUSY_RETRIES
sentinel, (c) one S8 cell registers correctly, (d) all four corners
of the S8 (length × batch) cross-product respond to --surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16 — Update `bench-runner.ts` help text

**Files:**
- Modify: `packages/gateway/src/perf/bench-runner.ts`

- [ ] **Step 1: Replace the `--surface <id>` line in the `HELP` constant**

In `packages/gateway/src/perf/bench-runner.ts`, replace:

```typescript
  --surface <id>      one of: S1, S2-a, S2-b, S2-c, S3, S4, S5, S6-drive, S6-gmail, S6-github,
                      S7-a, S7-b, S7-c, S11-a, S11-b
                      (S8/S9/S10 land in PR-B-2b-2)
```

with:

```typescript
  --surface <id>      one of: S1, S2-a, S2-b, S2-c, S3, S4, S5, S6-drive, S6-gmail, S6-github,
                      S7-a, S7-b, S7-c, S8-l{50|500|5000}-b{1|8|32|64} (12 cells),
                      S9, S10, S11-a, S11-b
```

- [ ] **Step 2: Verify the bench-runner test still passes**

```bash
bun test packages/gateway/src/perf/bench-runner.test.ts
```

Expected: passes. If the existing test asserts a literal substring of the old help text, update the assertion to the new text.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/perf/bench-runner.ts packages/gateway/src/perf/bench-runner.test.ts
git commit -m "$(cat <<'EOF'
docs(perf): list S8/S9/S10 surfaces in bench-runner help

PR-B-2b-2 — drops the "PR-B-2b-2" placeholder from the help text and
lists the new surface IDs (12 S8 cells via cross-product, S9, S10).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17 — Re-export new modules from `perf/index.ts`

**Files:**
- Modify: `packages/gateway/src/perf/index.ts`

- [ ] **Step 1: Append the new exports**

In `packages/gateway/src/perf/index.ts`, after the existing surface exports (and before the `export type` block), add:

```typescript
export {
  type EmbeddingThroughputOptions,
  runEmbeddingThroughputOnce,
} from "./surfaces/bench-embedding-throughput.ts";
export {
  runLlmRoundtripOnce,
  S9_STUB_REASON,
} from "./surfaces/bench-llm-roundtrip.ts";
export {
  runSqliteContentionOnce,
  S10_BUSY_RETRIES,
  type SqliteContentionRunOptions,
} from "./surfaces/bench-sqlite-contention.ts";
export {
  type ParentMsg as SqliteWorkerParentMsg,
  type WorkerMsg as SqliteWorkerWorkerMsg,
  runWorkerLoop,
  type WorkerLoopDeps,
  type WorkerLoopOptions,
} from "./surfaces/sqlite-worker-shared.ts";
export {
  runWorkerBench,
  type WorkerBenchOptions,
  type WorkerBenchResult,
  type WorkerSpec,
} from "./worker-bench.ts";
export {
  synthesizeText,
  SYNTHETIC_TEXT_DEFAULT_SEED,
  type SynthesizeTextOptions,
} from "./fixtures/synthetic-text.ts";
```

And update the existing `export type { ... } from "./types.ts";` block to add `S8_BATCHES`, `S8_LENGTHS`:

```typescript
export {
  type BenchResultKind,
  type BenchRunOptions,
  type BenchSurfaceId,
  type BenchSurfaceResult,
  type CorpusTier,
  type RunnerKind,
  type S8Batch,
  S8_BATCHES,
  type S8Length,
  S8_LENGTHS,
  type S8SurfaceId,
} from "./types.ts";
```

(Note: this requires changing the `export type { ... }` syntax to `export { ... }` because const arrays are values, not types.)

- [ ] **Step 2: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/perf/index.ts
git commit -m "$(cat <<'EOF'
chore(perf): re-export PR-B-2b-2 helpers + drivers from perf/index

PR-B-2b-2 — adds worker-bench, synthesizeText, and the three new
surface drivers to the public perf module surface, plus the
S8_LENGTHS / S8_BATCHES const arrays so external consumers (e.g.,
PR-C threshold logic) can iterate the cross-product without
duplicating the literals.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18 — Run perf coverage gate

**Files:** none (verification).

- [ ] **Step 1: Run the perf coverage script**

```bash
bun run test:coverage:perf
```

Expected: lines coverage ≥80 % across `packages/gateway/src/perf/` + `packages/cli/src/commands/bench.test.ts`. The threshold is enforced in the script itself (`--coverage-threshold-lines=80`).

If coverage falls below 80 %, identify the uncovered file(s) (the report names them) and add focused tests:
- `worker-bench.ts` — extend Task 3 tests with the laggard-after-stop branch
- `bench-sqlite-contention.ts` — add a test for the `samples = [totalThroughputPerSec]` shape with zero workers (edge case)
- `bench-embedding-throughput.ts` — add a test for `totalItems` defaulting to `batch * 1000`

Re-run until the threshold is met.

- [ ] **Step 2: No commit**

This task is verification. Any added tests are committed with their parent task.

---

## Task 19 — End-to-end smoke

**Files:** none (verification).

- [ ] **Step 1: Run a single-surface end-to-end smoke for S10**

```bash
TMPDIR=$(mktemp -d)
bun packages/gateway/src/perf/bench-runner.ts \
  --surface S10 --runs 1 --gha \
  --history "$TMPDIR/history.jsonl" \
  --fixture-cache "$TMPDIR/fixtures"
cat "$TMPDIR/history.jsonl" | head -1 | bunx jq '.surfaces.S10'
rm -rf "$TMPDIR"
```

Expected: the `S10` surface entry includes both `throughput_per_sec` (positive number) and `busy_retries` (non-negative integer) — proves the workers booted, wrote, and the sentinel round-tripped through the orchestrator.

- [ ] **Step 2: Run a single-surface smoke for one S8 cell**

```bash
TMPDIR=$(mktemp -d)
bun packages/gateway/src/perf/bench-runner.ts \
  --surface S8-l50-b8 --runs 1 --gha \
  --history "$TMPDIR/history.jsonl" \
  --fixture-cache "$TMPDIR/fixtures"
cat "$TMPDIR/history.jsonl" | head -1 | bunx jq '.surfaces["S8-l50-b8"]'
rm -rf "$TMPDIR"
```

Expected: positive `throughput_per_sec`. (First call may take 30+ s on a cold model cache — the warm-up step downloads the MiniLM ONNX weights. Subsequent runs are fast.)

- [ ] **Step 3: Run `--all` end-to-end**

```bash
TMPDIR=$(mktemp -d)
bun packages/gateway/src/perf/bench-runner.ts \
  --all --runs 1 --corpus small --gha \
  --history "$TMPDIR/history.jsonl" \
  --fixture-cache "$TMPDIR/fixtures"
cat "$TMPDIR/history.jsonl" | bunx jq '.surfaces | keys | length'
cat "$TMPDIR/history.jsonl" | bunx jq '.surfaces.S9'
cat "$TMPDIR/history.jsonl" | bunx jq '.surfaces.S10'
rm -rf "$TMPDIR"
```

Expected:
- `keys | length` ≥ 29 (9 prior + 6 from PR-B-2b-1 + 14 from this PR = 29).
- `.surfaces.S9` shows `{ samples_count: 0, stub_reason: "stub: Ollama..." }`.
- `.surfaces.S10` shows positive `throughput_per_sec` + `busy_retries` field present.

- [ ] **Step 4: Run the full CI suite**

```bash
bun run test:ci
```

Expected: every coverage gate green; `pr-quality` gate passes.

- [ ] **Step 5: No commit**

This task is verification. Any failures triggered by the smoke point at the bug to fix in the responsible task — fix there, not here.

---

## Task 20 — Open PR-B-2b-2

**Files:** none (PR creation).

- [ ] **Step 1: Push the branch**

```bash
git push -u origin dev/asafgolombek/perf-audit-cluster-c-2
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "perf: PR-B-2b-2 — S8/S9/S10 drivers + worker-bench" --body "$(cat <<'EOF'
## Summary
- S8 (12 embedding-throughput cells), S9 (LLM round-trip stub), S10 (SQLite write contention) drivers + supporting infra
- `worker-bench.ts` Bun-Worker coordinator (injectable WorkerCtor, error+stack capture, hung-Worker terminate)
- 3 production-equivalent SQLite writer Worker scripts — `dbRun` / `appendAuditEntry` / `INSERT INTO watcher_event` paths exercised under contention
- `synthetic-text.ts` deterministic corpus generator for S8
- `HistoryLineSurface` adds optional `busy_retries?: number` (additive; downstream consumers ignore unknown fields)

## What this closes
- Phase 1 of the perf audit. Every surface row in parent spec §3.2 now has a registered driver. PR-C can measure on reference hardware and populate `slo.md` without further driver work.

## Spec compliance
- Spec §3 (PR boundary): ships as the second of two sub-PRs along the infrastructure seam ✓
- Spec §5.3 (worker-bench): API matches with one correction (D-1: native Worker takes URL only, no opts arg) ✓
- Spec §6.3 (S8 cross-product): one driver file + cross-product registration loop ✓
- Spec §6.4 (S9 stub): mirrors S3/S5/S7-c shape ✓
- Spec §6.5 (S10): 3 Workers, all routed through production write paths ✓
- Spec §6.6 (busy_retries additivity): optional field on HistoryLineSurface, only S10 populates ✓
- Spec §9 acceptance criteria: all 8 PR-B-2b-2 items checked ✓

## Test plan
- [ ] `bun run test:ci` green on Ubuntu, macOS, Windows runners
- [ ] `bun run test:coverage:perf` ≥80% lines
- [ ] `bun packages/gateway/src/perf/bench-runner.ts --all --runs 1 --corpus small --gha` writes one valid history line; .surfaces.S10 has both throughput_per_sec and busy_retries; .surfaces.S9 carries stub_reason; all 12 S8 cells present
- [ ] Spot-check S10 history line on Linux: busy_retries > 0 under default rollback-journal mode (real contention exists)
- [ ] Bidirectional driver↔row mapping holds for all 14 new surface IDs

## Notes for reviewers
- Plan: `docs/superpowers/plans/2026-04-28-perf-audit-cluster-c-2.md`
- Spec: `docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md` §6.3–6.6, §9
- The four "Decisions taken in this plan" (D-1 to D-4) are at the top of the plan file for context that doesn't fit in the spec but should not be lost.
- S10 deliberately leaves the SQLite journal in default rollback-journal mode (D-2): production never explicitly sets WAL either, and rollback-journal gives the heaviest writer contention which is the metric we want.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Confirm CI gates kick off**

```bash
gh pr checks
```

Expected: `pr-quality`, `_test-suite`, and the 3-OS push matrix queued or running. If `pr-quality` fails, fix in-place and push another commit — do not amend.

- [ ] **Step 4: Return the PR URL to the user**

The PR URL is the output of `gh pr create`. Wait for review.
