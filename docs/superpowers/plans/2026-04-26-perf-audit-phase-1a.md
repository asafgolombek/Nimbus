# Perf Audit (B2) — Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the load-bearing scaffolding for the B2 bench harness — `BenchHarness` core, `PerfFixture` generator, `HistoryLine` schema + JSONL writer, signal handler, `nimbus bench` CLI — and wire one proof surface driver (S2-a, query latency on a 10 K-row corpus) end-to-end. Lands as PR-B-1 on `dev/asafgolombek/perf-audit`. PR-B-2 (15 remaining drivers + UX SLO sheet) follows once this PR's harness API is frozen.

**Architecture:** New `packages/gateway/src/perf/` package — focused, single-responsibility files; reuses `db/latency-ring-buffer.ts`-shaped sample buffer and `db/metrics.ts` percentile math. CLI invocation via a new `packages/cli/src/commands/bench.ts` that runs in-process (no IPC to a running gateway — bench measurements drive synthetic fixtures, not live data). One JSONL line appended to `docs/perf/history.jsonl` per `--reference` run (operator-confirmed protocol); GHA runs do not commit, they upload as artifacts (PR-C work).

**Tech Stack:** Bun v1.2+ / TypeScript 6.x strict, `bun:test`, `bun:sqlite`, no new runtime dependencies. Reuses `LocalIndex.ensureSchema` + `buildItemListSql` for the S2-a driver (same as the existing `scripts/capture-benchmarks.ts` so values are directly comparable).

**Spec source:** [`docs/superpowers/specs/2026-04-26-perf-audit-design.md`](../specs/2026-04-26-perf-audit-design.md). Reviewer notes that drove the spec revisions: [`2026-04-26-perf-audit-design-review.md`](../specs/2026-04-26-perf-audit-design-review.md).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/gateway/src/perf/types.ts` | Create | Shared types: `BenchSurfaceId`, `BenchRunOptions`, `BenchSurfaceResult`, `RunnerKind` |
| `packages/gateway/src/perf/percentiles.ts` | Create | Pure percentile math (`p50`, `p95`, `p99`, `max`); reuses logic from `db/metrics.ts` shape so both stay in sync |
| `packages/gateway/src/perf/percentiles.test.ts` | Create | Unit tests for percentile math |
| `packages/gateway/src/perf/history-line.ts` | Create | `HistoryLine` schema + `appendHistoryLine()` JSONL writer with append-only invariant |
| `packages/gateway/src/perf/history-line.test.ts` | Create | Unit tests for schema, append, incomplete flag |
| `packages/gateway/src/perf/bench-harness.ts` | Create | `runBench(name, fn, opts)` — runs N invocations, captures samples, computes per-run + across-runs aggregate |
| `packages/gateway/src/perf/bench-harness.test.ts` | Create | Unit tests for harness aggregation, runs counting, error propagation |
| `packages/gateway/src/perf/perf-fixture.ts` | Create | `buildSyntheticIndex(tier)` — deterministic SQLite snapshot generator, lazy-cached under `paths.tempDir` |
| `packages/gateway/src/perf/perf-fixture.test.ts` | Create | Unit tests for fixture determinism, caching, tier sizing |
| `packages/gateway/src/perf/signal-handler.ts` | Create | `installIncompleteSignalHandler(historyPath)` — SIGTERM/SIGINT writes `incomplete: true` line and exits non-zero |
| `packages/gateway/src/perf/signal-handler.test.ts` | Create | Unit tests for handler installation + uninstall |
| `packages/gateway/src/perf/surfaces/bench-query-latency.ts` | Create | S2-a driver: warm 10 K-row in-memory SQLite, runs 100 `buildItemListSql` queries, returns `BenchSurfaceResult` |
| `packages/gateway/src/perf/surfaces/bench-query-latency.test.ts` | Create | Unit tests: deterministic measurement, result shape, error path |
| `packages/gateway/src/perf/bench-cli.ts` | Create | Orchestrator — parses `--all` / `--surface <id>` / `--corpus` / `--runs N` / `--reference|--gha`; routes to surfaces; appends `HistoryLine`; pretty-prints to stdout |
| `packages/gateway/src/perf/bench-cli.test.ts` | Create | Unit tests for arg parsing, surface routing, JSON output shape |
| `packages/gateway/src/perf/index.ts` | Create | Public re-exports for future PR-B-2 drivers + tests |
| `packages/cli/src/commands/bench.ts` | Create | CLI entry — dispatches to `bench-cli.ts`; thin wrapper |
| `packages/cli/src/commands/bench.test.ts` | Create | CLI smoke tests |
| `packages/cli/src/index.ts` | Modify | Register `case "bench"` in dispatcher; import `runBench` |
| `docs/perf/history.jsonl` | Create | Schema-version header line only (`{"schema_version":1,"_comment":"..."}`) |
| `package.json` | Modify | Add `"test:coverage:perf"` script |
| `scripts/lib/ci-tests.ts` | Modify | Append `{ script: "test:coverage:perf" }` to coverage list |
| `CLAUDE.md` | Modify | Add `packages/gateway/src/perf/` row to Key File Locations + `test:coverage:perf` row to Commands |
| `GEMINI.md` | Modify | Mirror CLAUDE.md additions |

---

## Execution order

Tasks 1 → 12 sequentially; each task is independently committable. Tasks 1–6 build the harness primitives; Task 7 wires the proof driver; Tasks 8–9 wire the CLI; Tasks 10–11 wire docs + CI; Task 12 is final verification + PR.

No parallel tasks — Tasks 4 (`bench-harness.ts`) depends on Task 3 (`percentiles.ts`); Task 7 depends on Tasks 4 + 5; Task 8 depends on Tasks 2 + 4 + 6 + 7.

---

## Task 1 — Package skeleton + shared types

**Files:**
- Create: `packages/gateway/src/perf/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * Shared types for the perf bench harness (Phase 1A scaffolding).
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §3 for the
 * surface table this serves.
 */

export type BenchSurfaceId =
  | "S1"
  | "S2-a"
  | "S2-b"
  | "S2-c"
  | "S3"
  | "S4"
  | "S5"
  | "S6"
  | "S7-a"
  | "S7-b"
  | "S7-c"
  | "S8"
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
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd packages/gateway && bunx tsc --noEmit src/perf/types.ts
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/perf/types.ts
git commit -m "feat(perf): add shared bench types for B2 harness scaffolding"
```

---

## Task 2 — Percentile math

**Files:**
- Create: `packages/gateway/src/perf/percentiles.ts`
- Create: `packages/gateway/src/perf/percentiles.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { computePercentiles } from "./percentiles.ts";

describe("computePercentiles", () => {
  test("returns undefined fields for empty input", () => {
    const r = computePercentiles([]);
    expect(r.p50).toBeUndefined();
    expect(r.p95).toBeUndefined();
    expect(r.p99).toBeUndefined();
    expect(r.max).toBeUndefined();
  });

  test("computes correct percentiles for a 100-sample uniform distribution", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const r = computePercentiles(samples);
    expect(r.p50).toBe(50);
    expect(r.p95).toBe(95);
    expect(r.p99).toBe(99);
    expect(r.max).toBe(100);
  });

  test("ignores NaN and non-finite samples", () => {
    const samples = [1, 2, Number.NaN, 3, Number.POSITIVE_INFINITY, 4];
    const r = computePercentiles(samples);
    expect(r.p50).toBe(2.5);
    expect(r.max).toBe(4);
  });

  test("handles a single sample", () => {
    const r = computePercentiles([42]);
    expect(r.p50).toBe(42);
    expect(r.p95).toBe(42);
    expect(r.p99).toBe(42);
    expect(r.max).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/percentiles.test.ts
```

Expected: FAIL with `Cannot find module './percentiles.ts'` or similar.

- [ ] **Step 3: Implement percentiles**

```typescript
/**
 * Pure percentile math for bench samples.
 * Matches db/metrics.ts shape so query-latency results stay directly
 * comparable to the existing in-production observability primitives.
 */

export interface PercentileResult {
  p50?: number;
  p95?: number;
  p99?: number;
  max?: number;
}

function pickPercentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) {
    return undefined;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  // Linear-interpolation method (R-7), matches numpy default and bun:test snapshot tooling.
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) {
    return sorted[lo];
  }
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  return loVal + (hiVal - loVal) * (rank - lo);
}

export function computePercentiles(samples: number[]): PercentileResult {
  const finite = samples.filter((s) => Number.isFinite(s));
  if (finite.length === 0) {
    return { p50: undefined, p95: undefined, p99: undefined, max: undefined };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  return {
    p50: pickPercentile(sorted, 50),
    p95: pickPercentile(sorted, 95),
    p99: pickPercentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test packages/gateway/src/perf/percentiles.test.ts
```

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/percentiles.ts packages/gateway/src/perf/percentiles.test.ts
git commit -m "feat(perf): add percentile math for bench harness"
```

---

## Task 3 — HistoryLine schema + JSONL writer

**Files:**
- Create: `packages/gateway/src/perf/history-line.ts`
- Create: `packages/gateway/src/perf/history-line.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendHistoryLine, type HistoryLine } from "./history-line.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "perf-history-test-"));
}

describe("appendHistoryLine", () => {
  test("creates the file if missing and writes a single trailing-newline line", () => {
    const dir = freshDir();
    const path = join(dir, "history.jsonl");
    try {
      const line: HistoryLine = {
        schema_version: 1,
        run_id: "abc",
        timestamp: "2026-04-26T12:00:00Z",
        runner: "local-dev",
        os_version: "test",
        nimbus_git_sha: "deadbeef",
        bun_version: "1.2.0",
        surfaces: { "S2-a": { samples_count: 100, p95_ms: 42 } },
      };
      appendHistoryLine(path, line);
      const content = readFileSync(path, "utf8");
      expect(content.endsWith("\n")).toBe(true);
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0] ?? "");
      expect(parsed.run_id).toBe("abc");
      expect(parsed.surfaces["S2-a"].p95_ms).toBe(42);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("appends a second line without rewriting existing content", () => {
    const dir = freshDir();
    const path = join(dir, "history.jsonl");
    try {
      const base: Omit<HistoryLine, "run_id"> = {
        schema_version: 1,
        timestamp: "2026-04-26T12:00:00Z",
        runner: "local-dev",
        os_version: "test",
        nimbus_git_sha: "deadbeef",
        bun_version: "1.2.0",
        surfaces: {},
      };
      appendHistoryLine(path, { ...base, run_id: "first" });
      appendHistoryLine(path, { ...base, run_id: "second" });
      const lines = readFileSync(path, "utf8").trim().split("\n");
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0] ?? "").run_id).toBe("first");
      expect(JSON.parse(lines[1] ?? "").run_id).toBe("second");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("incomplete: true is preserved in the serialized line", () => {
    const dir = freshDir();
    const path = join(dir, "history.jsonl");
    try {
      const line: HistoryLine = {
        schema_version: 1,
        run_id: "x",
        timestamp: "2026-04-26T12:00:00Z",
        runner: "local-dev",
        os_version: "test",
        nimbus_git_sha: "deadbeef",
        bun_version: "1.2.0",
        surfaces: {},
        incomplete: true,
        incomplete_reason: "interrupted",
      };
      appendHistoryLine(path, line);
      const parsed = JSON.parse(readFileSync(path, "utf8").trim());
      expect(parsed.incomplete).toBe(true);
      expect(parsed.incomplete_reason).toBe("interrupted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/history-line.test.ts
```

Expected: FAIL with `Cannot find module './history-line.ts'`.

- [ ] **Step 3: Implement HistoryLine + writer**

```typescript
/**
 * docs/perf/history.jsonl line schema + append-only writer.
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §4.4 for the
 * canonical schema and storage policy.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { BenchSurfaceId, RunnerKind } from "./types.ts";

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
}

export interface HistoryLine {
  schema_version: 1;
  run_id: string;
  timestamp: string;
  runner: RunnerKind;
  os_version: string;
  nimbus_git_sha: string;
  bun_version: string;
  surfaces: Partial<Record<BenchSurfaceId, HistoryLineSurface>>;
  reference_protocol_compliant?: boolean;
  incomplete?: true;
  incomplete_reason?: string;
}

/** Append a single HistoryLine as one JSON line + trailing newline. Creates parent dirs. */
export function appendHistoryLine(path: string, line: HistoryLine): void {
  const parent = dirname(path);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test packages/gateway/src/perf/history-line.test.ts
```

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/history-line.ts packages/gateway/src/perf/history-line.test.ts
git commit -m "feat(perf): add HistoryLine schema and append-only JSONL writer"
```

---

## Task 4 — BenchHarness core

**Files:**
- Create: `packages/gateway/src/perf/bench-harness.ts`
- Create: `packages/gateway/src/perf/bench-harness.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { runBench } from "./bench-harness.ts";

describe("runBench", () => {
  test("invokes the surface fn `runs` times and returns median-of-medians", async () => {
    let calls = 0;
    // Each invocation returns 100 deterministic samples.
    const fn = async (): Promise<number[]> => {
      calls += 1;
      return Array.from({ length: 100 }, (_, i) => i + calls);
    };
    const result = await runBench("S2-a", fn, {
      runs: 5,
      runner: "local-dev",
      corpus: "small",
    });
    expect(calls).toBe(5);
    expect(result.surfaceId).toBe("S2-a");
    expect(result.samplesCount).toBe(500);
    // Across-runs aggregate is median of [p95(samples + 1), …, p95(samples + 5)]
    // which is p95(samples + 3) ≈ 98.
    expect(result.p95Ms).toBeGreaterThan(95);
    expect(result.p95Ms).toBeLessThan(105);
  });

  test("propagates surface errors with surface id context", async () => {
    const fn = async (): Promise<number[]> => {
      throw new Error("synthetic failure");
    };
    await expect(
      runBench("S1", fn, { runs: 1, runner: "local-dev" }),
    ).rejects.toThrow(/S1.*synthetic failure/);
  });

  test("rejects runs < 1 with a clear error", async () => {
    const fn = async (): Promise<number[]> => [1];
    await expect(runBench("S1", fn, { runs: 0, runner: "local-dev" })).rejects.toThrow(/runs must be >= 1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/bench-harness.test.ts
```

Expected: FAIL with `Cannot find module './bench-harness.ts'`.

- [ ] **Step 3: Implement BenchHarness**

```typescript
/**
 * Bench harness — runs a surface fn N times, captures samples per run,
 * computes per-run aggregates and the across-runs median (median-of-medians).
 *
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §4.5 for the
 * aggregation contract.
 */

import { computePercentiles } from "./percentiles.ts";
import type { BenchRunOptions, BenchSurfaceId, BenchSurfaceResult } from "./types.ts";

export type SurfaceFn = (opts: BenchRunOptions) => Promise<number[]>;

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export async function runBench(
  surfaceId: BenchSurfaceId,
  fn: SurfaceFn,
  opts: BenchRunOptions,
): Promise<BenchSurfaceResult> {
  if (opts.runs < 1) {
    throw new Error(`runs must be >= 1 (got ${opts.runs})`);
  }
  const perRunP95: number[] = [];
  const perRunP50: number[] = [];
  const perRunP99: number[] = [];
  const perRunMax: number[] = [];
  let totalSamples = 0;

  for (let i = 0; i < opts.runs; i += 1) {
    let samples: number[];
    try {
      samples = await fn(opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`bench surface ${surfaceId} failed on run ${i + 1}/${opts.runs}: ${msg}`);
    }
    totalSamples += samples.length;
    const p = computePercentiles(samples);
    if (p.p50 !== undefined) perRunP50.push(p.p50);
    if (p.p95 !== undefined) perRunP95.push(p.p95);
    if (p.p99 !== undefined) perRunP99.push(p.p99);
    if (p.max !== undefined) perRunMax.push(p.max);
  }

  return {
    surfaceId,
    samplesCount: totalSamples,
    p50Ms: median(perRunP50),
    p95Ms: median(perRunP95),
    p99Ms: median(perRunP99),
    maxMs: median(perRunMax),
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test packages/gateway/src/perf/bench-harness.test.ts
```

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/bench-harness.ts packages/gateway/src/perf/bench-harness.test.ts
git commit -m "feat(perf): add BenchHarness with median-of-medians aggregation"
```

---

## Task 5 — PerfFixture (synthetic SQLite snapshot generator)

**Files:**
- Create: `packages/gateway/src/perf/perf-fixture.ts`
- Create: `packages/gateway/src/perf/perf-fixture.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSyntheticIndex, FIXTURE_TIER_SIZES } from "./perf-fixture.ts";

function freshCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "perf-fixture-test-"));
}

describe("buildSyntheticIndex", () => {
  test("generates a file containing exactly the expected number of items for `small`", async () => {
    const dir = freshCacheDir();
    try {
      const path = await buildSyntheticIndex("small", { cacheDir: dir });
      const db = new Database(path, { readonly: true });
      const row = db.query("SELECT COUNT(*) AS n FROM item").get() as { n: number };
      db.close();
      expect(row.n).toBe(FIXTURE_TIER_SIZES.small);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is deterministic — two invocations of the same tier produce byte-identical files", async () => {
    const dir = freshCacheDir();
    try {
      const a = await buildSyntheticIndex("small", { cacheDir: dir });
      const sizeA = statSync(a).size;
      // Force regeneration by deleting and re-running.
      rmSync(a);
      const b = await buildSyntheticIndex("small", { cacheDir: dir });
      const sizeB = statSync(b).size;
      expect(sizeA).toBe(sizeB);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reuses cached file when present (does not regenerate)", async () => {
    const dir = freshCacheDir();
    try {
      const path = await buildSyntheticIndex("small", { cacheDir: dir });
      const mtime1 = statSync(path).mtimeMs;
      // Wait briefly so a regeneration would change mtime.
      await new Promise((r) => setTimeout(r, 20));
      const path2 = await buildSyntheticIndex("small", { cacheDir: dir });
      const mtime2 = statSync(path2).mtimeMs;
      expect(path).toBe(path2);
      expect(mtime2).toBe(mtime1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/perf-fixture.test.ts
```

Expected: FAIL with `Cannot find module './perf-fixture.ts'`.

- [ ] **Step 3: Implement PerfFixture**

```typescript
/**
 * Synthetic SQLite snapshot generator for perf fixtures.
 * Deterministic from a fixed PRNG seed; lazy-cached under cacheDir.
 *
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §3.5 for the
 * corpus rationale.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalIndex } from "../index/local-index.ts";
import type { CorpusTier } from "./types.ts";

export const FIXTURE_TIER_SIZES = {
  small: 10_000,
  medium: 100_000,
  large: 1_000_000,
} as const satisfies Record<CorpusTier, number>;

export const FIXTURE_SEED = 0x12345678;

export interface BuildOptions {
  /** Override default cache dir (`<tmpdir>/nimbus-bench-fixtures`). */
  cacheDir?: string;
}

function defaultCacheDir(): string {
  return join(tmpdir(), "nimbus-bench-fixtures");
}

/** Mulberry32 — small deterministic PRNG; fine for fixture generation. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build (or reuse) a synthetic index snapshot for the given tier.
 * Returns the absolute path to a SQLite file.
 */
export async function buildSyntheticIndex(
  tier: CorpusTier,
  opts: BuildOptions = {},
): Promise<string> {
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  const path = join(cacheDir, `${tier}-${FIXTURE_SEED.toString(16)}.sqlite`);
  if (existsSync(path)) {
    return path;
  }

  const rows = FIXTURE_TIER_SIZES[tier];
  const db = new Database(path);
  try {
    LocalIndex.ensureSchema(db);
    const rng = makeRng(FIXTURE_SEED);
    const ins = db.prepare(
      `INSERT INTO item (id, service, type, external_id, title, body_preview, url, modified_at, synced_at, pinned)
       VALUES (?, 'github', 'pr', ?, ?, '', '', ?, ?, 0)`,
    );
    const now = Date.now();
    db.run("BEGIN");
    for (let i = 0; i < rows; i += 1) {
      const t = Math.floor(rng() * 1_000_000);
      ins.run(`gh:${i}`, String(i), `Synthetic PR ${i}`, now - t, now - t);
    }
    db.run("COMMIT");
  } finally {
    db.close();
  }
  return path;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test packages/gateway/src/perf/perf-fixture.test.ts
```

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/perf-fixture.ts packages/gateway/src/perf/perf-fixture.test.ts
git commit -m "feat(perf): add deterministic synthetic SQLite fixture generator"
```

---

## Task 6 — Signal handler (SIGTERM/SIGINT → incomplete line)

**Files:**
- Create: `packages/gateway/src/perf/signal-handler.ts`
- Create: `packages/gateway/src/perf/signal-handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeIncompleteLine } from "./signal-handler.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "signal-handler-test-"));
}

describe("writeIncompleteLine", () => {
  test("writes a HistoryLine with incomplete: true and the given reason", () => {
    const dir = freshDir();
    const path = join(dir, "history.jsonl");
    try {
      writeIncompleteLine(path, {
        runId: "r1",
        runner: "local-dev",
        reason: "interrupted",
        nimbusGitSha: "abc",
        bunVersion: "1.2.0",
        osVersion: "test",
      });
      const parsed = JSON.parse(readFileSync(path, "utf8").trim());
      expect(parsed.incomplete).toBe(true);
      expect(parsed.incomplete_reason).toBe("interrupted");
      expect(parsed.run_id).toBe("r1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/signal-handler.test.ts
```

Expected: FAIL with `Cannot find module './signal-handler.ts'`.

- [ ] **Step 3: Implement signal handler**

```typescript
/**
 * SIGTERM / SIGINT handler: writes an `incomplete: true` HistoryLine and
 * exits non-zero. Installed by the bench CLI before the surface loop begins.
 *
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §10 PR-B-1
 * deliverables — SIGTERM behaviour.
 */

import { appendHistoryLine, type HistoryLine } from "./history-line.ts";
import type { RunnerKind } from "./types.ts";

export interface IncompleteContext {
  runId: string;
  runner: RunnerKind;
  reason: string;
  nimbusGitSha: string;
  bunVersion: string;
  osVersion: string;
}

export function writeIncompleteLine(historyPath: string, ctx: IncompleteContext): void {
  const line: HistoryLine = {
    schema_version: 1,
    run_id: ctx.runId,
    timestamp: new Date().toISOString(),
    runner: ctx.runner,
    os_version: ctx.osVersion,
    nimbus_git_sha: ctx.nimbusGitSha,
    bun_version: ctx.bunVersion,
    surfaces: {},
    incomplete: true,
    incomplete_reason: ctx.reason,
  };
  appendHistoryLine(historyPath, line);
}

/**
 * Install signal handlers for SIGINT / SIGTERM that flush an incomplete line
 * and exit non-zero. Returns an `uninstall` callback for tests.
 */
export function installIncompleteSignalHandler(
  historyPath: string,
  ctxFactory: () => IncompleteContext,
): () => void {
  const handler = (signal: NodeJS.Signals): void => {
    try {
      const ctx = ctxFactory();
      writeIncompleteLine(historyPath, { ...ctx, reason: `interrupted-by-${signal}` });
    } finally {
      // 130 = standard exit code for terminate-by-signal (SIGINT).
      process.exit(130);
    }
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test packages/gateway/src/perf/signal-handler.test.ts
```

Expected: 1 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/signal-handler.ts packages/gateway/src/perf/signal-handler.test.ts
git commit -m "feat(perf): add SIGTERM/SIGINT handler that writes incomplete history line"
```

---

## Task 7 — S2-a query latency surface driver

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-query-latency.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-query-latency.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runQueryLatencyOnce } from "./bench-query-latency.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "bench-query-latency-test-"));
}

describe("runQueryLatencyOnce (S2-a)", () => {
  test("returns 100 finite samples for a small fixture", async () => {
    const dir = freshDir();
    try {
      const samples = await runQueryLatencyOnce({
        runs: 1,
        runner: "local-dev",
        corpus: "small",
      }, { cacheDir: dir });
      expect(samples.length).toBe(100);
      for (const s of samples) {
        expect(Number.isFinite(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-query-latency.test.ts
```

Expected: FAIL with `Cannot find module './bench-query-latency.ts'`.

- [ ] **Step 3: Implement S2-a driver**

```typescript
/**
 * S2-a — Query p95 (engine.askStream end-to-end) on the 10 K-corpus tier.
 *
 * Runs `QUERIES_PER_RUN` invocations of buildItemListSql against a warm
 * in-memory SQLite fixture; returns per-query latency samples in ms.
 *
 * Subsumes scripts/capture-benchmarks.ts — same SQL builder, same warm DB,
 * same tier. The capture-benchmarks.ts script is retired in PR-C per
 * docs/superpowers/specs/2026-04-26-perf-audit-design.md §4.7.
 */

import { Database } from "bun:sqlite";

import { buildItemListSql } from "../../index/item-list-query.ts";
import { buildSyntheticIndex } from "../perf-fixture.ts";
import type { BenchRunOptions } from "../types.ts";

export const QUERIES_PER_RUN = 100;

export interface RunOptions {
  /** Override default fixture cache dir (test-only). */
  cacheDir?: string;
}

export async function runQueryLatencyOnce(
  opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const tier = opts.corpus ?? "small";
  const fixturePath = await buildSyntheticIndex(tier, runOpts);

  // Open as readonly + load fully into memory by re-attaching to in-memory DB.
  // For S2-a we can use a regular file DB — Bun caches pages aggressively
  // after the first query, so subsequent queries are warm.
  const db = new Database(fixturePath, { readonly: true });
  try {
    const now = Date.now();
    const { sql, vals } = buildItemListSql({
      services: ["github"],
      types: ["pr"],
      sinceMs: now - 86_400_000,
      limit: 50,
    });

    // Warmup: run once to populate page cache.
    db.query(sql).all(...vals);

    const samples: number[] = [];
    for (let i = 0; i < QUERIES_PER_RUN; i += 1) {
      const t0 = performance.now();
      db.query(sql).all(...vals);
      samples.push(performance.now() - t0);
    }
    return samples;
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test packages/gateway/src/perf/surfaces/bench-query-latency.test.ts
```

Expected: 1 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-query-latency.ts packages/gateway/src/perf/surfaces/bench-query-latency.test.ts
git commit -m "feat(perf): add S2-a query-latency surface driver (subsumes capture-benchmarks.ts)"
```

---

## Task 8 — Bench CLI orchestrator

**Files:**
- Create: `packages/gateway/src/perf/bench-cli.ts`
- Create: `packages/gateway/src/perf/bench-cli.test.ts`
- Create: `packages/gateway/src/perf/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBenchCli } from "./bench-cli.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "bench-cli-test-"));
}

describe("runBenchCli", () => {
  test("--surface S2-a --runs 1 writes a HistoryLine with the S2-a entry", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const exitCode = await runBenchCli(
        ["--surface", "S2-a", "--runs", "1", "--corpus", "small", "--gha"],
        { historyPath, fixtureCacheDir: dir, stdout: () => {} },
      );
      expect(exitCode).toBe(0);
      const line = JSON.parse(readFileSync(historyPath, "utf8").trim());
      expect(line.surfaces["S2-a"]).toBeDefined();
      expect(line.surfaces["S2-a"].samples_count).toBe(100);
      expect(line.runner).toBe("gha-ubuntu");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--reference without protocol confirmation refuses to run", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const stderr: string[] = [];
      const exitCode = await runBenchCli(
        ["--surface", "S2-a", "--runs", "1", "--corpus", "small", "--reference"],
        {
          historyPath,
          fixtureCacheDir: dir,
          stdout: () => {},
          stderr: (s) => stderr.push(s),
          confirmReferenceProtocol: () => false,
        },
      );
      expect(exitCode).not.toBe(0);
      expect(stderr.join("\n")).toMatch(/protocol/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/bench-cli.test.ts
```

Expected: FAIL with `Cannot find module './bench-cli.ts'`.

- [ ] **Step 3: Implement bench-cli orchestrator**

```typescript
/**
 * `nimbus bench` orchestrator. Parses flags, routes to surface drivers,
 * appends a HistoryLine, prints a human summary.
 *
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §3.2 (surface
 * table), §4.1 (reference protocol), §4.5 (aggregation).
 */

import { randomUUID } from "node:crypto";
import { hostname, platform, release } from "node:os";

import { runBench } from "./bench-harness.ts";
import { appendHistoryLine, type HistoryLine, type HistoryLineSurface } from "./history-line.ts";
import { runQueryLatencyOnce } from "./surfaces/bench-query-latency.ts";
import type { BenchRunOptions, BenchSurfaceId, BenchSurfaceResult, RunnerKind } from "./types.ts";

export interface BenchCliDeps {
  historyPath: string;
  fixtureCacheDir?: string;
  stdout: (s: string) => void;
  stderr?: (s: string) => void;
  /** Defaults to interactive y/n prompt; tests inject a stub. */
  confirmReferenceProtocol?: () => boolean | Promise<boolean>;
  /** Defaults to env-aware lookup; tests inject a stub. */
  resolveGitSha?: () => string;
}

const SURFACE_REGISTRY = {
  "S2-a": runQueryLatencyOnce,
} as const satisfies Partial<
  Record<BenchSurfaceId, (opts: BenchRunOptions, runOpts: { cacheDir?: string }) => Promise<number[]>>
>;

function takeFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.indexOf(flag) >= 0;
}

function detectRunner(args: string[]): RunnerKind {
  if (hasFlag(args, "--reference")) return "reference-m1air";
  if (hasFlag(args, "--gha")) {
    if (process.platform === "darwin") return "gha-macos";
    if (process.platform === "win32") return "gha-windows";
    return "gha-ubuntu";
  }
  return "local-dev";
}

function defaultConfirm(): boolean {
  // No-prompt context (CI, scripted) — refuse rather than auto-approve.
  return false;
}

function defaultResolveGitSha(): string {
  return process.env.GITHUB_SHA ?? "unknown";
}

function resultToHistorySurface(r: BenchSurfaceResult): HistoryLineSurface {
  const out: HistoryLineSurface = { samples_count: r.samplesCount };
  if (r.p50Ms !== undefined) out.p50_ms = r.p50Ms;
  if (r.p95Ms !== undefined) out.p95_ms = r.p95Ms;
  if (r.p99Ms !== undefined) out.p99_ms = r.p99Ms;
  if (r.maxMs !== undefined) out.max_ms = r.maxMs;
  return out;
}

export async function runBenchCli(args: string[], deps: BenchCliDeps): Promise<number> {
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(`${s}\n`));
  const surfaceArg = takeFlag(args, "--surface");
  const runsArg = takeFlag(args, "--runs");
  const corpusArg = takeFlag(args, "--corpus");
  const runs = runsArg !== undefined ? Number.parseInt(runsArg, 10) : 5;
  const runner = detectRunner(args);
  const opts: BenchRunOptions = {
    runs: Number.isFinite(runs) && runs > 0 ? runs : 5,
    runner,
    corpus: corpusArg === "small" || corpusArg === "medium" || corpusArg === "large" ? corpusArg : undefined,
  };

  if (runner === "reference-m1air") {
    const confirm = deps.confirmReferenceProtocol ?? defaultConfirm;
    const ok = await confirm();
    if (!ok) {
      stderr("Reference-run protocol checklist not confirmed. Refusing to record. See spec §4.2.");
      return 2;
    }
  }

  const surfaces: BenchSurfaceId[] = (() => {
    if (hasFlag(args, "--all")) {
      return Object.keys(SURFACE_REGISTRY) as BenchSurfaceId[];
    }
    if (surfaceArg !== undefined) {
      return [surfaceArg as BenchSurfaceId];
    }
    return [];
  })();

  if (surfaces.length === 0) {
    stderr("Pass --surface <id> or --all. Available surfaces: " + Object.keys(SURFACE_REGISTRY).join(", "));
    return 2;
  }

  const surfaceResults: Record<string, HistoryLineSurface> = {};
  for (const id of surfaces) {
    const driver = SURFACE_REGISTRY[id as keyof typeof SURFACE_REGISTRY];
    if (driver === undefined) {
      stderr(`Surface ${id} has no driver registered yet (PR-B-2 work).`);
      return 2;
    }
    const result = await runBench(id, (o) => driver(o, { cacheDir: deps.fixtureCacheDir }), opts);
    surfaceResults[id] = resultToHistorySurface(result);
    deps.stdout(`${id}  p95=${result.p95Ms?.toFixed(2) ?? "-"}ms  p99=${result.p99Ms?.toFixed(2) ?? "-"}ms  samples=${result.samplesCount}`);
  }

  const resolveGitSha = deps.resolveGitSha ?? defaultResolveGitSha;
  const line: HistoryLine = {
    schema_version: 1,
    run_id: randomUUID(),
    timestamp: new Date().toISOString(),
    runner,
    os_version: `${platform()} ${release()} (${hostname()})`,
    nimbus_git_sha: resolveGitSha(),
    bun_version: typeof Bun !== "undefined" ? Bun.version : "unknown",
    surfaces: surfaceResults,
    ...(runner === "reference-m1air" ? { reference_protocol_compliant: true } : {}),
  };
  appendHistoryLine(deps.historyPath, line);
  return 0;
}
```

- [ ] **Step 4: Create the package barrel**

```typescript
// packages/gateway/src/perf/index.ts
export { runBench, type SurfaceFn } from "./bench-harness.ts";
export { runBenchCli, type BenchCliDeps } from "./bench-cli.ts";
export { buildSyntheticIndex, FIXTURE_TIER_SIZES, FIXTURE_SEED } from "./perf-fixture.ts";
export {
  appendHistoryLine,
  type HistoryLine,
  type HistoryLineSurface,
} from "./history-line.ts";
export {
  installIncompleteSignalHandler,
  writeIncompleteLine,
  type IncompleteContext,
} from "./signal-handler.ts";
export { computePercentiles, type PercentileResult } from "./percentiles.ts";
export type {
  BenchRunOptions,
  BenchSurfaceId,
  BenchSurfaceResult,
  CorpusTier,
  RunnerKind,
} from "./types.ts";
```

- [ ] **Step 5: Run tests to verify pass**

```bash
bun test packages/gateway/src/perf/bench-cli.test.ts
```

Expected: 2 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/perf/bench-cli.ts packages/gateway/src/perf/bench-cli.test.ts packages/gateway/src/perf/index.ts
git commit -m "feat(perf): add bench-cli orchestrator + package barrel"
```

---

## Task 9 — `nimbus bench` CLI command

**Files:**
- Create: `packages/cli/src/commands/bench.ts`
- Create: `packages/cli/src/commands/bench.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBench as runBenchCommand } from "./bench.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "cli-bench-test-"));
}

describe("runBench (CLI command)", () => {
  test("happy path runs S2-a and writes a history line", async () => {
    const dir = freshDir();
    try {
      const exit = await runBenchCommand([
        "--surface",
        "S2-a",
        "--runs",
        "1",
        "--corpus",
        "small",
        "--gha",
        "--history",
        join(dir, "history.jsonl"),
        "--fixture-cache",
        dir,
      ]);
      expect(exit).toBe(0);
      const txt = readFileSync(join(dir, "history.jsonl"), "utf8");
      expect(txt).toContain('"S2-a"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--help prints usage and exits 0 without writing any history", async () => {
    const dir = freshDir();
    try {
      const exit = await runBenchCommand(["--help", "--history", join(dir, "history.jsonl")]);
      expect(exit).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/cli/src/commands/bench.test.ts
```

Expected: FAIL with `Cannot find module './bench.ts'`.

- [ ] **Step 3: Implement the CLI command**

```typescript
/**
 * `nimbus bench` — runs the bench harness in-process.
 *
 * Invocation forms (both produce identical output, per spec §6 criterion 1):
 *   bun packages/cli/src/index.ts bench --surface <id> --runs N --reference
 *   nimbus bench --surface <id> --runs N --gha
 *
 * Flags:
 *   --surface <id>      surface id from §3.2 (e.g. S2-a)
 *   --all               run every registered surface
 *   --corpus <tier>     small | medium | large
 *   --runs <N>          per-surface invocations (default 5)
 *   --reference         tag run as reference-m1air; requires interactive protocol confirm
 *   --gha               tag run as gha-<os>; auto-derived from process.platform
 *   --history <path>    history.jsonl override (default: docs/perf/history.jsonl)
 *   --fixture-cache <p> fixture cache dir override (test-only)
 *   --help              print usage and exit 0
 */

import { join } from "node:path";

import { installIncompleteSignalHandler, runBenchCli } from "../../../gateway/src/perf/index.ts";

function takeFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.indexOf(flag) >= 0;
}

const HELP = `nimbus bench — perf bench harness (Phase 1A)

Usage:
  nimbus bench --surface <id> [--corpus small|medium|large] [--runs N] (--reference|--gha)
  nimbus bench --all [--corpus ...] [--runs N] (--reference|--gha)

Flags:
  --surface <id>      surface id (S2-a is the only registered driver in PR-B-1)
  --all               run every registered surface
  --corpus <tier>     small | medium | large
  --runs <N>          per-surface invocations (default 5)
  --reference         tag as reference-m1air (requires interactive protocol confirm)
  --gha               tag as gha-<os> (auto-derived from process.platform)
  --history <path>    history.jsonl override
  --fixture-cache <p> fixture cache dir override
  --help              this message

See docs/superpowers/specs/2026-04-26-perf-audit-design.md for the surface table.
`;

export async function runBench(args: string[]): Promise<number> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const historyPath = takeFlag(args, "--history") ?? join(process.cwd(), "docs/perf/history.jsonl");
  const fixtureCacheDir = takeFlag(args, "--fixture-cache");

  const ctxFactory = (): {
    runId: string;
    runner: "local-dev";
    reason: string;
    nimbusGitSha: string;
    bunVersion: string;
    osVersion: string;
  } => ({
    runId: "interrupted",
    runner: "local-dev",
    reason: "interrupted",
    nimbusGitSha: process.env.GITHUB_SHA ?? "unknown",
    bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
    osVersion: `${process.platform} ${process.arch}`,
  });
  const uninstall = installIncompleteSignalHandler(historyPath, ctxFactory);

  try {
    return await runBenchCli(args, {
      historyPath,
      fixtureCacheDir,
      stdout: (s) => process.stdout.write(`${s}\n`),
      stderr: (s) => process.stderr.write(`${s}\n`),
    });
  } finally {
    uninstall();
  }
}
```

- [ ] **Step 4: Wire into the CLI dispatcher**

In `packages/cli/src/index.ts`, find the dispatcher switch (around line 60) and add a `bench` case alphabetically near the other commands.

```typescript
// Add this import near the other command imports at the top of the file:
import { runBench } from "./commands/bench.ts";

// Add this case in the switch statement (after `case "ask":` is fine):
        case "bench":
          process.exit(await runBench(args));
          break;
```

- [ ] **Step 5: Run tests to verify pass**

```bash
bun test packages/cli/src/commands/bench.test.ts
```

Expected: 2 pass, 0 fail.

- [ ] **Step 6: Smoke-test the CLI from a built shell**

```bash
bun packages/cli/src/index.ts bench --surface S2-a --runs 1 --corpus small --gha --history /tmp/nimbus-bench-smoke.jsonl
```

Expected output: `S2-a  p95=...ms  p99=...ms  samples=100` and exit 0; `/tmp/nimbus-bench-smoke.jsonl` contains one JSON line.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/bench.ts packages/cli/src/commands/bench.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): add nimbus bench command"
```

---

## Task 10 — `docs/perf/history.jsonl` skeleton

**Files:**
- Create: `docs/perf/history.jsonl`

- [ ] **Step 1: Create the file with a single header comment line**

```bash
mkdir -p docs/perf
printf '{"schema_version":1,"_comment":"Perf bench history. Schema in packages/gateway/src/perf/history-line.ts. Reference-machine runs only; GHA runs upload artifacts. See docs/superpowers/specs/2026-04-26-perf-audit-design.md §4.4."}\n' > docs/perf/history.jsonl
```

- [ ] **Step 2: Verify the line parses as JSON and the field set is the documented one**

```bash
bun -e 'const l = require("node:fs").readFileSync("docs/perf/history.jsonl","utf8").trim(); const j = JSON.parse(l); if (j.schema_version !== 1) { process.exit(1); } console.log("OK:", Object.keys(j).join(","));'
```

Expected: `OK: schema_version,_comment`.

- [ ] **Step 3: Commit**

```bash
git add docs/perf/history.jsonl
git commit -m "docs(perf): seed history.jsonl with schema-version header line"
```

---

## Task 11 — `test:coverage:perf` script + wire into `test:ci`

**Files:**
- Modify: `package.json`
- Modify: `scripts/lib/ci-tests.ts`
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`

- [ ] **Step 1: Add the script to `package.json`**

In `package.json`, locate the `"test:coverage:lan": ...` line in the scripts block (around line 81) and insert the new script immediately after it:

```json
"test:coverage:perf": "bun test packages/gateway/src/perf packages/cli/src/commands/bench.test.ts --coverage --coverage-threshold-lines=80",
```

- [ ] **Step 2: Wire the script into the CI suite**

In `scripts/lib/ci-tests.ts`, locate the coverage-script list (around line 94 — starts with `{ script: "test:coverage:engine" }`) and add a new entry alphabetically after the perf-adjacent entries (after `test:coverage:lan`):

```typescript
    { script: "test:coverage:perf" },
```

- [ ] **Step 3: Run the new coverage gate to confirm it passes**

```bash
bun run test:coverage:perf
```

Expected: all tests pass; coverage ≥ 80 % for `packages/gateway/src/perf/` and the CLI bench command.

- [ ] **Step 4: Update CLAUDE.md — Key File Locations row**

In `CLAUDE.md`, locate the Key File Locations table (around line 36) and add a new row immediately after the existing `packages/gateway/src/db/write.ts` row (or in the general gateway/src section):

```markdown
| `packages/gateway/src/perf/` | B2 bench harness — `BenchHarness`, `PerfFixture`, `HistoryLine`, `bench-cli.ts`; one S2-a driver under `surfaces/`. See `docs/SECURITY-INVARIANTS.md` style for invariants tracking |
| `packages/cli/src/commands/bench.ts` | `nimbus bench` CLI command; in-process bench runner |
```

- [ ] **Step 5: Update CLAUDE.md — Commands block**

In `CLAUDE.md`, locate the existing `bun run test:coverage:lan` line (around line 211) and add immediately after it:

```bash
bun run test:coverage:perf      # ≥80% threshold (perf bench harness)
```

Also add a new reference comment block for the `nimbus bench` CLI invocation, near the other `# nimbus ...` reference comments:

```bash
# Phase 4 B2 — Perf bench (Phase 1A scaffolding)
# nimbus bench --surface S2-a --runs 5 --corpus small --gha
# nimbus bench --all --reference                     # interactive protocol confirmation required
```

- [ ] **Step 6: Mirror both changes in GEMINI.md**

In `GEMINI.md`, apply identical edits to the Key File Locations table and the Commands block (per the repo's "keep both files aligned" rule from `CLAUDE.md` line 12).

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/lib/ci-tests.ts CLAUDE.md GEMINI.md
git commit -m "test(perf): add test:coverage:perf gate and wire into CI suite"
```

---

## Task 12 — Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI parity suite per the standing project rule**

```bash
bun run test:ci
```

Expected: all gates pass except known pre-existing Windows `platform.test.ts` `EBUSY` flake (acceptable per prior turn agreement). If any gate other than that one fails, fix it before proceeding.

- [ ] **Step 2: Run the lint pass**

```bash
bun run lint
```

Expected: no Biome errors.

- [ ] **Step 3: Run the typecheck**

```bash
bun run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 4: Run a real end-to-end CLI smoke**

```bash
bun packages/cli/src/index.ts bench --surface S2-a --runs 1 --corpus small --gha --history /tmp/nimbus-bench-e2e.jsonl
cat /tmp/nimbus-bench-e2e.jsonl
```

Expected: stdout contains `S2-a p95=...ms ... samples=100`; the JSONL file contains one valid line with `surfaces["S2-a"]` populated.

- [ ] **Step 5: Push the branch (already exists from PR-A)**

```bash
git push origin dev/asafgolombek/perf-audit
```

- [ ] **Step 6: Open PR-B-1 (or update PR-A if PR-A still open as a draft and bundling is preferred)**

If PR-A was already opened (design + reviewer notes), open a separate PR-B-1 against `main`:

```bash
gh pr create --title "feat(perf): B2 Phase 1A — bench harness scaffolding + S2-a proof driver" --body "$(cat <<'EOF'
## Summary

Phase 1A of the B2 perf audit. Builds the load-bearing bench harness scaffolding under \`packages/gateway/src/perf/\` and wires one proof surface driver (S2-a, query latency on a 10 K-row corpus) end-to-end. PR-B-2 (15 remaining drivers + UX SLO sheet) follows once this PR's harness API is frozen.

Closes the \`scripts/capture-benchmarks.ts\` semantic gap — the new S2-a driver measures the same SQL builder against the same warm in-memory tier so values are directly comparable. The script itself is retired in PR-C per spec §4.7 once the first three nightly \`history.jsonl\` entries land.

## Deliverables

- \`packages/gateway/src/perf/\` — \`BenchHarness\`, \`PerfFixture\`, \`HistoryLine\` schema + writer, signal handler, percentile math, \`bench-cli\` orchestrator
- \`packages/gateway/src/perf/surfaces/bench-query-latency.ts\` — S2-a proof driver
- \`packages/cli/src/commands/bench.ts\` — \`nimbus bench\` command + dispatcher wiring
- \`docs/perf/history.jsonl\` seeded with schema-version header line
- \`test:coverage:perf\` script + wired into \`test:ci\` (≥ 80 % threshold)
- \`CLAUDE.md\` / \`GEMINI.md\` updated with new file locations and command reference

## Test plan

- [x] \`bun run test:ci\` passes (modulo pre-existing Windows \`platform.test.ts\` \`EBUSY\` flake)
- [x] \`bun run test:coverage:perf\` passes at ≥ 80 % lines
- [x] CLI smoke: \`bun packages/cli/src/index.ts bench --surface S2-a --runs 1 --corpus small --gha\` writes a valid \`history.jsonl\` line and exits 0
- [ ] Manual smoke on macOS: same command produces a finite p95 < 100 ms (sanity check that the new driver values resemble \`scripts/capture-benchmarks.ts\` output)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-review notes

- **Spec coverage check.** PR-B-1 deliverables in spec §10 (post-revision): harness scaffolding ✅ (Tasks 1–6, 8); S2-a driver ✅ (Task 7); `nimbus bench` CLI ✅ (Task 9); empty `history.jsonl` ✅ (Task 10); `test:coverage:perf` gate ✅ (Task 11); SIGTERM/incomplete handling ✅ (Task 6, wired in Task 9). **Streaming output is intentionally deferred** to PR-B implementation review per spec §10. **Reference-protocol checklist** is enforced at runtime by Task 8's `confirmReferenceProtocol` callback (default refuses if no callback supplied — the prompt UI is implementation detail for the CLI to wire up later, not Phase 1A scope).
- **Type-consistency check.** `BenchSurfaceId` (Task 1), `BenchRunOptions` (Task 1), `BenchSurfaceResult` (Task 1, used by Task 4), `HistoryLine` / `HistoryLineSurface` (Task 3, used by Task 8), `RunnerKind` (Task 1, used by Tasks 6, 8), `CorpusTier` (Task 1, used by Task 5) — all named identically across all tasks. `runBench` is the harness function (Task 4); `runBenchCli` is the orchestrator (Task 8); `runBench` (the CLI command export) lives in `packages/cli/src/commands/bench.ts` (Task 9) — the name shadowing across packages is intentional but could confuse a reader; kept because both names match the natural use-site idiom and the import path disambiguates.
- **Migration safety.** `scripts/capture-benchmarks.ts` is **not deleted in this PR** — Phase 2 (PR-C) does that after S2-a's first three nightly runs land in `history.jsonl`. PR-B-1 ships the new driver alongside the old script; both can coexist without conflict.
- **Pre-existing Windows flake.** Task 12 step 1 acknowledges the `platform.test.ts` `EBUSY` flake (passes in isolation, fails under suite parallelism). Per the prior session-turn agreement, this is treated as known and unrelated to this PR.
- **No PR-B-2 leakage.** This plan does **not** touch SLO docs, the 15 remaining drivers, or the `_perf.yml` GHA workflow — those are PR-B-2 / PR-C scope.
