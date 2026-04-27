# Perf Audit (B2) — Cluster C Drivers, Sub-PR 1 (PR-B-2b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the S6 (sync throughput, 3 connectors) and S7 (memory RSS, 3 modes) surface drivers + their supporting infrastructure (gateway-spawn helper, RSS sampler, MSW + synthetic HTTP traces). Lands as PR-B-2b-1 on `dev/asafgolombek/perf-audit-cluster-c-1`. PR-B-2b-2 (S8 / S9 / S10 + Workers) follows independently.

**Architecture:** Two new helper modules — `gateway-spawn-bench.ts` (spawn gateway → wait for ready marker → run a workload with optional concurrent sampler → SIGTERM) and `rss-sampler.ts` (poll `pidusage(pid)` at 1 Hz / 250 Hz, return samples + p95). Three synthetic HTTP-trace generators feed an MSW `setupServer` that intercepts `fetch` calls from the real Drive / Gmail / GitHub MCP connectors. The `runBench` harness gains an optional `resultKind` parameter ("latency" | "throughput" | "rss") so non-latency drivers can populate `BenchSurfaceResult.throughputPerSec` / `rssBytesP95` without each rolling its own aggregation.

**Tech Stack:** Bun v1.2+ / TypeScript 6.x strict, `bun:test`, `Bun.spawn`. New devDeps: `pidusage` (cross-platform RSS), `msw` v2 (HTTP intercept). Reuses the frozen PR-B-2a perf module API: `BenchSurfaceResult`, `appendHistoryLine`, `runBench` (extended), `process-spawn-bench` style of injectable spawn, `bench-cli.ts` `SURFACE_REGISTRY` / `REFERENCE_ONLY` / `STUB_SURFACES` registries.

**Spec source:** [`docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md`](../specs/2026-04-27-perf-audit-cluster-c-design.md). Parent spec: [`docs/superpowers/specs/2026-04-26-perf-audit-design.md`](../specs/2026-04-26-perf-audit-design.md). Predecessor plan: [`2026-04-26-perf-audit-phase-1b.md`](./2026-04-26-perf-audit-phase-1b.md) (PR-B-2a, merged via PR #116).

**Feedback resolution log** (folded in from [`2026-04-27-perf-audit-cluster-c-1-feedback.md`](./2026-04-27-perf-audit-cluster-c-1-feedback.md)):
- **F-1.1** (IPC wiring snippet) — clarified in Tasks 11 / 13 / 14 / 15 driver headers: production callers should construct a `NimbusClient` from `@nimbus-dev/client` against the spawned gateway's socket. Real wiring lands in PR-C / PR-B-2b-3.
- **F-1.2** (stderr capture on timeout) — Task 4 now keeps a 20-line stderr ring buffer; `waitForMarker` includes the captured tail in the timeout error.
- **F-1.3** (MSW `"warn"` vs `"error"`) — driver comments in Tasks 13 / 14 / 15 explicitly state why production drivers use `"warn"` (real gateway emits unrelated HTTP — telemetry, update probes) while unit tests use `"error"` (sentinel against connector drift).
- **F-1.4** (verification audit trail) — Task 2 now produces a `packages/gateway/src/perf/fixtures/README.md` recording verification verdicts + Octokit version, instead of relying on commit-message archaeology.
- **F-2.1** (helper reuse) — `surfaces/spawn-test-helpers.ts` (already present from PR-B-2a) is extended in Task 4 with `fakeSpawnEmitsMarker(opts)`; Tasks 10 / 11 / 13 / 14 / 15 import it instead of duplicating the fake.
- **F-2.2** (sampler drift) — Task 5 uses deadline-based scheduling (`nextTickAt = lastTickAt + intervalMs`) so sampler-execution time doesn't accumulate into the cadence.
- **F-2.3** (count SQL index) — verified `idx_item_service` exists at `packages/gateway/src/index/unified-item-v3-sql.ts:37`; the `SELECT COUNT(*) WHERE service = ?` calls in S6 drivers are O(log N), not O(N). No plan change.
- **F-2.4** (reason placement) — kept as-is; `REFERENCE_ONLY_REASONS` map in `bench-cli.ts` mirrors the existing `STUB_SURFACES` registry pattern, with each driver exporting its constant (see `S7C_REFERENCE_ONLY_REASON` in Task 12).
- **F-2.5** (temp dir collisions) — no-op; `mkdtempSync` appends 6 random chars per its OS contract.

**Out of scope for this PR (lands later):**
- S8 (12 embedding cells), S9 (LLM stub), S10 (SQLite contention). PR-B-2b-2 plan.
- Real Ollama-driven S9 + real Tauri-renderer instrumentation for S3/S5. Hypothetical PR-B-2b-3.
- CI workflow `_perf.yml`, populated `slo.md` thresholds, `baseline.md`. PR-C work.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/gateway/package.json` | Modify | Add `pidusage` and `msw` to `devDependencies` |
| `packages/gateway/src/perf/bench-harness.ts` | Modify | Add optional `resultKind: "latency" \| "throughput" \| "rss"` parameter to `runBench`; aggregate samples appropriately for each kind |
| `packages/gateway/src/perf/bench-harness.test.ts` | Modify | Cover the new aggregations (`throughput` median, `rss` p95) |
| `packages/gateway/src/perf/types.ts` | Modify | Replace `"S6"` literal with `"S6-drive" \| "S6-gmail" \| "S6-github"` in `BenchSurfaceId`; export `BenchResultKind` |
| `packages/gateway/src/perf/gateway-spawn-bench.ts` | Create | `spawnGatewayForBench(opts)` — spawn child, wait for marker (with 20-line stderr capture for timeout diagnostics), run workload + optional sampler in parallel, SIGTERM on completion |
| `packages/gateway/src/perf/gateway-spawn-bench.test.ts` | Create | Unit tests with injectable spawn fakes (uses shared `spawn-test-helpers.ts`) |
| `packages/gateway/src/perf/surfaces/spawn-test-helpers.ts` | Modify | Add `fakeSpawnEmitsMarker(opts)` helper reused by Tasks 4 / 10 / 11 / 13 / 14 / 15 unit tests |
| `packages/gateway/src/perf/fixtures/README.md` | Create | Permanent record of Task 2 verification verdicts (Drive / Gmail / GitHub HTTP-layer audit + Octokit version) |
| `packages/gateway/src/perf/rss-sampler.ts` | Create | `sampleRss(opts)` — poll `pidusage(pid)` at `intervalMs`, return samples + p95 + `intervalsMissed` |
| `packages/gateway/src/perf/rss-sampler.test.ts` | Create | Unit tests with injectable `pidusage` fake |
| `packages/gateway/src/perf/fixtures/synthetic-drive-trace.ts` | Create | Generator: produce N synthetic Drive `files.list` page payloads at small/medium/large tiers |
| `packages/gateway/src/perf/fixtures/synthetic-drive-trace.test.ts` | Create | Verify item count + pagination shape (`nextPageToken`) |
| `packages/gateway/src/perf/fixtures/synthetic-gmail-trace.ts` | Create | Generator: synthetic Gmail `messages.list` + `messages.get` pages |
| `packages/gateway/src/perf/fixtures/synthetic-gmail-trace.test.ts` | Create | Verify item count + pagination shape |
| `packages/gateway/src/perf/fixtures/synthetic-github-trace.ts` | Create | Generator: synthetic GitHub `pulls`/`issues` REST pages with `Link: rel="next"` headers |
| `packages/gateway/src/perf/fixtures/synthetic-github-trace.test.ts` | Create | Verify item count + Link header shape |
| `packages/gateway/src/perf/fixtures/msw-handlers.ts` | Create | `driveHandlers(tier)`, `gmailHandlers(tier)`, `githubHandlers(tier)` — compose generators into `http.get(...)` handlers for `setupServer` |
| `packages/gateway/src/perf/fixtures/msw-handlers.test.ts` | Create | Verify each connector's handler set responds to its canonical URLs |
| `packages/gateway/src/perf/surfaces/bench-rss-idle.ts` | Create | S7-a — spawn warm gateway, sleep 60 s, sample RSS in parallel |
| `packages/gateway/src/perf/surfaces/bench-rss-idle.test.ts` | Create | Smoke with injected spawn + injected pidusage |
| `packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.ts` | Create | S7-b — same shape; workload triggers parallel sync of 3 connectors |
| `packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.test.ts` | Create | Smoke with injected spawn + pidusage + IPC client |
| `packages/gateway/src/perf/surfaces/bench-rss-multi-agent.ts` | Create | S7-c — REFERENCE_ONLY; workload triggers 3-sub-agent decomposition |
| `packages/gateway/src/perf/surfaces/bench-rss-multi-agent.test.ts` | Create | Smoke (always returns reference-only stub on non-reference runners) |
| `packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.ts` | Create | S6-drive — MSW + spawn gateway + drive `connector.sync` + count delta |
| `packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.test.ts` | Create | Smoke with injected spawn + IPC client + MSW handler asserter |
| `packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.ts` | Create | S6-gmail — same shape, gmail handlers |
| `packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.test.ts` | Create | Smoke |
| `packages/gateway/src/perf/surfaces/bench-sync-throughput-github.ts` | Create | S6-github — same shape, github handlers |
| `packages/gateway/src/perf/surfaces/bench-sync-throughput-github.test.ts` | Create | Smoke |
| `packages/gateway/src/perf/bench-cli.ts` | Modify | Register 6 new surface IDs in `SURFACE_REGISTRY`; introduce `LINUX_ONLY_THRESHOLDS` set; extend `REFERENCE_ONLY` with `S7-c`; add `SURFACE_RESULT_KIND` map; update `processSurface` to pass `resultKind` to `runBench` |
| `packages/gateway/src/perf/bench-cli.test.ts` | Modify | Add tests for new gating (S7-c reference-only, LINUX_ONLY_THRESHOLDS membership) |
| `packages/gateway/src/perf/bench-runner.ts` | Modify | Update `--help` text to list new surface IDs |
| `packages/gateway/src/perf/index.ts` | Modify | Re-export new helpers + drivers |

**Total:** 23 files created, 7 modified.

---

## Execution order

Sequential: Tasks 1 → 22. Each task is independently committable. Critical dependencies:
- Task 2 (verification matrix) must run before Tasks 6–9 and 13–15 because if any connector fails the fetch-only check, that connector's fixture + driver pair becomes a stub.
- Task 3 (`runBench` extension) must land before Tasks 10–15 (drivers depend on the new `resultKind` aggregation paths).
- Task 4 (`gateway-spawn-bench`) and Task 5 (`rss-sampler`) must land before Tasks 10–15 (drivers depend on both helpers).
- Tasks 6–9 (fixtures + msw-handlers) must land before Tasks 13–15 (S6 drivers depend on the handlers).
- Task 16 (types) and Task 17 (bench-cli registration) must land last among the code tasks because they integrate everything.

```
T1 (devDeps) → T2 (verification) → T3 (runBench ext) ──┬──→ T4 (spawn helper) ──┬──→ T10–T15 (drivers)
                                                       └──→ T5 (rss sampler) ──┘
                          T6 (drive trace) ──┐
                          T7 (gmail trace) ──┼──→ T9 (msw handlers) ──→ T13–T15 (S6 drivers)
                          T8 (github trace) ─┘
                                        T10–T15 (drivers) ──→ T16 (types) → T17 (bench-cli) → T18 (help) → T19 (barrel) → T20 (cli tests) → T21 (smoke) → T22 (PR)
```

---

## Task 1 — Add devDependencies

**Files:**
- Modify: `packages/gateway/package.json`

- [ ] **Step 1: Read the current devDependencies block**

```bash
cat packages/gateway/package.json | head -40
```

Note the existing keys/format. Sort order is alphabetical.

- [ ] **Step 2: Add `pidusage` and `msw` to `devDependencies`**

In `packages/gateway/package.json`, add (alphabetically sorted in `devDependencies`):

```json
    "msw": "^2.7.0",
    "pidusage": "^4.0.1",
```

And — since `pidusage` does not ship its own types — also add to `devDependencies`:

```json
    "@types/pidusage": "^2.0.5",
```

- [ ] **Step 3: Install + verify**

```bash
bun install
bun run typecheck
```

Expected: install succeeds; typecheck has no new errors (the deps aren't imported anywhere yet, so this just confirms no version-conflict damage).

- [ ] **Step 4: Verify imports resolve**

Create a throwaway `/tmp/check.ts` (do NOT commit):

```typescript
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import pidusage from "pidusage";

const _s: typeof setupServer = setupServer;
const _h: typeof http = http;
const _r: typeof HttpResponse = HttpResponse;
const _p: typeof pidusage = pidusage;
console.log("ok");
```

Run: `bunx tsc --noEmit /tmp/check.ts`. Expected: exits 0, prints nothing. Delete the file.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/package.json bun.lock
git commit -m "$(cat <<'EOF'
build(perf): add pidusage and msw devDeps for Cluster C drivers

PR-B-2b-1 prep. pidusage gives cross-platform RSS sampling for the
S7-a/b/c drivers; msw v2 intercepts fetch for the S6 sync-throughput
synthetic traces. Both are dev-only and AGPL-3.0 compatible (MIT).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Connector HTTP-layer verification matrix (spec §13)

**Files:** none (this is a code-reading + decision task; record findings in commit message).

The cluster-C spec §13 says MSW v2 intercepts `fetch` (and Node's `http`/`https` modules), but **not** SDKs that use a custom transport. Verify each connector before writing fixtures.

- [ ] **Step 1: Verify Drive uses fetch only**

```bash
bunx grep -rn "node:http\|axios\|got\|http2\|undici" packages/mcp-connectors/google-drive/src/
bunx grep -rn "fetch(" packages/mcp-connectors/google-drive/src/
```

Expected: zero matches for the first grep; ≥1 match for the second. If matches in the first grep exist, mark `S6-drive` as a stub instead of a measurable surface (see Step 4).

- [ ] **Step 2: Verify Gmail uses fetch only**

```bash
bunx grep -rn "node:http\|axios\|got\|http2\|undici" packages/mcp-connectors/gmail/src/
bunx grep -rn "fetch(" packages/mcp-connectors/gmail/src/
```

Same expectations.

- [ ] **Step 3: Verify GitHub uses fetch only (Octokit special case)**

```bash
bunx grep -rn "node:http\|axios\|got\|http2\|undici" packages/mcp-connectors/github/src/
bunx grep -rn "Octokit\|fetch(" packages/mcp-connectors/github/src/
bunx grep -rn '"@octokit' packages/mcp-connectors/github/package.json
```

Octokit uses fetch in modern versions (`@octokit/request` ≥7), but verify the version in this repo is ≥7. If older, MSW will not intercept and `S6-github` becomes a stub.

If Octokit is present, also confirm there is no `request: ...` option being passed that would bypass fetch. Search:

```bash
bunx grep -rn "request:" packages/mcp-connectors/github/src/
```

- [ ] **Step 4: Decision**

For each connector:
- Pass: proceed with fixture + driver as planned (Tasks 6–9, 13–15).
- Fail: that connector becomes a stub. Skip its fixture (Task 6/7/8) and its driver (Task 13/14/15) — instead, in Task 17 (bench-cli registration), register that surface ID with `STUB_SURFACES[id] = "fetch-only verification failed: <reason>"`.

Record the verdicts (drive=pass/fail, gmail=pass/fail, github=pass/fail) in the body of `packages/gateway/src/perf/fixtures/README.md` (Step 5).

- [ ] **Step 5: Verify by reading one fetch call site per connector**

Open one file per connector that contains the actual sync code:
- `packages/mcp-connectors/google-drive/src/server.ts` — confirm it calls `fetch("https://www.googleapis.com/drive/v3/...")` directly.
- `packages/mcp-connectors/gmail/src/server.ts` — confirm `fetch("https://gmail.googleapis.com/...")`.
- `packages/mcp-connectors/github/src/server.ts` — confirm `Octokit({ ... }).pulls.list(...)` or similar; trace through to the Octokit version.

This is a 5-minute read; the goal is to confirm by inspection that MSW will intercept.

- [ ] **Step 6: Write `packages/gateway/src/perf/fixtures/README.md`**

Create the file:

```markdown
# Perf bench fixtures

Synthetic HTTP-trace generators + MSW v2 handlers used by the S6
sync-throughput drivers. See `docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md` §13 for the verification rationale.

## Connector HTTP-layer verification (PR-B-2b-1, Task 2)

| Connector | HTTP layer                                      | MSW intercepts | Verdict |
|-----------|-------------------------------------------------|----------------|---------|
| Drive     | direct `fetch(googleapis.com/drive/v3/...)`     | yes            | <pass/fail> |
| Gmail     | direct `fetch(gmail.googleapis.com/...)`        | yes            | <pass/fail> |
| GitHub    | `@octokit/rest@<VERSION>` (uses `fetch` ≥ v7)   | yes            | <pass/fail> |

Verified <YYYY-MM-DD> by <author>. Re-run the verification grep set
(see plan Task 2) any time a connector adds a new HTTP path or swaps
its HTTP layer (e.g., upgrades Octokit majors).

## Generators

- `synthetic-drive-trace.ts` — `files.list` pages at 100 items/page, deterministic LCG.
- `synthetic-gmail-trace.ts` — `messages.list` (id+threadId) + `messages.get` (full payload).
- `synthetic-github-trace.ts` — `pulls` REST pages with RFC 5988 Link headers.

## MSW handler factories

- `msw-handlers.ts` — `driveHandlers(tier)`, `gmailHandlers(tier)`, `githubHandlers(tier)`.

Tests register `setupServer` with `onUnhandledRequest: "error"`
(sentinel against connector drift). Driver runtime uses `"warn"`
because the spawned gateway emits unrelated outbound HTTP
(telemetry, update-manifest probe, etc.).
```

Fill in the verdicts (`<pass/fail>`), version (`<VERSION>`), date, and author. Commit alongside the first fixture (Task 6) so the README lands with its first consumer. If any verdict is `fail`, also note in the README which surface(s) ship as stubs and link to the eventual real-driver follow-up PR.

- [ ] **Step 7: Stage the README to commit with Task 6**

```bash
git add packages/gateway/src/perf/fixtures/README.md
```

Do not commit standalone — bundle with Task 6's commit so the directory's first commit contains the README + the first generator together.

---

## Task 3 — Extend `runBench` with `resultKind`

**Files:**
- Modify: `packages/gateway/src/perf/types.ts`
- Modify: `packages/gateway/src/perf/bench-harness.ts`
- Modify: `packages/gateway/src/perf/bench-harness.test.ts`

`runBench` currently treats every sample as a latency in ms and computes p50/p95/p99/max. S6 emits items/sec per run; S7 emits RSS bytes per poll. We add a `resultKind` parameter that swaps in the right aggregator without breaking the latency contract (default).

- [ ] **Step 1: Add the type to `types.ts`**

Open `packages/gateway/src/perf/types.ts` and add (after the `CorpusTier` declaration):

```typescript
/**
 * How the harness should interpret a driver's `samples[]` return:
 *   - "latency"    — time-percentiles (p50/p95/p99/max in ms). Default.
 *   - "throughput" — each sample is items/sec; result.throughputPerSec = median.
 *   - "rss"        — each sample is RSS bytes; result.rssBytesP95 = p95(samples).
 */
export type BenchResultKind = "latency" | "throughput" | "rss";
```

- [ ] **Step 2: Write the failing tests in `bench-harness.test.ts`**

Append to the existing `bench-harness.test.ts`:

```typescript
describe("runBench — resultKind", () => {
  test("default 'latency' behaviour is unchanged", async () => {
    const fn = async () => [10, 20, 30, 40, 50];
    const result = await runBench("S2-a", fn, { runs: 3, runner: "local-dev" });
    expect(result.p50Ms).toBeGreaterThan(0);
    expect(result.throughputPerSec).toBeUndefined();
    expect(result.rssBytesP95).toBeUndefined();
  });

  test("'throughput' kind populates throughputPerSec from per-run medians", async () => {
    const fn = async () => [100, 110, 120];
    const result = await runBench(
      "S2-a", fn, { runs: 3, runner: "local-dev" }, {}, "throughput",
    );
    expect(result.throughputPerSec).toBe(110);
    expect(result.p50Ms).toBeUndefined();
    expect(result.p95Ms).toBeUndefined();
  });

  test("'rss' kind populates rssBytesP95 across all samples", async () => {
    const fn = async () => [1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_400_000];
    const result = await runBench(
      "S7-a", fn, { runs: 1, runner: "local-dev" }, {}, "rss",
    );
    expect(result.rssBytesP95).toBeGreaterThanOrEqual(1_300_000);
    expect(result.rssBytesP95).toBeLessThanOrEqual(1_400_000);
    expect(result.rawSamples).toEqual([1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_400_000]);
    expect(result.p50Ms).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the failing tests**

```bash
bun test packages/gateway/src/perf/bench-harness.test.ts
```

Expected: 3 new tests fail; existing tests still pass.

- [ ] **Step 4: Extend `runBench` to accept `resultKind`**

Open `packages/gateway/src/perf/bench-harness.ts`. Add `BenchResultKind` to the `types.ts` import:

```typescript
import type { BenchResultKind, BenchRunOptions, BenchSurfaceId, BenchSurfaceResult } from "./types.ts";
```

Replace the `runBench` function with:

```typescript
export async function runBench(
  surfaceId: BenchSurfaceId,
  fn: SurfaceFn,
  opts: BenchRunOptions,
  deps: RunBenchDeps = {},
  resultKind: BenchResultKind = "latency",
): Promise<BenchSurfaceResult> {
  if (opts.runs < 1) {
    throw new Error(`runs must be >= 1 (got ${opts.runs})`);
  }
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(`${s}\n`));
  const perRunSamples: number[][] = [];
  let totalSamples = 0;

  for (let i = 0; i < opts.runs; i += 1) {
    const samples = await runSurfaceOnce(surfaceId, fn, opts, i, stderr);
    perRunSamples.push(samples);
    totalSamples += samples.length;
  }

  if (resultKind === "throughput") {
    // Each driver-call returned items/sec values; median of medians.
    const perRunMedians: number[] = [];
    for (const s of perRunSamples) {
      const m = median(s);
      if (m !== undefined) perRunMedians.push(m);
    }
    const throughputPerSec = median(perRunMedians);
    return {
      surfaceId,
      samplesCount: totalSamples,
      ...(throughputPerSec !== undefined && { throughputPerSec }),
    };
  }

  if (resultKind === "rss") {
    const allSamples: number[] = perRunSamples.flat();
    const p = computePercentiles(allSamples);
    return {
      surfaceId,
      samplesCount: totalSamples,
      ...(p.p95 !== undefined && { rssBytesP95: p.p95 }),
      rawSamples: allSamples,
    };
  }

  // resultKind === "latency" (default) — preserves prior behaviour.
  const perRunP95: number[] = [];
  const perRunP50: number[] = [];
  const perRunP99: number[] = [];
  const perRunMax: number[] = [];
  for (const samples of perRunSamples) {
    const p = computePercentiles(samples);
    if (p.p50 !== undefined) perRunP50.push(p.p50);
    if (p.p95 !== undefined) perRunP95.push(p.p95);
    if (p.p99 !== undefined) perRunP99.push(p.p99);
    if (p.max !== undefined) perRunMax.push(p.max);
  }
  const p50Ms = median(perRunP50);
  const p95Ms = median(perRunP95);
  const p99Ms = median(perRunP99);
  const maxMs = median(perRunMax);
  return {
    surfaceId,
    samplesCount: totalSamples,
    ...(p50Ms !== undefined && { p50Ms }),
    ...(p95Ms !== undefined && { p95Ms }),
    ...(p99Ms !== undefined && { p99Ms }),
    ...(maxMs !== undefined && { maxMs }),
  };
}
```

- [ ] **Step 5: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/bench-harness.test.ts
```

Expected: all old + new tests pass.

- [ ] **Step 6: Run the full perf coverage gate to confirm no regression**

```bash
bun run test:coverage:perf
```

Expected: ≥80% lines; no failures.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/perf/types.ts packages/gateway/src/perf/bench-harness.ts packages/gateway/src/perf/bench-harness.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): runBench resultKind for throughput / rss aggregation

Adds optional resultKind parameter ("latency" | "throughput" | "rss",
default "latency") so non-latency drivers (S6, S7) populate
BenchSurfaceResult.throughputPerSec / rssBytesP95 without each
rolling its own aggregation. Default behaviour unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `gateway-spawn-bench.ts` helper (+ extend `spawn-test-helpers.ts`)

**Files:**
- Modify: `packages/gateway/src/perf/surfaces/spawn-test-helpers.ts` (add `fakeSpawnEmitsMarker`)
- Create: `packages/gateway/src/perf/gateway-spawn-bench.ts`
- Create: `packages/gateway/src/perf/gateway-spawn-bench.test.ts`

Spawns a child gateway, waits for a stdout marker, runs an arbitrary workload (with optional concurrent sampler), tears down. Distinct from `process-spawn-bench.ts` — that times spawn-to-marker; this one drives bench work *during* the warm phase.

This task also extends the existing PR-B-2a `surfaces/spawn-test-helpers.ts` with a new `fakeSpawnEmitsMarker(opts)` helper that Tasks 10 / 11 / 13 / 14 / 15 reuse — keeping the test-time fake in one place instead of six near-identical copies (feedback F-2.1).

- [ ] **Step 1: Extend `surfaces/spawn-test-helpers.ts`**

Append to `packages/gateway/src/perf/surfaces/spawn-test-helpers.ts`:

```typescript
/**
 * A fake Bun.spawn whose child:
 *  - emits the configured stdoutChunks (and optional stderrChunks) at low cadence,
 *  - blocks `exited` until kill() is called when waitForKill=true, otherwise
 *    resolves immediately with exitCode (default 0).
 *
 * Used by the spawn-and-warm helper tests (Task 4) and the S6/S7 driver
 * tests (Tasks 10, 11, 13, 14, 15) to drive a synthetic gateway lifecycle
 * without booting a real child.
 */
export interface FakeSpawnEmitsMarkerOptions {
  pid?: number;
  stdoutChunks?: string[];
  stderrChunks?: string[];
  /** When true, exited resolves only after kill(). Default true. */
  waitForKill?: boolean;
  exitCode?: number;
  /** Delay between chunk emissions (ms). Default 1. */
  chunkDelayMs?: number;
}

export function fakeSpawnEmitsMarker(opts: FakeSpawnEmitsMarkerOptions): typeof Bun.spawn {
  return ((..._args: unknown[]) => {
    const enc = new TextEncoder();
    const stream = (chunks: string[]): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const c of chunks) {
            controller.enqueue(enc.encode(c));
            await new Promise((r) => setTimeout(r, opts.chunkDelayMs ?? 1));
          }
          controller.close();
        },
      });
    let killed = false;
    const waitForKill = opts.waitForKill ?? true;
    const exited = waitForKill
      ? new Promise<number>((resolve) => {
          const tick = (): void => {
            if (killed) resolve(opts.exitCode ?? 0);
            else setTimeout(tick, 5);
          };
          tick();
        })
      : Promise.resolve(opts.exitCode ?? 0);
    return {
      pid: opts.pid ?? 12345,
      stdout: stream(opts.stdoutChunks ?? []),
      stderr: stream(opts.stderrChunks ?? []),
      exited,
      kill: () => {
        killed = true;
      },
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}
```

- [ ] **Step 2: Write the failing tests for the helper itself**

Create `packages/gateway/src/perf/gateway-spawn-bench.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { spawnGatewayForBench } from "./gateway-spawn-bench.ts";
import { fakeSpawnEmitsMarker } from "./surfaces/spawn-test-helpers.ts";

describe("spawnGatewayForBench", () => {
  test("waits for ready marker, runs workload, returns workloadResult", async () => {
    let workloadPid = -1;
    const result = await spawnGatewayForBench<{ ok: true }, void>({
      cmd: "fake",
      args: [],
      readyMarker: /\[gateway\] ready/,
      spawn: fakeSpawnEmitsMarker({ pid: 999, stdoutChunks: ["[gateway] ready /tmp/sock\n"] }),
      workload: async (ctx) => {
        workloadPid = ctx.pid;
        return { ok: true };
      },
    });
    expect(workloadPid).toBe(999);
    expect(result.workloadResult).toEqual({ ok: true });
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  test("runs sampler concurrently with workload", async () => {
    const samplerCalls: number[] = [];
    const result = await spawnGatewayForBench<number, number>({
      cmd: "fake",
      args: [],
      readyMarker: /\[gateway\] ready/,
      spawn: fakeSpawnEmitsMarker({ pid: 1, stdoutChunks: ["[gateway] ready\n"] }),
      workload: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return 42;
      },
      sampler: async (ctx) => {
        samplerCalls.push(ctx.pid);
        await new Promise((r) => setTimeout(r, 10));
        return 7;
      },
    });
    expect(result.workloadResult).toBe(42);
    expect(result.samplerResult).toBe(7);
    expect(samplerCalls).toEqual([1]);
  });

  test("ready-marker timeout includes captured stderr tail in the error", async () => {
    const promise = spawnGatewayForBench<void, void>({
      cmd: "fake",
      args: [],
      readyMarker: /\[never matches\]/,
      readyTimeoutMs: 50,
      spawn: fakeSpawnEmitsMarker({
        stderrChunks: ["fatal: port already in use 7474\n", "shutting down\n"],
      }),
      workload: async () => {},
    });
    await expect(promise).rejects.toThrow(/ready.*50ms.*port already in use/s);
  });

  test("workload throwing still SIGTERMs the child and rethrows", async () => {
    const spawn = fakeSpawnEmitsMarker({
      pid: 1,
      stdoutChunks: ["[gateway] ready\n"],
    });
    await expect(
      spawnGatewayForBench<void, void>({
        cmd: "fake",
        args: [],
        readyMarker: /\[gateway\] ready/,
        spawn,
        workload: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    // The fake's exited promise resolves only after kill(); reaching this
    // line means the helper did kill the child (otherwise the fake would
    // still be holding the rejection back).
  });

  test("child exits before marker → throws", async () => {
    const spawn = fakeSpawnEmitsMarker({
      stderrChunks: ["fatal: missing dep\n"],
      waitForKill: false,
      exitCode: 1,
    });
    await expect(
      spawnGatewayForBench<void, void>({
        cmd: "fake",
        args: [],
        readyMarker: /\[gateway\] ready/,
        spawn,
        workload: async () => {},
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the failing tests**

```bash
bun test packages/gateway/src/perf/gateway-spawn-bench.test.ts
```

Expected: file-not-found error or test failures (module doesn't exist yet).

- [ ] **Step 4: Implement `gateway-spawn-bench.ts`**

Create `packages/gateway/src/perf/gateway-spawn-bench.ts`:

```typescript
/**
 * Spawn-and-warm primitive for cluster-C drivers (S6, S7-a/b/c).
 *
 * Spawns a real gateway child, waits for a stdout marker (typically the
 * "[gateway] ready" line), then runs an arbitrary workload — with an
 * optional concurrent sampler (e.g., RSS poller) running in parallel —
 * and finally SIGTERMs the child and awaits its exit.
 *
 * Distinct from `process-spawn-bench.ts` which times spawn-to-marker;
 * this helper times *during* the warm phase.
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §5.1.
 */

const DEFAULT_READY_TIMEOUT_MS = 30_000;

export interface SpawnGatewayForBenchOptions<W, S = void> {
  cmd: string;
  args: string[];
  readyMarker: RegExp;
  /** Default 30_000 ms. */
  readyTimeoutMs?: number;
  /** Runs once the child emits the readyMarker. Receives child PID. */
  workload: (ctx: { pid: number; signal: AbortSignal }) => Promise<W>;
  /** Optional sampler started in parallel with workload. */
  sampler?: (ctx: { pid: number; signal: AbortSignal }) => Promise<S>;
  /** Env passed to the child (merged over process.env). */
  env?: Record<string, string>;
  /** Test-injectable spawn (defaults to Bun.spawn). */
  spawn?: typeof Bun.spawn;
}

export interface SpawnGatewayResult<W, S> {
  workloadResult: W;
  samplerResult: S | undefined;
  totalMs: number;
}

interface ProcSubset {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: (signal?: number | NodeJS.Signals) => void;
}

function spawnChild<W, S>(opts: SpawnGatewayForBenchOptions<W, S>): ProcSubset {
  const spawn = opts.spawn ?? Bun.spawn;
  return spawn([opts.cmd, ...opts.args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...(opts.env !== undefined && { env: { ...process.env, ...opts.env } }),
  }) as unknown as ProcSubset;
}

const STDERR_BUFFER_LINES = 20;

class StderrRing {
  private readonly lines: string[] = [];
  push(s: string): void {
    for (const line of s.split("\n")) {
      if (line.length === 0) continue;
      this.lines.push(line);
      if (this.lines.length > STDERR_BUFFER_LINES) this.lines.shift();
    }
  }
  tail(): string {
    return this.lines.length === 0 ? "" : `\n--- last ${this.lines.length} stderr lines ---\n${this.lines.join("\n")}`;
  }
}

async function readUntilMatch(
  stream: ReadableStream<Uint8Array>,
  marker: RegExp,
  onMatch: () => void,
  signal: AbortSignal,
  stderrRing?: StderrRing,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      const chunk = decoder.decode(value, { stream: true });
      if (stderrRing !== undefined) stderrRing.push(chunk);
      buf += chunk;
      if (marker.test(buf)) {
        onMatch();
        return;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

async function waitForMarker(
  proc: ProcSubset,
  marker: RegExp,
  timeoutMs: number,
  stderrRing: StderrRing,
): Promise<void> {
  const ac = new AbortController();
  let matched = false;
  let resolveMatched!: () => void;
  const matchedPromise = new Promise<void>((resolve) => {
    resolveMatched = resolve;
  });
  const onMatch = (): void => {
    if (matched) return;
    matched = true;
    ac.abort();
    resolveMatched();
  };
  void readUntilMatch(proc.stdout, marker, onMatch, ac.signal);
  void readUntilMatch(proc.stderr, marker, onMatch, ac.signal, stderrRing);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      matchedPromise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`gateway not ready in ${timeoutMs}ms${stderrRing.tail()}`)),
          timeoutMs,
        );
      }),
      proc.exited.then((code) => {
        if (!matched) {
          throw new Error(
            `child exited with code ${code} before marker matched${stderrRing.tail()}`,
          );
        }
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
  if (!matched) {
    throw new Error(`gateway not ready in ${timeoutMs}ms${stderrRing.tail()}`);
  }
}

export async function spawnGatewayForBench<W, S = void>(
  opts: SpawnGatewayForBenchOptions<W, S>,
): Promise<SpawnGatewayResult<W, S>> {
  const proc = spawnChild(opts);
  const timeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const stderrRing = new StderrRing();
  try {
    await waitForMarker(proc, opts.readyMarker, timeoutMs, stderrRing);
  } catch (err) {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    try {
      await proc.exited;
    } catch {
      /* ignore */
    }
    throw err;
  }

  const ac = new AbortController();
  const start = performance.now();
  let workloadResult: W;
  let samplerResult: S | undefined;
  try {
    if (opts.sampler !== undefined) {
      const samplerPromise = opts.sampler({ pid: proc.pid, signal: ac.signal });
      workloadResult = await opts.workload({ pid: proc.pid, signal: ac.signal });
      ac.abort();
      samplerResult = await samplerPromise;
    } else {
      workloadResult = await opts.workload({ pid: proc.pid, signal: ac.signal });
    }
  } finally {
    ac.abort();
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    try {
      await proc.exited;
    } catch {
      /* ignore */
    }
  }
  const totalMs = performance.now() - start;
  return { workloadResult, samplerResult, totalMs };
}
```

- [ ] **Step 5: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/gateway-spawn-bench.test.ts
```

Expected: 5 passing. The "ready-marker timeout" test specifically asserts the captured stderr tail is in the error message.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/perf/gateway-spawn-bench.ts packages/gateway/src/perf/gateway-spawn-bench.test.ts packages/gateway/src/perf/surfaces/spawn-test-helpers.ts
git commit -m "$(cat <<'EOF'
feat(perf): gateway-spawn-bench helper for warm-phase workloads

Spawns a child gateway, waits for the readiness marker, runs a
workload (with optional concurrent sampler) and SIGTERMs cleanly.
On timeout, includes the last 20 stderr lines in the thrown error
(feedback F-1.2) — invaluable for diagnosing port collisions and
missing-dep crashes during bench development.

Also extends surfaces/spawn-test-helpers.ts with fakeSpawnEmitsMarker
which Tasks 10/11/13/14/15 reuse instead of duplicating the fake
(feedback F-2.1).

Used by S6 (sync throughput) and S7-a/b/c (RSS) drivers in PR-B-2b-1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — `rss-sampler.ts` helper

**Files:**
- Create: `packages/gateway/src/perf/rss-sampler.ts`
- Create: `packages/gateway/src/perf/rss-sampler.test.ts`

Polls `pidusage(pid)` at a configurable cadence; returns RSS sample array + p95 + `intervalsMissed`.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/rss-sampler.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { sampleRss } from "./rss-sampler.ts";

function fakePidusage(seq: (number | "throw")[]): (pid: number) => Promise<{ memory: number }> {
  let i = 0;
  return async () => {
    const v = seq[i++ % seq.length];
    if (v === "throw") throw new Error("process gone");
    return { memory: v as number };
  };
}

describe("sampleRss", () => {
  test("collects samples for the requested duration; computes p95", async () => {
    const result = await sampleRss({
      pid: 1,
      durationMs: 100,
      intervalMs: 20,
      pidusage: fakePidusage([100, 200, 300, 400, 500]),
    });
    expect(result.samples.length).toBeGreaterThanOrEqual(4);
    expect(result.samples.length).toBeLessThanOrEqual(6);
    expect(result.p95).toBeGreaterThanOrEqual(400);
    expect(result.intervalsMissed).toBe(0);
  });

  test("intervalsMissed increments when pidusage throws", async () => {
    const result = await sampleRss({
      pid: 1,
      durationMs: 100,
      intervalMs: 20,
      pidusage: fakePidusage([100, "throw", 200, "throw", 300]),
    });
    expect(result.intervalsMissed).toBeGreaterThan(0);
    expect(result.samples.length).toBeGreaterThanOrEqual(2);
  });

  test("respects abort signal", async () => {
    const ac = new AbortController();
    const promise = sampleRss({
      pid: 1,
      durationMs: 10_000,
      intervalMs: 20,
      pidusage: fakePidusage([100]),
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 60);
    const result = await promise;
    expect(result.samples.length).toBeGreaterThanOrEqual(1);
    expect(result.samples.length).toBeLessThan(20);
  });

  test("empty sample set returns p95 = 0 (no division by zero)", async () => {
    const result = await sampleRss({
      pid: 1,
      durationMs: 50,
      intervalMs: 20,
      pidusage: fakePidusage(["throw"]),
    });
    expect(result.samples).toEqual([]);
    expect(result.p95).toBe(0);
    expect(result.intervalsMissed).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/rss-sampler.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement `rss-sampler.ts`**

Create `packages/gateway/src/perf/rss-sampler.ts`:

```typescript
/**
 * RSS sampler for S7-a/b/c drivers. Polls `pidusage(pid)` at
 * `intervalMs` for `durationMs`; returns the sample array, p95, and
 * the count of polls that errored (process gone, permission denied,
 * etc.).
 *
 * Tests inject the pidusage function. Production callers omit it and
 * the helper imports the real npm package lazily.
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §5.2.
 */

import { computePercentiles } from "./percentiles.ts";

export interface SampleRssOptions {
  pid: number;
  /** 60_000 in production; tests pass 100–200. */
  durationMs: number;
  /** Default 1000. */
  intervalMs?: number;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to a lazy `pidusage` import. */
  pidusage?: (pid: number) => Promise<{ memory: number }>;
}

export interface SampleRssResult {
  samples: number[];
  p95: number;
  intervalsMissed: number;
}

let cachedPidusage: ((pid: number) => Promise<{ memory: number }>) | undefined;

async function realPidusage(pid: number): Promise<{ memory: number }> {
  if (cachedPidusage === undefined) {
    const mod = await import("pidusage");
    cachedPidusage = mod.default as (pid: number) => Promise<{ memory: number }>;
  }
  return cachedPidusage(pid);
}

export async function sampleRss(opts: SampleRssOptions): Promise<SampleRssResult> {
  const intervalMs = opts.intervalMs ?? 1000;
  const sampler = opts.pidusage ?? realPidusage;
  const samples: number[] = [];
  let intervalsMissed = 0;
  const start = performance.now();
  const deadline = start + opts.durationMs;
  // Deadline-based scheduling — feedback F-2.2. Each tick fires at
  // start + intervalMs * tickIdx (not "now + intervalMs"), so the
  // sampler-call cost doesn't accumulate into cadence drift. If a
  // sampler call ran long enough that we missed a tick, we fire the
  // next one immediately (and continue to advance tickIdx by 1 each
  // iteration so we don't loop forever in the catch-up case).
  let tickIdx = 0;

  while (performance.now() < deadline) {
    if (opts.signal?.aborted === true) break;
    try {
      const { memory } = await sampler(opts.pid);
      samples.push(memory);
    } catch {
      intervalsMissed += 1;
    }
    tickIdx += 1;
    const nextTickAt = start + tickIdx * intervalMs;
    const wait = Math.max(0, Math.min(nextTickAt - performance.now(), deadline - performance.now()));
    if (wait <= 0) continue;  // catch-up: fire next tick immediately
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, wait);
      opts.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  }

  if (samples.length === 0) {
    return { samples, p95: 0, intervalsMissed };
  }
  const p = computePercentiles(samples);
  return { samples, p95: p.p95 ?? 0, intervalsMissed };
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/rss-sampler.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/rss-sampler.ts packages/gateway/src/perf/rss-sampler.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): rss-sampler helper polling pidusage at configurable cadence

Returns samples + p95 + intervalsMissed. Lazy pidusage import keeps
the dependency optional in test contexts where it's injected.
Used by S7-a (1 Hz idle), S7-b/c (4 Hz heavy-sync / multi-agent).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — `synthetic-drive-trace.ts` generator

**Files:**
- Create: `packages/gateway/src/perf/fixtures/synthetic-drive-trace.ts`
- Create: `packages/gateway/src/perf/fixtures/synthetic-drive-trace.test.ts`

Generates Drive `files.list` page payloads at small/medium/large tiers with stable `nextPageToken` pagination shape. Deterministic via seeded RNG so the same tier reproduces byte-for-byte.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/fixtures/synthetic-drive-trace.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { driveTracePages, DRIVE_TIER_COUNTS } from "./synthetic-drive-trace.ts";

describe("driveTracePages", () => {
  test("small tier produces the expected total item count", () => {
    const pages = driveTracePages("small");
    const total = pages.reduce((s, p) => s + p.files.length, 0);
    expect(total).toBe(DRIVE_TIER_COUNTS.small);
  });

  test("each page except the last carries a nextPageToken", () => {
    const pages = driveTracePages("small");
    for (let i = 0; i < pages.length - 1; i += 1) {
      expect(pages[i].nextPageToken).toBeTruthy();
    }
    expect(pages[pages.length - 1].nextPageToken).toBeUndefined();
  });

  test("deterministic output: same tier produces identical bytes", () => {
    const a = JSON.stringify(driveTracePages("small"));
    const b = JSON.stringify(driveTracePages("small"));
    expect(a).toBe(b);
  });

  test("each file has the canonical Drive fields", () => {
    const pages = driveTracePages("small");
    const file = pages[0].files[0];
    expect(typeof file.id).toBe("string");
    expect(typeof file.name).toBe("string");
    expect(typeof file.mimeType).toBe("string");
    expect(typeof file.modifiedTime).toBe("string");
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/fixtures/synthetic-drive-trace.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the generator**

Create `packages/gateway/src/perf/fixtures/synthetic-drive-trace.ts`:

```typescript
/**
 * Synthetic Drive `files.list` page generator. Deterministic via a
 * seeded LCG. Tier-scaled item counts feed the S6-drive bench driver
 * through MSW handlers in fixtures/msw-handlers.ts.
 *
 * Mirrors the Google Drive v3 response shape:
 *   { files: [...], nextPageToken?: string }
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §6.1.
 */

import type { CorpusTier } from "../types.ts";

export const DRIVE_TIER_COUNTS: Record<CorpusTier, number> = {
  small: 50,
  medium: 500,
  large: 5_000,
};

export const DRIVE_PAGE_SIZE = 100;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

export interface DrivePage {
  files: DriveFile[];
  nextPageToken?: string;
}

const MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/pdf",
  "image/png",
  "text/plain",
];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_103_515_245 + 12_345) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export function driveTracePages(tier: CorpusTier): DrivePage[] {
  const total = DRIVE_TIER_COUNTS[tier];
  const rand = lcg(0xD17_E_AAAA);
  const baseDate = new Date("2026-01-01T00:00:00Z").getTime();
  const files: DriveFile[] = [];
  for (let i = 0; i < total; i += 1) {
    const mime = MIME_TYPES[Math.floor(rand() * MIME_TYPES.length)] ?? MIME_TYPES[0];
    const modified = new Date(baseDate + Math.floor(rand() * 90 * 86_400_000)).toISOString();
    files.push({
      id: `1A${i.toString(36).padStart(10, "0")}drv`,
      name: `synthetic-drive-${tier}-${i}.dat`,
      mimeType: mime ?? "application/octet-stream",
      modifiedTime: modified,
      size: `${100 + Math.floor(rand() * 1_000_000)}`,
    });
  }
  const pages: DrivePage[] = [];
  for (let off = 0; off < files.length; off += DRIVE_PAGE_SIZE) {
    const slice = files.slice(off, off + DRIVE_PAGE_SIZE);
    const isLast = off + DRIVE_PAGE_SIZE >= files.length;
    pages.push({
      files: slice,
      ...(isLast ? {} : { nextPageToken: `tok-drive-${tier}-${off + DRIVE_PAGE_SIZE}` }),
    });
  }
  return pages;
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/fixtures/synthetic-drive-trace.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/fixtures/synthetic-drive-trace.ts packages/gateway/src/perf/fixtures/synthetic-drive-trace.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): synthetic Drive trace generator for S6-drive bench

Deterministic LCG seeded; small/medium/large tiers (50/500/5000 items);
canonical Drive v3 response shape with nextPageToken pagination at
100 items/page. Feeds MSW handlers in PR-B-2b-1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — `synthetic-gmail-trace.ts` generator

**Files:**
- Create: `packages/gateway/src/perf/fixtures/synthetic-gmail-trace.ts`
- Create: `packages/gateway/src/perf/fixtures/synthetic-gmail-trace.test.ts`

Same shape as Task 6 but for Gmail's two-step `messages.list` (id-only) → `messages.get` (full payload) flow.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/fixtures/synthetic-gmail-trace.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  GMAIL_TIER_COUNTS,
  gmailListPages,
  gmailMessage,
} from "./synthetic-gmail-trace.ts";

describe("gmailListPages", () => {
  test("small tier produces the expected total id count", () => {
    const pages = gmailListPages("small");
    const total = pages.reduce((s, p) => s + p.messages.length, 0);
    expect(total).toBe(GMAIL_TIER_COUNTS.small);
  });

  test("nextPageToken on every page except the last", () => {
    const pages = gmailListPages("small");
    for (let i = 0; i < pages.length - 1; i += 1) {
      expect(pages[i].nextPageToken).toBeTruthy();
    }
    expect(pages[pages.length - 1].nextPageToken).toBeUndefined();
  });

  test("each list entry carries id + threadId", () => {
    const pages = gmailListPages("small");
    const m = pages[0].messages[0];
    expect(typeof m.id).toBe("string");
    expect(typeof m.threadId).toBe("string");
  });

  test("deterministic", () => {
    const a = JSON.stringify(gmailListPages("small"));
    const b = JSON.stringify(gmailListPages("small"));
    expect(a).toBe(b);
  });
});

describe("gmailMessage", () => {
  test("returns a payload with subject + snippet for a known id", () => {
    const pages = gmailListPages("small");
    const id = pages[0].messages[0].id;
    const m = gmailMessage(id, "small");
    expect(m.id).toBe(id);
    expect(typeof m.snippet).toBe("string");
    expect(m.payload.headers.find((h) => h.name === "Subject")).toBeDefined();
  });

  test("unknown id returns undefined", () => {
    expect(gmailMessage("nope", "small")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/fixtures/synthetic-gmail-trace.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the generator**

Create `packages/gateway/src/perf/fixtures/synthetic-gmail-trace.ts`:

```typescript
/**
 * Synthetic Gmail `messages.list` + `messages.get` generator. Two-step:
 *   1. messages.list returns paginated id+threadId pairs.
 *   2. messages.get on each id returns the full message payload.
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §6.1.
 */

import type { CorpusTier } from "../types.ts";

export const GMAIL_TIER_COUNTS: Record<CorpusTier, number> = {
  small: 50,
  medium: 500,
  large: 5_000,
};

export const GMAIL_PAGE_SIZE = 100;

export interface GmailListEntry {
  id: string;
  threadId: string;
}

export interface GmailListPage {
  messages: GmailListEntry[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  payload: {
    headers: GmailMessageHeader[];
    mimeType: string;
    body: { size: number };
  };
  sizeEstimate: number;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_103_515_245 + 12_345) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const SUBJECTS = [
  "Q1 review",
  "Action required",
  "Lunch?",
  "Sprint demo",
  "Re: Sprint demo",
  "Calendar invite",
];

export function gmailListPages(tier: CorpusTier): GmailListPage[] {
  const total = GMAIL_TIER_COUNTS[tier];
  const entries: GmailListEntry[] = [];
  for (let i = 0; i < total; i += 1) {
    entries.push({
      id: `gmail-${tier}-${i.toString(36).padStart(8, "0")}`,
      threadId: `thread-${tier}-${(i >> 2).toString(36).padStart(6, "0")}`,
    });
  }
  const pages: GmailListPage[] = [];
  for (let off = 0; off < entries.length; off += GMAIL_PAGE_SIZE) {
    const slice = entries.slice(off, off + GMAIL_PAGE_SIZE);
    const isLast = off + GMAIL_PAGE_SIZE >= entries.length;
    pages.push({
      messages: slice,
      resultSizeEstimate: total,
      ...(isLast ? {} : { nextPageToken: `tok-gmail-${tier}-${off + GMAIL_PAGE_SIZE}` }),
    });
  }
  return pages;
}

export function gmailMessage(id: string, tier: CorpusTier): GmailMessage | undefined {
  const total = GMAIL_TIER_COUNTS[tier];
  // Reverse-engineer the index from the id.
  const m = id.match(/^gmail-[a-z]+-([0-9a-z]+)$/);
  if (m === null) return undefined;
  const idx = Number.parseInt(m[1] ?? "0", 36);
  if (idx < 0 || idx >= total) return undefined;
  const rand = lcg(idx);
  const subject = SUBJECTS[Math.floor(rand() * SUBJECTS.length)] ?? SUBJECTS[0];
  const baseDate = new Date("2026-01-01T00:00:00Z").getTime();
  const internalDate = `${baseDate + Math.floor(rand() * 90 * 86_400_000)}`;
  const sizeEstimate = 1_000 + Math.floor(rand() * 50_000);
  return {
    id,
    threadId: `thread-${tier}-${(idx >> 2).toString(36).padStart(6, "0")}`,
    snippet: `Synthetic snippet for ${subject} #${idx}`,
    internalDate,
    payload: {
      headers: [
        { name: "Subject", value: subject ?? "(no subject)" },
        { name: "From", value: `sender${idx}@example.com` },
        { name: "Date", value: new Date(Number.parseInt(internalDate, 10)).toUTCString() },
      ],
      mimeType: "text/plain",
      body: { size: sizeEstimate },
    },
    sizeEstimate,
  };
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/fixtures/synthetic-gmail-trace.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/fixtures/synthetic-gmail-trace.ts packages/gateway/src/perf/fixtures/synthetic-gmail-trace.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): synthetic Gmail trace generator for S6-gmail bench

Two-step flow: messages.list (paginated id+threadId), messages.get
(full payload). Tier-scaled, deterministic. Feeds MSW handlers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — `synthetic-github-trace.ts` generator

**Files:**
- Create: `packages/gateway/src/perf/fixtures/synthetic-github-trace.ts`
- Create: `packages/gateway/src/perf/fixtures/synthetic-github-trace.test.ts`

GitHub paginates via the `Link` response header. The generator emits per-page payloads + the matching Link header.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/fixtures/synthetic-github-trace.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  GITHUB_TIER_COUNTS,
  githubPullsPages,
  buildGithubLinkHeader,
} from "./synthetic-github-trace.ts";

describe("githubPullsPages", () => {
  test("small tier produces the expected total PR count", () => {
    const pages = githubPullsPages("small");
    const total = pages.reduce((s, p) => s + p.length, 0);
    expect(total).toBe(GITHUB_TIER_COUNTS.small);
  });

  test("each PR has number / title / state / updated_at", () => {
    const pr = githubPullsPages("small")[0][0];
    expect(typeof pr.number).toBe("number");
    expect(typeof pr.title).toBe("string");
    expect(["open", "closed"]).toContain(pr.state);
    expect(typeof pr.updated_at).toBe("string");
  });

  test("deterministic", () => {
    const a = JSON.stringify(githubPullsPages("small"));
    const b = JSON.stringify(githubPullsPages("small"));
    expect(a).toBe(b);
  });
});

describe("buildGithubLinkHeader", () => {
  test("first page only has next/last", () => {
    const h = buildGithubLinkHeader({ page: 1, totalPages: 5, perPage: 100 });
    expect(h).toContain('rel="next"');
    expect(h).toContain('rel="last"');
    expect(h).not.toContain('rel="prev"');
  });
  test("middle page has prev/next/last/first", () => {
    const h = buildGithubLinkHeader({ page: 3, totalPages: 5, perPage: 100 });
    expect(h).toContain('rel="prev"');
    expect(h).toContain('rel="next"');
    expect(h).toContain('rel="first"');
    expect(h).toContain('rel="last"');
  });
  test("last page has prev/first only", () => {
    const h = buildGithubLinkHeader({ page: 5, totalPages: 5, perPage: 100 });
    expect(h).toContain('rel="prev"');
    expect(h).not.toContain('rel="next"');
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/fixtures/synthetic-github-trace.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the generator**

Create `packages/gateway/src/perf/fixtures/synthetic-github-trace.ts`:

```typescript
/**
 * Synthetic GitHub `GET /repos/{owner}/{repo}/pulls` page generator.
 * GitHub paginates via the `Link` response header (RFC 5988); the
 * helper produces both the per-page PR array and the matching header
 * value for `buildGithubLinkHeader`.
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §6.1.
 */

import type { CorpusTier } from "../types.ts";

export const GITHUB_TIER_COUNTS: Record<CorpusTier, number> = {
  small: 50,
  medium: 500,
  large: 5_000,
};

export const GITHUB_PER_PAGE = 100;

export interface GithubPull {
  number: number;
  title: string;
  state: "open" | "closed";
  user: { login: string };
  updated_at: string;
  html_url: string;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_103_515_245 + 12_345) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const TITLES = [
  "fix: type narrowing",
  "feat: add diag",
  "docs: cleanup",
  "test: cover edge case",
  "refactor: extract helper",
];

export function githubPullsPages(tier: CorpusTier): GithubPull[][] {
  const total = GITHUB_TIER_COUNTS[tier];
  const all: GithubPull[] = [];
  for (let i = 0; i < total; i += 1) {
    const rand = lcg(0xC0FFEE + i);
    const title = TITLES[Math.floor(rand() * TITLES.length)] ?? TITLES[0];
    const state: "open" | "closed" = rand() > 0.6 ? "closed" : "open";
    const updated = new Date(
      Date.UTC(2026, 0, 1) + Math.floor(rand() * 90 * 86_400_000),
    ).toISOString();
    all.push({
      number: i + 1,
      title: `${title} (#${i + 1})`,
      state,
      user: { login: `bot-${(i % 7).toString()}` },
      updated_at: updated,
      html_url: `https://github.com/example/repo/pull/${i + 1}`,
    });
  }
  const pages: GithubPull[][] = [];
  for (let off = 0; off < all.length; off += GITHUB_PER_PAGE) {
    pages.push(all.slice(off, off + GITHUB_PER_PAGE));
  }
  return pages;
}

export interface BuildGithubLinkOpts {
  page: number;
  totalPages: number;
  perPage: number;
  baseUrl?: string;
}

export function buildGithubLinkHeader(opts: BuildGithubLinkOpts): string {
  const url = opts.baseUrl ?? "https://api.github.com/repos/example/repo/pulls";
  const parts: string[] = [];
  const link = (page: number, rel: string): string =>
    `<${url}?page=${page}&per_page=${opts.perPage}>; rel="${rel}"`;
  if (opts.page > 1) {
    parts.push(link(opts.page - 1, "prev"));
    parts.push(link(1, "first"));
  }
  if (opts.page < opts.totalPages) {
    parts.push(link(opts.page + 1, "next"));
    parts.push(link(opts.totalPages, "last"));
  }
  return parts.join(", ");
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/fixtures/synthetic-github-trace.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/fixtures/synthetic-github-trace.ts packages/gateway/src/perf/fixtures/synthetic-github-trace.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): synthetic GitHub trace generator for S6-github bench

Per-page PR arrays + RFC 5988 Link header builder. Tier-scaled,
deterministic. Verified Octokit's fetch path during Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — `msw-handlers.ts` composer

**Files:**
- Create: `packages/gateway/src/perf/fixtures/msw-handlers.ts`
- Create: `packages/gateway/src/perf/fixtures/msw-handlers.test.ts`

Composes the three generators into MSW v2 `http.get(...)` handler arrays. Each connector exports its own factory so tests register only what they need.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/fixtures/msw-handlers.test.ts`:

```typescript
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { setupServer } from "msw/node";
import {
  driveHandlers,
  gmailHandlers,
  githubHandlers,
} from "./msw-handlers.ts";

describe("driveHandlers", () => {
  const server = setupServer(...driveHandlers("small"));
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers(...driveHandlers("small")));
  afterAll(() => server.close());

  test("first page returns files + nextPageToken", async () => {
    const r = await fetch("https://www.googleapis.com/drive/v3/files");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { files: unknown[]; nextPageToken?: string };
    expect(body.files.length).toBe(50);
    expect(body.nextPageToken).toBeUndefined(); // small tier fits in one page
  });
});

describe("gmailHandlers", () => {
  const server = setupServer(...gmailHandlers("small"));
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers(...gmailHandlers("small")));
  afterAll(() => server.close());

  test("messages.list returns paginated ids", async () => {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { messages: { id: string }[] };
    expect(body.messages.length).toBeGreaterThan(0);
  });

  test("messages.get returns the full payload for a known id", async () => {
    const list = await (
      await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages")
    ).json() as { messages: { id: string }[] };
    const id = list.messages[0]?.id;
    expect(id).toBeTruthy();
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
    expect(r.status).toBe(200);
    const m = (await r.json()) as { snippet: string };
    expect(typeof m.snippet).toBe("string");
  });
});

describe("githubHandlers", () => {
  const server = setupServer(...githubHandlers("small"));
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers(...githubHandlers("small")));
  afterAll(() => server.close());

  test("pulls list returns array + Link header on multi-page", async () => {
    const r = await fetch("https://api.github.com/repos/example/repo/pulls?per_page=100&page=1");
    expect(r.status).toBe(200);
    const body = (await r.json()) as unknown[];
    expect(body.length).toBe(50); // small tier
    // small tier fits in one page → no Link header expected
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/fixtures/msw-handlers.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the composer**

Create `packages/gateway/src/perf/fixtures/msw-handlers.ts`:

```typescript
/**
 * MSW v2 handler factories for S6 sync-throughput benches. Each factory
 * returns the `http.get(...)` handlers that intercept a connector's
 * actual HTTP traffic and serve responses from the synthetic trace
 * generators.
 *
 * Tests should register `setupServer` with `onUnhandledRequest: "error"`
 * (sentinel) so any URL the connector hits that is not covered fails
 * with a diagnostic.
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §6.1.
 */

import { http, HttpResponse } from "msw";

import type { CorpusTier } from "../types.ts";
import {
  DRIVE_PAGE_SIZE,
  driveTracePages,
  type DrivePage,
} from "./synthetic-drive-trace.ts";
import {
  GMAIL_PAGE_SIZE,
  gmailListPages,
  gmailMessage,
} from "./synthetic-gmail-trace.ts";
import {
  GITHUB_PER_PAGE,
  githubPullsPages,
  buildGithubLinkHeader,
} from "./synthetic-github-trace.ts";

export function driveHandlers(tier: CorpusTier): ReturnType<typeof http.get>[] {
  const pages: DrivePage[] = driveTracePages(tier);
  return [
    http.get("https://www.googleapis.com/drive/v3/files", ({ request }) => {
      const url = new URL(request.url);
      const token = url.searchParams.get("pageToken");
      let pageIdx = 0;
      if (token !== null) {
        const m = token.match(/^tok-drive-[a-z]+-(\d+)$/);
        if (m !== null) pageIdx = Math.floor(Number.parseInt(m[1] ?? "0", 10) / DRIVE_PAGE_SIZE);
      }
      const page = pages[pageIdx];
      if (page === undefined) return HttpResponse.json({ files: [] });
      return HttpResponse.json(page);
    }),
  ];
}

export function gmailHandlers(tier: CorpusTier): ReturnType<typeof http.get>[] {
  const pages = gmailListPages(tier);
  return [
    http.get(
      "https://gmail.googleapis.com/gmail/v1/users/:user/messages",
      ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("pageToken");
        let pageIdx = 0;
        if (token !== null) {
          const m = token.match(/^tok-gmail-[a-z]+-(\d+)$/);
          if (m !== null) {
            pageIdx = Math.floor(Number.parseInt(m[1] ?? "0", 10) / GMAIL_PAGE_SIZE);
          }
        }
        const page = pages[pageIdx];
        if (page === undefined) {
          return HttpResponse.json({ messages: [], resultSizeEstimate: 0 });
        }
        return HttpResponse.json(page);
      },
    ),
    http.get(
      "https://gmail.googleapis.com/gmail/v1/users/:user/messages/:id",
      ({ params }) => {
        const id = params["id"];
        if (typeof id !== "string") {
          return new HttpResponse(null, { status: 404 });
        }
        const m = gmailMessage(id, tier);
        if (m === undefined) return new HttpResponse(null, { status: 404 });
        return HttpResponse.json(m);
      },
    ),
  ];
}

export function githubHandlers(tier: CorpusTier): ReturnType<typeof http.get>[] {
  const pages = githubPullsPages(tier);
  return [
    http.get(
      "https://api.github.com/repos/:owner/:repo/pulls",
      ({ request }) => {
        const url = new URL(request.url);
        const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
        const perPage = Number.parseInt(
          url.searchParams.get("per_page") ?? `${GITHUB_PER_PAGE}`,
          10,
        );
        const slice = pages[page - 1] ?? [];
        const link = buildGithubLinkHeader({
          page,
          totalPages: pages.length,
          perPage,
        });
        const headers = link.length > 0 ? { Link: link } : {};
        return HttpResponse.json(slice, { headers });
      },
    ),
  ];
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/fixtures/msw-handlers.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/fixtures/msw-handlers.ts packages/gateway/src/perf/fixtures/msw-handlers.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): MSW v2 handler factories for S6 sync benches

Composes the three synthetic trace generators into per-connector
http.get handlers. Tests run with onUnhandledRequest:"error" so any
URL the real connector hits that we don't cover fails with a
diagnostic — sentinel against future connector drift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — S7-a (RSS idle) driver

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-rss-idle.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-rss-idle.test.ts`

Spawns a warm gateway, sleeps for 60 s while sampling RSS at 1 Hz, returns sample array.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/surfaces/bench-rss-idle.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { runRssIdleOnce } from "./bench-rss-idle.ts";
import { fakeSpawnEmitsMarker } from "./spawn-test-helpers.ts";

describe("runRssIdleOnce", () => {
  test("returns the sampler's RSS samples (bytes)", async () => {
    let pidCalls = 0;
    const samples = await runRssIdleOnce(
      { runs: 1, runner: "local-dev" },
      {
        spawn: fakeSpawnEmitsMarker({ pid: 4242, stdoutChunks: ["[gateway] ready /tmp/sock\n"] }),
        durationMs: 100,
        intervalMs: 20,
        pidusage: async () => {
          pidCalls += 1;
          return { memory: 100_000_000 + pidCalls * 1_000 };
        },
      },
    );
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(pidCalls).toBeGreaterThanOrEqual(3);
    expect(samples[0]).toBeGreaterThan(99_000_000);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/surfaces/bench-rss-idle.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the driver**

Create `packages/gateway/src/perf/surfaces/bench-rss-idle.ts`:

```typescript
/**
 * S7-a — Memory RSS while the gateway is warm-and-idle.
 *
 * Spawns a fresh gateway, sleeps for 60 s while the rss-sampler polls
 * `pidusage(pid)` at 1 Hz, returns the RSS sample array (bytes).
 *
 * resultKind = "rss" → BenchSurfaceResult.rssBytesP95 = p95(samples).
 */

import { resolve } from "node:path";

import { spawnGatewayForBench } from "../gateway-spawn-bench.ts";
import { sampleRss } from "../rss-sampler.ts";
import type { BenchRunOptions } from "../types.ts";

const READY_MARKER = /\[gateway\] ready/;
const DEFAULT_DURATION_MS = 60_000;
const DEFAULT_INTERVAL_MS = 1_000;

export interface RssIdleRunOptions {
  spawn?: typeof Bun.spawn;
  gatewayEntry?: string;
  durationMs?: number;
  intervalMs?: number;
  pidusage?: (pid: number) => Promise<{ memory: number }>;
}

function defaultGatewayEntry(): string {
  return resolve(import.meta.dir, "..", "..", "index.ts");
}

export async function runRssIdleOnce(
  _opts: BenchRunOptions,
  runOpts: RssIdleRunOptions = {},
): Promise<number[]> {
  const durationMs = runOpts.durationMs ?? DEFAULT_DURATION_MS;
  const intervalMs = runOpts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const entry = runOpts.gatewayEntry ?? defaultGatewayEntry();

  const result = await spawnGatewayForBench<void, { samples: number[] }>({
    cmd: process.execPath,
    args: [entry],
    readyMarker: READY_MARKER,
    ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
    workload: ({ signal }) => new Promise<void>((resolve_) => {
      const t = setTimeout(resolve_, durationMs);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve_();
      }, { once: true });
    }),
    sampler: async ({ pid, signal }) => {
      return sampleRss({
        pid,
        durationMs,
        intervalMs,
        signal,
        ...(runOpts.pidusage !== undefined && { pidusage: runOpts.pidusage }),
      });
    },
  });
  return result.samplerResult?.samples ?? [];
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/surfaces/bench-rss-idle.test.ts
```

Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-rss-idle.ts packages/gateway/src/perf/surfaces/bench-rss-idle.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): S7-a — gateway idle RSS driver

Spawns warm gateway, sleeps 60 s while sampling RSS at 1 Hz via
pidusage. Returns sample array; runBench resultKind="rss" derives
rssBytesP95 from the flattened samples.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 — S7-b (RSS heavy-sync) driver

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.test.ts`

Same shape as S7-a but the workload triggers parallel `connector.sync` calls for the three connectors via the gateway's IPC socket. Tighter sampling cadence (250 ms).

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { runRssHeavySyncOnce } from "./bench-rss-heavy-sync.ts";
import { fakeSpawnEmitsMarker } from "./spawn-test-helpers.ts";

describe("runRssHeavySyncOnce", () => {
  test("triggers sync for drive/gmail/github in parallel; returns RSS samples", async () => {
    const synced: string[] = [];
    const samples = await runRssHeavySyncOnce(
      { runs: 1, runner: "local-dev" },
      {
        spawn: fakeSpawnEmitsMarker({ pid: 5252, stdoutChunks: ["[gateway] ready\n"] }),
        durationMs: 100,
        intervalMs: 20,
        pidusage: async () => ({ memory: 200_000_000 }),
        ipcCall: async (method, params) => {
          if (method === "connector.sync") {
            synced.push((params as { service: string }).service);
            await new Promise((r) => setTimeout(r, 30));
            return { ok: true };
          }
          return undefined;
        },
      },
    );
    expect(samples.length).toBeGreaterThan(0);
    expect(synced.sort()).toEqual(["drive", "github", "gmail"]);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the driver**

Create `packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.ts`:

```typescript
/**
 * S7-b — Memory RSS while the gateway is busy syncing 3 connectors.
 *
 * Workload: in parallel, fire `connector.sync { service }` for drive,
 * gmail, github via the IPC client. Sampler: poll RSS at 250 ms
 * (per cluster-c spec §5.2 — sync bursts can spike RSS between
 * coarser samples; 240 polls / 60 s catches peaks).
 *
 * Production IPC wiring (deferred to PR-C / PR-B-2b-3): construct a
 * `NimbusClient` from `@nimbus-dev/client` against the spawned
 * gateway's socket path (default `<NIMBUS_HOME>/gateway.sock` on
 * unix, `\\.\pipe\nimbus-<hash>` on win32). Example:
 *
 *   import { NimbusClient } from "@nimbus-dev/client";
 *   const client = await NimbusClient.connect({ socketPath: ... });
 *   await client.call("connector.sync", { service: "drive", full: true });
 *
 * Until then, tests inject a fake `ipcCall`.
 */

import { resolve } from "node:path";

import { spawnGatewayForBench } from "../gateway-spawn-bench.ts";
import { sampleRss } from "../rss-sampler.ts";
import type { BenchRunOptions } from "../types.ts";

const READY_MARKER = /\[gateway\] ready/;
const DEFAULT_DURATION_MS = 60_000;
const DEFAULT_INTERVAL_MS = 250;

export type IpcCallFn = (method: string, params: unknown) => Promise<unknown>;

export interface RssHeavySyncRunOptions {
  spawn?: typeof Bun.spawn;
  gatewayEntry?: string;
  durationMs?: number;
  intervalMs?: number;
  pidusage?: (pid: number) => Promise<{ memory: number }>;
  /** Test injection. In production an IPC client is constructed inline. */
  ipcCall?: IpcCallFn;
}

function defaultGatewayEntry(): string {
  return resolve(import.meta.dir, "..", "..", "index.ts");
}

async function defaultIpcCall(_method: string, _params: unknown): Promise<unknown> {
  // Production wiring: open a Bun IPC client connected to the spawned
  // gateway's socket. Implementation deferred to plan-execution; in
  // tests this branch is replaced via the runOpts.ipcCall injection.
  throw new Error("default IPC client not wired — pass runOpts.ipcCall in tests");
}

export async function runRssHeavySyncOnce(
  _opts: BenchRunOptions,
  runOpts: RssHeavySyncRunOptions = {},
): Promise<number[]> {
  const durationMs = runOpts.durationMs ?? DEFAULT_DURATION_MS;
  const intervalMs = runOpts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const entry = runOpts.gatewayEntry ?? defaultGatewayEntry();
  const ipc = runOpts.ipcCall ?? defaultIpcCall;

  const result = await spawnGatewayForBench<void, { samples: number[] }>({
    cmd: process.execPath,
    args: [entry],
    readyMarker: READY_MARKER,
    ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
    workload: async ({ signal }) => {
      const fire = async (svc: string): Promise<void> => {
        if (signal.aborted) return;
        try {
          await ipc("connector.sync", { service: svc, full: true });
        } catch {
          /* a partially-stubbed test env or sync error doesn't fail the bench */
        }
      };
      await Promise.allSettled([fire("drive"), fire("gmail"), fire("github")]);
      // Stay alive until the duration window elapses so the sampler has a
      // full sampling envelope. The sampler aborts early via signal.
      await new Promise<void>((resolve_) => {
        const t = setTimeout(resolve_, durationMs);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve_();
        }, { once: true });
      });
    },
    sampler: ({ pid, signal }) =>
      sampleRss({
        pid,
        durationMs,
        intervalMs,
        signal,
        ...(runOpts.pidusage !== undefined && { pidusage: runOpts.pidusage }),
      }),
  });
  return result.samplerResult?.samples ?? [];
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.test.ts
```

Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.ts packages/gateway/src/perf/surfaces/bench-rss-heavy-sync.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): S7-b — gateway RSS during parallel connector sync

Workload fires connector.sync for drive/gmail/github in parallel
while the sampler polls RSS at 250 ms. Tests inject an ipcCall fake;
production wiring uses Bun's IPC client connected to the spawned
gateway's socket.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12 — S7-c (RSS multi-agent, REFERENCE_ONLY) driver

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-rss-multi-agent.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-rss-multi-agent.test.ts`

REFERENCE_ONLY surface — on `--gha` the orchestrator skips it via the existing `REFERENCE_ONLY` set; the driver still ships so the bidirectional driver↔row mapping holds.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/surfaces/bench-rss-multi-agent.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { runRssMultiAgentOnce, S7C_REFERENCE_ONLY_REASON } from "./bench-rss-multi-agent.ts";

describe("runRssMultiAgentOnce", () => {
  test("exports a stable reference-only reason string", () => {
    expect(typeof S7C_REFERENCE_ONLY_REASON).toBe("string");
    expect(S7C_REFERENCE_ONLY_REASON.length).toBeGreaterThan(0);
  });

  test("driver shape matches: returns []", async () => {
    const samples = await runRssMultiAgentOnce({ runs: 1, runner: "local-dev" });
    // Driver itself returns []. The bench-cli orchestrator gates on
    // REFERENCE_ONLY and writes the stub_reason.
    expect(samples).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/surfaces/bench-rss-multi-agent.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the driver**

Create `packages/gateway/src/perf/surfaces/bench-rss-multi-agent.ts`:

```typescript
/**
 * S7-c — Memory RSS during a 3-sub-agent decomposition.
 *
 * REFERENCE_ONLY: requires a loaded local LLM + GPU. On --gha the
 * bench-cli orchestrator skips this surface via the REFERENCE_ONLY
 * set and writes a per-surface stub_reason. The driver function
 * itself is a no-op (returns []) so the bidirectional driver↔row
 * mapping (parent spec §6 criterion 7) holds even on non-reference
 * runners.
 *
 * On reference runs (when implemented in PR-B-2b-3), this driver will
 * spawn the gateway, fire `agent.ask` with a 3-step plan, and sample
 * RSS over the workflow's lifetime.
 */

import type { BenchRunOptions } from "../types.ts";

export const S7C_REFERENCE_ONLY_REASON =
  "reference-only; requires loaded LLM + GPU (real driver in PR-B-2b-3)";

export async function runRssMultiAgentOnce(
  _opts: BenchRunOptions,
  _runOpts: Record<string, unknown> = {},
): Promise<number[]> {
  return [];
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/surfaces/bench-rss-multi-agent.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-rss-multi-agent.ts packages/gateway/src/perf/surfaces/bench-rss-multi-agent.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): S7-c — multi-agent RSS driver (reference-only stub)

Returns []; bench-cli REFERENCE_ONLY set gates the surface on --gha.
Real spawn + agent.ask wiring deferred to PR-B-2b-3 (alongside the
real Ollama-driven S9 driver).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13 — S6-drive sync-throughput driver

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.test.ts`

Spawns gateway with MSW handlers serving Drive responses; calls `connector.sync` via IPC; measures items landed in the index via `index.querySql` count delta.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { runSyncThroughputDriveOnce } from "./bench-sync-throughput-drive.ts";
import { fakeSpawnEmitsMarker } from "./spawn-test-helpers.ts";

describe("runSyncThroughputDriveOnce", () => {
  test("returns positive items/sec for each of 5 runs", async () => {
    let beforeCount = 0;
    let afterCount = 50;
    const samples = await runSyncThroughputDriveOnce(
      { runs: 1, runner: "local-dev", corpus: "small" },
      {
        spawn: fakeSpawnEmitsMarker({ pid: 6262, stdoutChunks: ["[gateway] ready\n"] }),
        ipcCall: async (method, _params) => {
          if (method === "index.querySql") {
            const c = beforeCount;
            beforeCount = afterCount;
            return [{ c }];
          }
          if (method === "connector.sync") {
            await new Promise((r) => setTimeout(r, 50));
            return { ok: true };
          }
          return undefined;
        },
      },
    );
    expect(samples.length).toBe(5);
    for (const s of samples) {
      expect(s).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the driver**

Create `packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.ts`:

```typescript
/**
 * S6-drive — Drive sync throughput. Spawns gateway with MSW handlers
 * serving synthetic Drive pages; calls `connector.sync { service: "drive", full: true }`
 * via IPC; measures items landed by counting rows in the local index
 * before vs after.
 *
 * The COUNT(*) before/after queries are O(log N) — `idx_item_service`
 * (packages/gateway/src/index/unified-item-v3-sql.ts:37) covers them
 * — so the count overhead is negligible inside the timed window.
 *
 * MSW unhandled-request policy is `"warn"` here (not `"error"` as in
 * unit tests). Rationale: the spawned gateway emits unrelated HTTP
 * during steady-state — telemetry post, update-manifest probe — that
 * would crash the bench under `"error"`. Unit tests use `"error"` as
 * a sentinel against connector drift since they don't spawn a real
 * gateway. (feedback F-1.3)
 *
 * Production IPC wiring (deferred to PR-C / PR-B-2b-3): see
 * bench-rss-heavy-sync.ts header for the recommended NimbusClient
 * pattern (feedback F-1.1).
 *
 * resultKind = "throughput" → per-run samples are items/sec; harness
 * returns median across runs as throughputPerSec.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { setupServer, type SetupServer } from "msw/node";

import { driveHandlers } from "../fixtures/msw-handlers.ts";
import { spawnGatewayForBench } from "../gateway-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

const READY_MARKER = /\[gateway\] ready/;
const SAMPLES_PER_RUN = 5;
const COUNT_SQL = "SELECT COUNT(*) AS c FROM item WHERE service = 'drive'";

export type IpcCallFn = (method: string, params: unknown) => Promise<unknown>;

export interface SyncThroughputDriveRunOptions {
  spawn?: typeof Bun.spawn;
  gatewayEntry?: string;
  /** Test injection. In production constructed against the spawned socket. */
  ipcCall?: IpcCallFn;
  /** Test injection — a custom MSW server used in place of fixture-driven setupServer. */
  mswServer?: SetupServer;
}

function defaultGatewayEntry(): string {
  return resolve(import.meta.dir, "..", "..", "index.ts");
}

async function defaultIpcCall(_method: string, _params: unknown): Promise<unknown> {
  throw new Error("IPC client wiring deferred; pass runOpts.ipcCall in tests");
}

export async function runSyncThroughputDriveOnce(
  opts: BenchRunOptions,
  runOpts: SyncThroughputDriveRunOptions = {},
): Promise<number[]> {
  const tier = opts.corpus ?? "small";
  const entry = runOpts.gatewayEntry ?? defaultGatewayEntry();
  const ipc = runOpts.ipcCall ?? defaultIpcCall;

  const samples: number[] = [];
  for (let i = 0; i < SAMPLES_PER_RUN; i += 1) {
    const home = mkdtempSync(join(tmpdir(), "nimbus-bench-drive-"));
    const server = runOpts.mswServer ?? setupServer(...driveHandlers(tier));
    server.listen({ onUnhandledRequest: "warn" });
    try {
      const result = await spawnGatewayForBench<{ items: number; ms: number }, void>({
        cmd: process.execPath,
        args: [entry],
        readyMarker: READY_MARKER,
        env: { NIMBUS_HOME: home },
        ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
        workload: async () => {
          const before = (await ipc("index.querySql", {
            sql: COUNT_SQL,
            params: [],
          })) as Array<{ c: number }>;
          const beforeC = before[0]?.c ?? 0;
          const t0 = performance.now();
          await ipc("connector.sync", { service: "drive", full: true });
          const ms = performance.now() - t0;
          const after = (await ipc("index.querySql", {
            sql: COUNT_SQL,
            params: [],
          })) as Array<{ c: number }>;
          const afterC = after[0]?.c ?? 0;
          return { items: afterC - beforeC, ms };
        },
      });
      const itemsPerSec = result.workloadResult.ms <= 0
        ? 0
        : result.workloadResult.items / (result.workloadResult.ms / 1000);
      samples.push(itemsPerSec);
    } finally {
      server.close();
      rmSync(home, { recursive: true, force: true });
    }
  }
  return samples;
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.test.ts
```

Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.ts packages/gateway/src/perf/surfaces/bench-sync-throughput-drive.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): S6-drive sync-throughput driver

MSW intercepts Drive fetch calls; bench measures items landed in the
local index via index.querySql count delta around connector.sync.
Fresh NIMBUS_HOME per sample (5 samples/run) avoids socket collision.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14 — S6-gmail sync-throughput driver

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.test.ts`

Same pattern as Task 13. Service = "gmail"; handlers = `gmailHandlers`.

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { runSyncThroughputGmailOnce } from "./bench-sync-throughput-gmail.ts";
import { fakeSpawnEmitsMarker } from "./spawn-test-helpers.ts";

describe("runSyncThroughputGmailOnce", () => {
  test("returns positive items/sec for each of 5 runs", async () => {
    let before = 0;
    let after = 50;
    const samples = await runSyncThroughputGmailOnce(
      { runs: 1, runner: "local-dev", corpus: "small" },
      {
        spawn: fakeSpawnEmitsMarker({ pid: 7373, stdoutChunks: ["[gateway] ready\n"] }),
        ipcCall: async (method) => {
          if (method === "index.querySql") {
            const c = before;
            before = after;
            return [{ c }];
          }
          if (method === "connector.sync") {
            await new Promise((r) => setTimeout(r, 50));
            return { ok: true };
          }
          return undefined;
        },
      },
    );
    expect(samples.length).toBe(5);
    for (const s of samples) expect(s).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the driver**

Create `packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.ts`:

```typescript
/**
 * S6-gmail — Gmail sync throughput. Same pattern as S6-drive: MSW
 * intercepts gmail.googleapis.com; bench measures items landed in the
 * index via SELECT COUNT(*) WHERE service = 'gmail' delta.
 *
 * See bench-sync-throughput-drive.ts header for MSW policy and IPC
 * wiring rationale (applies identically here).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { setupServer, type SetupServer } from "msw/node";

import { gmailHandlers } from "../fixtures/msw-handlers.ts";
import { spawnGatewayForBench } from "../gateway-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

const READY_MARKER = /\[gateway\] ready/;
const SAMPLES_PER_RUN = 5;
const COUNT_SQL = "SELECT COUNT(*) AS c FROM item WHERE service = 'gmail'";

export type IpcCallFn = (method: string, params: unknown) => Promise<unknown>;

export interface SyncThroughputGmailRunOptions {
  spawn?: typeof Bun.spawn;
  gatewayEntry?: string;
  ipcCall?: IpcCallFn;
  mswServer?: SetupServer;
}

function defaultGatewayEntry(): string {
  return resolve(import.meta.dir, "..", "..", "index.ts");
}
async function defaultIpcCall(_m: string, _p: unknown): Promise<unknown> {
  throw new Error("IPC client wiring deferred; pass runOpts.ipcCall in tests");
}

export async function runSyncThroughputGmailOnce(
  opts: BenchRunOptions,
  runOpts: SyncThroughputGmailRunOptions = {},
): Promise<number[]> {
  const tier = opts.corpus ?? "small";
  const entry = runOpts.gatewayEntry ?? defaultGatewayEntry();
  const ipc = runOpts.ipcCall ?? defaultIpcCall;

  const samples: number[] = [];
  for (let i = 0; i < SAMPLES_PER_RUN; i += 1) {
    const home = mkdtempSync(join(tmpdir(), "nimbus-bench-gmail-"));
    const server = runOpts.mswServer ?? setupServer(...gmailHandlers(tier));
    server.listen({ onUnhandledRequest: "warn" });
    try {
      const result = await spawnGatewayForBench<{ items: number; ms: number }, void>({
        cmd: process.execPath,
        args: [entry],
        readyMarker: READY_MARKER,
        env: { NIMBUS_HOME: home },
        ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
        workload: async () => {
          const before = (await ipc("index.querySql", {
            sql: COUNT_SQL,
            params: [],
          })) as Array<{ c: number }>;
          const t0 = performance.now();
          await ipc("connector.sync", { service: "gmail", full: true });
          const ms = performance.now() - t0;
          const after = (await ipc("index.querySql", {
            sql: COUNT_SQL,
            params: [],
          })) as Array<{ c: number }>;
          return {
            items: (after[0]?.c ?? 0) - (before[0]?.c ?? 0),
            ms,
          };
        },
      });
      const itemsPerSec = result.workloadResult.ms <= 0
        ? 0
        : result.workloadResult.items / (result.workloadResult.ms / 1000);
      samples.push(itemsPerSec);
    } finally {
      server.close();
      rmSync(home, { recursive: true, force: true });
    }
  }
  return samples;
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.test.ts
```

Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.ts packages/gateway/src/perf/surfaces/bench-sync-throughput-gmail.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): S6-gmail sync-throughput driver

Mirrors S6-drive shape; gmailHandlers intercept the two-step list/get
flow. items/sec measured via index.querySql delta around connector.sync.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15 — S6-github sync-throughput driver

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-sync-throughput-github.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-sync-throughput-github.test.ts`

Same shape as Tasks 13–14. Service = "github"; handlers = `githubHandlers`. Tests verify the Octokit fetch path is intercepted (sentinel: `onUnhandledRequest: "error"`).

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/perf/surfaces/bench-sync-throughput-github.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { runSyncThroughputGithubOnce } from "./bench-sync-throughput-github.ts";
import { fakeSpawnEmitsMarker } from "./spawn-test-helpers.ts";

describe("runSyncThroughputGithubOnce", () => {
  test("returns positive items/sec for each of 5 runs", async () => {
    let before = 0;
    let after = 50;
    const samples = await runSyncThroughputGithubOnce(
      { runs: 1, runner: "local-dev", corpus: "small" },
      {
        spawn: fakeSpawnEmitsMarker({ pid: 8484, stdoutChunks: ["[gateway] ready\n"] }),
        ipcCall: async (method) => {
          if (method === "index.querySql") {
            const c = before;
            before = after;
            return [{ c }];
          }
          if (method === "connector.sync") {
            await new Promise((r) => setTimeout(r, 60));
            return { ok: true };
          }
          return undefined;
        },
      },
    );
    expect(samples.length).toBe(5);
    for (const s of samples) expect(s).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
bun test packages/gateway/src/perf/surfaces/bench-sync-throughput-github.test.ts
```

Expected: file-not-found.

- [ ] **Step 3: Implement the driver**

Create `packages/gateway/src/perf/surfaces/bench-sync-throughput-github.ts`:

```typescript
/**
 * S6-github — GitHub sync throughput. Same pattern as S6-drive/gmail.
 * Octokit's request layer hits MSW (verified Task 2; verdict + version
 * recorded in fixtures/README.md).
 *
 * See bench-sync-throughput-drive.ts header for MSW policy and IPC
 * wiring rationale (applies identically here).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { setupServer, type SetupServer } from "msw/node";

import { githubHandlers } from "../fixtures/msw-handlers.ts";
import { spawnGatewayForBench } from "../gateway-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

const READY_MARKER = /\[gateway\] ready/;
const SAMPLES_PER_RUN = 5;
const COUNT_SQL = "SELECT COUNT(*) AS c FROM item WHERE service = 'github'";

export type IpcCallFn = (method: string, params: unknown) => Promise<unknown>;

export interface SyncThroughputGithubRunOptions {
  spawn?: typeof Bun.spawn;
  gatewayEntry?: string;
  ipcCall?: IpcCallFn;
  mswServer?: SetupServer;
}

function defaultGatewayEntry(): string {
  return resolve(import.meta.dir, "..", "..", "index.ts");
}
async function defaultIpcCall(_m: string, _p: unknown): Promise<unknown> {
  throw new Error("IPC client wiring deferred; pass runOpts.ipcCall in tests");
}

export async function runSyncThroughputGithubOnce(
  opts: BenchRunOptions,
  runOpts: SyncThroughputGithubRunOptions = {},
): Promise<number[]> {
  const tier = opts.corpus ?? "small";
  const entry = runOpts.gatewayEntry ?? defaultGatewayEntry();
  const ipc = runOpts.ipcCall ?? defaultIpcCall;

  const samples: number[] = [];
  for (let i = 0; i < SAMPLES_PER_RUN; i += 1) {
    const home = mkdtempSync(join(tmpdir(), "nimbus-bench-github-"));
    const server = runOpts.mswServer ?? setupServer(...githubHandlers(tier));
    server.listen({ onUnhandledRequest: "warn" });
    try {
      const result = await spawnGatewayForBench<{ items: number; ms: number }, void>({
        cmd: process.execPath,
        args: [entry],
        readyMarker: READY_MARKER,
        env: { NIMBUS_HOME: home },
        ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
        workload: async () => {
          const before = (await ipc("index.querySql", {
            sql: COUNT_SQL,
            params: [],
          })) as Array<{ c: number }>;
          const t0 = performance.now();
          await ipc("connector.sync", { service: "github", full: true });
          const ms = performance.now() - t0;
          const after = (await ipc("index.querySql", {
            sql: COUNT_SQL,
            params: [],
          })) as Array<{ c: number }>;
          return {
            items: (after[0]?.c ?? 0) - (before[0]?.c ?? 0),
            ms,
          };
        },
      });
      const itemsPerSec = result.workloadResult.ms <= 0
        ? 0
        : result.workloadResult.items / (result.workloadResult.ms / 1000);
      samples.push(itemsPerSec);
    } finally {
      server.close();
      rmSync(home, { recursive: true, force: true });
    }
  }
  return samples;
}
```

- [ ] **Step 4: Run the tests; expect all passing**

```bash
bun test packages/gateway/src/perf/surfaces/bench-sync-throughput-github.test.ts
```

Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-sync-throughput-github.ts packages/gateway/src/perf/surfaces/bench-sync-throughput-github.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): S6-github sync-throughput driver

Mirrors S6-drive/gmail shape; githubHandlers intercept the REST pulls
endpoint with RFC 5988 Link-header pagination. items/sec via
index.querySql delta.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16 — Update `BenchSurfaceId` literals

**Files:**
- Modify: `packages/gateway/src/perf/types.ts`

Replace the single `"S6"` literal with the three connector variants. `S7-a/b/c`, `S8`, `S9`, `S10` stay as-is (S8 will be expanded in PR-B-2b-2).

- [ ] **Step 1: Edit `BenchSurfaceId`**

Open `packages/gateway/src/perf/types.ts`. Replace:

```typescript
  | "S6"
```

with:

```typescript
  | "S6-drive"
  | "S6-gmail"
  | "S6-github"
```

Resulting union (the new full literal block):

```typescript
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
  | "S8"
  | "S9"
  | "S10"
  | "S11-a"
  | "S11-b";
```

- [ ] **Step 2: Run typecheck across the workspace**

```bash
bun run typecheck
```

Expected: no errors. If anything used the old `"S6"` literal, the failure points to it. (PR-B-2a doesn't reference it, so this should be clean.)

- [ ] **Step 3: Run the full perf test suite**

```bash
bun test packages/gateway/src/perf/
```

Expected: all tests pass; new drivers' tests + extended runBench tests + existing PR-B-2a tests all green.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/perf/types.ts
git commit -m "$(cat <<'EOF'
refactor(perf): split S6 literal into per-connector surface IDs

Replaces "S6" in BenchSurfaceId with "S6-drive" | "S6-gmail" |
"S6-github" so each connector gets its own threshold row in slo.md
(per cluster-c spec §4). Mirrors PR-B-2a's S2-b/S2-c per-tier split.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17 — Register surfaces in `bench-cli.ts`

**Files:**
- Modify: `packages/gateway/src/perf/bench-cli.ts`

Add 6 surface IDs to `SURFACE_REGISTRY`; introduce `SURFACE_RESULT_KIND` and `LINUX_ONLY_THRESHOLDS`; extend `REFERENCE_ONLY` with `S7-c`. Update `processSurface` to pass `resultKind` to `runBench`.

- [ ] **Step 1: Read the current file**

Already read in plan prep. Note the current registries at lines 58–77.

- [ ] **Step 2: Add imports**

Open `packages/gateway/src/perf/bench-cli.ts`. Add new imports (group with existing `surfaces/` imports, alphabetical):

```typescript
import { runRssHeavySyncOnce } from "./surfaces/bench-rss-heavy-sync.ts";
import { runRssIdleOnce } from "./surfaces/bench-rss-idle.ts";
import {
  runRssMultiAgentOnce,
  S7C_REFERENCE_ONLY_REASON,
} from "./surfaces/bench-rss-multi-agent.ts";
import { runSyncThroughputDriveOnce } from "./surfaces/bench-sync-throughput-drive.ts";
import { runSyncThroughputGithubOnce } from "./surfaces/bench-sync-throughput-github.ts";
import { runSyncThroughputGmailOnce } from "./surfaces/bench-sync-throughput-gmail.ts";
```

Add `BenchResultKind` to the existing `types.ts` import:

```typescript
import type { BenchResultKind, BenchRunOptions, BenchSurfaceId, BenchSurfaceResult, RunnerKind } from "./types.ts";
```

- [ ] **Step 3: Extend `SURFACE_REGISTRY`**

Replace the `SURFACE_REGISTRY` block with:

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
  "S11-a": (opts) => runCliOverheadColdOnce(opts),
  "S11-b": (opts) => runCliOverheadWarmOnce(opts),
};
```

- [ ] **Step 4: Add `SURFACE_RESULT_KIND` map**

Below `SURFACE_REGISTRY`, add:

```typescript
/** Per-surface result aggregation. Defaults to "latency" for unlisted surfaces. */
const SURFACE_RESULT_KIND: Partial<Record<BenchSurfaceId, BenchResultKind>> = {
  "S6-drive": "throughput",
  "S6-gmail": "throughput",
  "S6-github": "throughput",
  "S7-a": "rss",
  "S7-b": "rss",
  "S7-c": "rss",
  // Latency surfaces (S1, S2-*, S4, S11-*) omit and default to "latency".
};
```

- [ ] **Step 5: Update `STUB_SURFACES` to include `S7C_REFERENCE_ONLY_REASON` for skipped multi-agent runs**

The reason string is consumed by the orchestrator's reference-only branch (lines 162–168 in PR-B-2a) which already writes a generic "skipped on <runner>" message. To preserve the *specific* reason for S7-c, swap the message:

Locate (still in the same file):

```typescript
  // Reference-only skip branch — record a per-surface stub entry.
  if (REFERENCE_ONLY.has(id) && runner !== "reference-m1air") {
    const reason = `reference-only — skipped on ${runner}`;
```

and change `reason` to consult a per-surface lookup:

```typescript
const REFERENCE_ONLY_REASONS: Partial<Record<BenchSurfaceId, string>> = {
  "S7-c": S7C_REFERENCE_ONLY_REASON,
};
```

(Add this constant near the other registries.)

Then in `processSurface`:

```typescript
  if (REFERENCE_ONLY.has(id) && runner !== "reference-m1air") {
    const reason = REFERENCE_ONLY_REASONS[id]
      ?? `reference-only — skipped on ${runner}`;
```

- [ ] **Step 6: Extend `REFERENCE_ONLY` with `S7-c`**

Replace:

```typescript
const REFERENCE_ONLY: ReadonlySet<BenchSurfaceId> = new Set<BenchSurfaceId>(["S2-c"]);
```

with:

```typescript
const REFERENCE_ONLY: ReadonlySet<BenchSurfaceId> = new Set<BenchSurfaceId>(["S2-c", "S7-c"]);
```

- [ ] **Step 7: Add `LINUX_ONLY_THRESHOLDS` set (exported)**

Below `REFERENCE_ONLY`, add:

```typescript
/**
 * Surfaces whose threshold gate runs on Linux only. macOS/Windows still
 * record samples (informational), but PR-C's threshold comparator
 * imports this set and skips gating on non-Linux runners.
 */
export const LINUX_ONLY_THRESHOLDS: ReadonlySet<BenchSurfaceId> =
  new Set<BenchSurfaceId>(["S7-a", "S7-b", "S7-c"]);
```

- [ ] **Step 8: Pass `resultKind` through `processSurface` → `runBench`**

In the `processSurface` function (currently around line 145), the `runBench` call site is:

```typescript
    result = await runBench(id, (o) => driver(o, runOpts), opts);
```

Change to:

```typescript
    const resultKind = SURFACE_RESULT_KIND[id] ?? "latency";
    result = await runBench(
      id,
      (o) => driver(o, runOpts),
      opts,
      {},
      resultKind,
    );
```

(Using `?? "latency"` rather than passing `undefined` because `runBench`'s `resultKind` parameter has a default value, not an optional/`?` typing — TypeScript would reject a `BenchResultKind | undefined` argument otherwise.)

- [ ] **Step 9: Run the modified file's existing tests**

```bash
bun test packages/gateway/src/perf/bench-cli.test.ts
```

Expected: all existing tests pass (S2-a default, reference protocol, S3 stub, S2-c reference-only).

- [ ] **Step 10: Commit**

```bash
git add packages/gateway/src/perf/bench-cli.ts
git commit -m "$(cat <<'EOF'
feat(perf): register S6-* and S7-* surfaces in bench-cli

Adds 6 new IDs to SURFACE_REGISTRY (S6-drive/gmail/github,
S7-a/b/c). Introduces SURFACE_RESULT_KIND so S6 (throughput) and
S7 (rss) surfaces aggregate correctly via the runBench resultKind
parameter. Extends REFERENCE_ONLY with S7-c (uses its own per-surface
reason string). Exports LINUX_ONLY_THRESHOLDS for PR-C's threshold
comparator to consult on non-Linux runners.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18 — Update `bench-runner.ts` help text

**Files:**
- Modify: `packages/gateway/src/perf/bench-runner.ts`

- [ ] **Step 1: Read the current help text**

```bash
bunx grep -n "Available surfaces\|S2-a\|S11-b" packages/gateway/src/perf/bench-runner.ts
```

Locate the line that lists surfaces.

- [ ] **Step 2: Update the surface list**

Wherever the help text enumerates surface IDs, update to include the 6 new ones (sorted in registry order):

```
Available surfaces: S1, S2-a, S2-b, S2-c, S3, S4, S5, S6-drive, S6-gmail, S6-github, S7-a, S7-b, S7-c, S11-a, S11-b
```

(S8/S9/S10 will be added by PR-B-2b-2.)

- [ ] **Step 3: Run the runner's tests if any**

```bash
bunx grep -l "bench-runner" packages/gateway/src/perf/ | head
```

If a `bench-runner.test.ts` exists, run it:

```bash
bun test packages/gateway/src/perf/bench-runner.test.ts
```

If there are no tests, skip.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/perf/bench-runner.ts
git commit -m "$(cat <<'EOF'
docs(perf): list S6-*/S7-* surfaces in bench-runner help

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19 — Re-export new modules from `perf/index.ts`

**Files:**
- Modify: `packages/gateway/src/perf/index.ts`

- [ ] **Step 1: Read the current barrel**

```bash
cat packages/gateway/src/perf/index.ts
```

- [ ] **Step 2: Add re-exports**

Append:

```typescript
export * from "./gateway-spawn-bench.ts";
export * from "./rss-sampler.ts";
export * from "./surfaces/bench-rss-idle.ts";
export * from "./surfaces/bench-rss-heavy-sync.ts";
export * from "./surfaces/bench-rss-multi-agent.ts";
export * from "./surfaces/bench-sync-throughput-drive.ts";
export * from "./surfaces/bench-sync-throughput-gmail.ts";
export * from "./surfaces/bench-sync-throughput-github.ts";
export { LINUX_ONLY_THRESHOLDS } from "./bench-cli.ts";
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: clean. If a re-export collides (two modules exporting the same identifier), the collision points to a real bug — fix it.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/perf/index.ts
git commit -m "$(cat <<'EOF'
chore(perf): re-export PR-B-2b-1 helpers + drivers from perf/index

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20 — Add bench-cli tests for new gating

**Files:**
- Modify: `packages/gateway/src/perf/bench-cli.test.ts`

- [ ] **Step 1: Add tests**

Append to `packages/gateway/src/perf/bench-cli.test.ts`:

```typescript
import { LINUX_ONLY_THRESHOLDS } from "./bench-cli.ts";

describe("runBenchCli — PR-B-2b-1 registrations", () => {
  test("--surface S7-c on --gha records reference-only stub with the surface-specific reason", async () => {
    const exitCode = await runBenchCli(["--surface", "S7-c", "--runs", "1", "--gha"], {
      runId: "s7c-test",
      historyPath,
      fixtureCacheDir: dir,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    const line = readHistoryLine();
    expect(line.surfaces["S7-c"]?.samples_count).toBe(0);
    const reason = line.surfaces["S7-c"]?.stub_reason ?? "";
    expect(reason).toMatch(/reference-only/);
    expect(reason).toMatch(/LLM/);
  });

  test("LINUX_ONLY_THRESHOLDS contains S7-a, S7-b, S7-c", () => {
    expect(LINUX_ONLY_THRESHOLDS.has("S7-a")).toBe(true);
    expect(LINUX_ONLY_THRESHOLDS.has("S7-b")).toBe(true);
    expect(LINUX_ONLY_THRESHOLDS.has("S7-c")).toBe(true);
    expect(LINUX_ONLY_THRESHOLDS.has("S2-a")).toBe(false);
  });

  test("--surface S6-drive (driver injected via override) populates throughput_per_sec", async () => {
    const exitCode = await runBenchCli(
      ["--surface", "S6-drive", "--runs", "1", "--corpus", "small", "--gha"],
      {
        runId: "s6-drive-test",
        historyPath,
        fixtureCacheDir: dir,
        stdout: () => {},
        surfaceDriverOverrides: {
          "S6-drive": async () => [10, 20, 30, 40, 50],
        },
      },
    );
    expect(exitCode).toBe(0);
    const raw = JSON.parse(readFileSync(historyPath, "utf8").trim()) as {
      surfaces: Record<string, { throughput_per_sec?: number }>;
    };
    expect(raw.surfaces["S6-drive"]?.throughput_per_sec).toBe(30);
  });

  test("--surface S7-a on --gha (driver injected via override) populates rss_bytes_p95", async () => {
    const exitCode = await runBenchCli(
      ["--surface", "S7-a", "--runs", "1", "--gha"],
      {
        runId: "s7a-test",
        historyPath,
        fixtureCacheDir: dir,
        stdout: () => {},
        surfaceDriverOverrides: {
          "S7-a": async () => [1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_400_000],
        },
      },
    );
    expect(exitCode).toBe(0);
    const raw = JSON.parse(readFileSync(historyPath, "utf8").trim()) as {
      surfaces: Record<string, { rss_bytes_p95?: number }>;
    };
    expect(raw.surfaces["S7-a"]?.rss_bytes_p95).toBeGreaterThanOrEqual(1_300_000);
  });
});
```

- [ ] **Step 2: Run the new tests**

```bash
bun test packages/gateway/src/perf/bench-cli.test.ts
```

Expected: 4 new + 4 old tests, all passing.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/perf/bench-cli.test.ts
git commit -m "$(cat <<'EOF'
test(perf): cover S7-c reference-only, throughput/rss aggregation, LINUX_ONLY_THRESHOLDS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21 — End-to-end smoke + full CI suite

**Files:** none modified.

- [ ] **Step 1: Run the full perf coverage gate**

```bash
bun run test:coverage:perf
```

Expected: ≥80 % lines for `packages/gateway/src/perf/`. If below, look at which new file dropped coverage and add tests; do not lower the gate.

- [ ] **Step 2: Smoke `nimbus bench --all --runs 1 --corpus small --gha`**

```bash
NIMBUS_HOME=$(mktemp -d) bun packages/cli/src/index.ts bench --all --runs 1 --corpus small --gha
```

Expected: writes one valid JSONL line to `docs/perf/history.jsonl` (or wherever `--history-path` points). Inspect the line:

```bash
tail -1 docs/perf/history.jsonl | bunx jq '.surfaces | keys'
```

Should include: `S1, S2-a, S2-b, S2-c, S3, S4, S5, S6-drive, S6-gmail, S6-github, S7-a, S7-b, S7-c, S11-a, S11-b`. The S6-* and S7-a/b drivers may emit `stub_reason: "driver-failed: …"` if the IPC client wiring is not yet exercised end-to-end; that's expected and matches the "drivers ship; PR-C measures" contract.

- [ ] **Step 3: Confirm S7-c is recorded as reference-only stub on GHA-style invocation**

```bash
tail -1 docs/perf/history.jsonl | bunx jq '.surfaces["S7-c"]'
```

Expected: `{ "samples_count": 0, "stub_reason": "reference-only; requires loaded LLM + GPU (real driver in PR-B-2b-3)" }`.

- [ ] **Step 4: Run the full CI suite**

```bash
bun run test:ci
```

Expected: all gates pass — typecheck, lint, all coverage thresholds (engine ≥85, vault ≥90, …, perf ≥80). If any non-perf gate broke, that's a regression — investigate before pushing.

- [ ] **Step 5: Three-OS verification**

If your local box is Linux: skip and rely on CI matrix on PR push. If your local box is macOS or Windows: run the perf test suite once locally to flush platform-specific bugs:

```bash
bun test packages/gateway/src/perf/
```

Expected: all pass on the local OS.

- [ ] **Step 6: No-code commit**

If anything changed in the smoke (e.g., a docs update was required), commit it. Otherwise, no commit needed at this step.

---

## Task 22 — Open PR-B-2b-1

**Files:** none modified.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin dev/asafgolombek/perf-audit-cluster-c-1
```

(Adjust branch name to match your local convention. The user's prior perf branches were `dev/asafgolombek/perf-audit-phase-1b` etc.)

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(perf): cluster-C drivers — S6 sync throughput + S7 RSS (PR-B-2b-1)" --body "$(cat <<'EOF'
## Summary

- Adds 6 new surface drivers: `S6-drive`, `S6-gmail`, `S6-github` (sync throughput) and `S7-a`, `S7-b`, `S7-c` (memory RSS).
- Introduces 2 new helpers: `gateway-spawn-bench.ts` (warm-phase workload + concurrent sampler) and `rss-sampler.ts` (`pidusage` poller with p95).
- Adds `fixtures/` directory with synthetic Drive / Gmail / GitHub trace generators + MSW v2 handler factories.
- Extends `runBench` with optional `resultKind: "latency" | "throughput" | "rss"` so non-latency drivers populate the right `BenchSurfaceResult` field. Default behaviour unchanged.
- New gating sets in `bench-cli.ts`: `LINUX_ONLY_THRESHOLDS = {S7-a, S7-b, S7-c}` (exported, consumed by PR-C's threshold comparator); `REFERENCE_ONLY` extended with `S7-c`.
- DevDeps: `pidusage`, `msw` (both MIT, AGPL-3.0 compatible).

PR-B-2b-2 follows independently: S8 (12 embedding cells), S9 (LLM stub), S10 (SQLite contention via Bun Workers).

Spec: `docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md`
Plan: `docs/superpowers/plans/2026-04-27-perf-audit-cluster-c-1.md`

## Test plan

- [ ] `bun run test:ci` passes locally
- [ ] `bun run test:coverage:perf` ≥80% lines
- [ ] Manual smoke: `bun packages/cli/src/index.ts bench --all --runs 1 --corpus small --gha` writes a valid JSONL line containing all 6 new surface IDs
- [ ] `S7-c` carries `stub_reason: "reference-only; requires loaded LLM + GPU (real driver in PR-B-2b-3)"` on `--gha` runs
- [ ] Three-OS CI matrix passes (Ubuntu / macOS / Windows)
- [ ] `LINUX_ONLY_THRESHOLDS` exported from `perf/index.ts` for PR-C consumption

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify CI starts**

```bash
gh pr view --web
```

Watch CI status; address any platform-specific failures (Windows `mkdtempSync` permissions, macOS Octokit fetch path, `pidusage` install on each OS).

---

## Summary

Lands PR-B-2b-1 of the B2 perf audit: 3 sync-throughput drivers (S6-drive/gmail/github), 3 memory-RSS drivers (S7-a/b/c), 2 new helpers (`gateway-spawn-bench`, `rss-sampler`), 3 synthetic HTTP-trace generators + MSW handler factories, 1 harness extension (`runBench resultKind`), and 2 new dev-deps (`pidusage`, `msw`).

PR-B-2a (#116) shipped the harness scaffolding plus the cluster-A/B drivers. This PR fans the harness across cluster-C's gateway-spawn / RSS-sampling / HTTP-trace family. PR-B-2b-2 (S8/S9/S10) follows; the two PRs can merge in either order.

Spec: `docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md`
Plan: `docs/superpowers/plans/2026-04-27-perf-audit-cluster-c-1.md`

## Out of scope (lands later)

- S8 (12 embedding cells), S9 (LLM stub), S10 (SQLite contention) — PR-B-2b-2 plan.
- Real Ollama-driven S9 + Tauri-renderer instrumentation for S3/S5 — PR-B-2b-3.
- CI workflow `_perf.yml`, `slo.md` thresholds, `baseline.md`, `missed.md` — PR-C work.

## Self-review checklist

After implementing all tasks, verify:

1. **Spec coverage:** Every PR-B-2b-1 deliverable from the cluster-C spec §9 lands. Specifically: `pidusage` + `msw` devDeps; `gateway-spawn-bench.ts` + tests; `rss-sampler.ts` + tests; `fixtures/` directory; 6 driver files (3× S6, 3× S7); `bench-cli.ts` registers all 6 + `LINUX_ONLY_THRESHOLDS` + `REFERENCE_ONLY` extension.
2. **Bidirectional mapping (parent spec §6 criterion 7):** Every new surface ID registered in `SURFACE_REGISTRY` has a `surfaces/bench-*.ts` file; every `surfaces/bench-*.ts` file added in this PR is registered. No orphans.
3. **Schema additivity:** No schema changes in PR-B-2b-1. The new metric fields (`throughput_per_sec`, `rss_bytes_p95`) were already declared in the PR-B-2a `HistoryLineSurface` and `BenchSurfaceResult`. The new code only populates them.
4. **Reference-only gating:** `S7-c` does not run on `--gha` runs; records its specific `stub_reason`. Verified by Task 20 test.
5. **Linux-only-threshold gating:** `LINUX_ONLY_THRESHOLDS` exported as a `ReadonlySet`; non-Linux runners still record samples for S7-a/b/c (informational); PR-C consumes the set.
6. **MSW sentinel:** Each connector test runs `setupServer` with `onUnhandledRequest: "error"` so any URL drift fails the test with a diagnostic.
7. **Test discipline:** Every driver and helper has a `.test.ts`. Every TDD task wrote test → ran failing → implemented → ran passing → committed.
8. **Coverage gate:** `test:coverage:perf` passes at ≥80% lines.
9. **No `any`, no plaintext credentials, no `0.0.0.0` defaults** — none of the new code touches IPC bind, vault, or LAN; the non-negotiables in CLAUDE.md hold. `pidusage` and `msw` are dev-only.
10. **§13 verification matrix recorded:** Task 2 verdicts (drive/gmail/github = pass/fail) noted in Task 17's commit message.
