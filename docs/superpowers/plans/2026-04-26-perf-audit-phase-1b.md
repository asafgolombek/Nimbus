# Perf Audit (B2) — Phase 1B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 8 cluster-A and cluster-B surface drivers (S1 cold start, S2-b/c query-tier, S4 TUI first-paint, S11-a/b CLI overhead, plus S3/S5 stubs), one shared process-spawn helper, and the published UX SLO sheet (`docs/perf/slo-ux.md`). Lands as PR-B-2a on `dev/asafgolombek/perf-audit`. PR-B-2b (cluster C — 7 workload drivers) follows once this PR's cross-process measurement helper has merged.

**Architecture:** A new `process-spawn-bench.ts` helper encapsulates the "spawn a child process, time from spawn to a stdout marker (or to exit), kill cleanly" measurement pattern — reused by S1, S4, S11-a, S11-b. The four query / cold-start / CLI drivers each return per-sample arrays the existing `runBench` consumes unchanged. S3 and S5 ship as stub drivers that emit a per-surface `stub_reason` field (small additive schema bump on `HistoryLineSurface`) so § 6 acceptance criterion 7 (bidirectional driver↔row mapping) holds without inventing premature renderer instrumentation. A new `REFERENCE_ONLY` set in `bench-cli.ts` skips S2-c on `--gha` runs and records an `incomplete: true` history line for that surface.

**Tech Stack:** Bun v1.2+ / TypeScript 6.x strict, `bun:test`, `Bun.spawn`, no new runtime dependencies. Reuses the frozen PR-B-1 harness API (`runBench`, `appendHistoryLine`, `BenchSurfaceResult`) and the `buildSyntheticIndex` fixture generator (already supports `small | medium | large` tiers).

**Spec source:** [`docs/superpowers/specs/2026-04-26-perf-audit-design.md`](../specs/2026-04-26-perf-audit-design.md). Predecessor plan: [`2026-04-26-perf-audit-phase-1a.md`](./2026-04-26-perf-audit-phase-1a.md) (PR-B-1, merged via PR #115).

**Out of scope for this PR (lands later):**
- Cluster C workload drivers — S6 sync (MSW), S7-a/b/c memory RSS, S8 embedding throughput, S9 LLM, S10 SQLite contention. PR-B-2b plan.
- Real Tauri renderer instrumentation that turns the S3 / S5 stubs into measurements. Separate follow-up PR scoped to `packages/ui/`.
- CI workflow (`.github/workflows/_perf.yml`), workload thresholds in `slo.md`, `baseline.md`, `missed.md`. Phase 2 / PR-C work.

**Review notes folded in** (see [`2026-04-26-perf-audit-phase-1b-review-notes.md`](./2026-04-26-perf-audit-phase-1b-review-notes.md)):
- Note 1 (early exit detection in `spawnAndTimeToMarker` marker mode) — folded into Task 1 implementation + new test.
- Note 2 (S11 purity — `diag --json` does I/O) — switched S11 cmd to `nimbus help` (Tasks 6 + 7); side-benefit: smoke Pass A no longer needs a non-zero exit-code workaround.
- Note 3 (buffer growth cap in `readUntilMatch`) — **deferred**. YAGNI for early-firing markers (the marker text is matched within the first ~50 bytes); revisit if a cluster C verbose-output surface needs it.
- Note 4 (driver failure → `incomplete: true`) — folded into Task 9 with the corrected semantic: per-surface `stub_reason: "driver-failed: ..."` (line-level `incomplete: true` would have invalidated *other* successful surface entries on the same line, breaking delta comparisons).
- Note 5 (Ink first-frame async timing) — folded into Task 5: marker emitted from `useEffect` inside `App.tsx` (fires after first commit, env-gated by `NIMBUS_BENCH=1`); S4 driver sets that env when spawning. Replaces the original `tui.tsx` post-`inkRender` write.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/gateway/src/perf/process-spawn-bench.ts` | Create | `spawnAndTimeToMarker(opts)` — spawns a child, times from spawn to a stdout marker (regex) or to exit; injectable spawn for tests |
| `packages/gateway/src/perf/process-spawn-bench.test.ts` | Create | Unit tests for marker matching, exit-mode timing, timeout, kill-on-marker, error propagation |
| `packages/gateway/src/perf/surfaces/bench-cold-start.ts` | Create | S1 — spawn fresh `bun packages/gateway/src/index.ts`, time to `[gateway] ready` stdout line |
| `packages/gateway/src/perf/surfaces/bench-cold-start.test.ts` | Create | Smoke test using injected fake spawn returning a synthetic ready line |
| `packages/gateway/src/perf/surfaces/bench-query-latency-100k.ts` | Create | S2-b — thin wrapper that forwards to `runQueryLatencyOnce` with `corpus: "medium"` |
| `packages/gateway/src/perf/surfaces/bench-query-latency-100k.test.ts` | Create | Smoke test on the `small` tier (faster) verifying corpus override propagates |
| `packages/gateway/src/perf/surfaces/bench-query-latency-1m.ts` | Create | S2-c — thin wrapper with `corpus: "large"` (skip-gated at CLI layer for non-reference runs) |
| `packages/gateway/src/perf/surfaces/bench-query-latency-1m.test.ts` | Create | Smoke test on the `small` tier verifying corpus override propagates |
| `packages/gateway/src/perf/surfaces/bench-tui-first-paint.ts` | Create | S4 — spawn `bun packages/cli/src/index.ts tui`, time to `[tui] first-frame` stderr line, kill |
| `packages/gateway/src/perf/surfaces/bench-tui-first-paint.test.ts` | Create | Smoke test using injected fake spawn |
| `packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.ts` | Create | S11-a — spawn `bun packages/cli/src/index.ts diag --json`, time to process exit |
| `packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.test.ts` | Create | Smoke test using injected fake spawn that exits cleanly |
| `packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.ts` | Create | S11-b — same shape as S11-a but skips a discarded warm-up invocation between samples |
| `packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.test.ts` | Create | Smoke test using injected fake spawn |
| `packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.ts` | Create | S3 — stub driver returning `[]` and surfacing the stub reason via shared helper |
| `packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.test.ts` | Create | Test that the driver returns `[]` and exports the canonical reason string |
| `packages/gateway/src/perf/surfaces/bench-hitl-popup.ts` | Create | S5 — stub driver, identical shape to S3 |
| `packages/gateway/src/perf/surfaces/bench-hitl-popup.test.ts` | Create | Same shape as S3 stub test |
| `docs/perf/slo-ux.md` | Create | Published UX SLO sheet — full 16-row surface table, M1-Air caveat row, per-row Nielsen / RAIL / Nimbus-claim citations |
| `packages/gateway/src/perf/history-line.ts` | Modify | Add optional `stub_reason?: string` to `HistoryLineSurface` |
| `packages/gateway/src/perf/history-line.test.ts` | Modify | Cover the new optional field on append + round-trip |
| `packages/gateway/src/perf/bench-cli.ts` | Modify | Register 7 new measuring surfaces + 2 stub surfaces in `SURFACE_REGISTRY`; add `REFERENCE_ONLY` set (skip-and-record-incomplete for S2-c on non-reference runs); add `STUB_SURFACES` map (per-surface `stub_reason`); update help text |
| `packages/gateway/src/perf/bench-cli.test.ts` | Modify | Add tests for stub-surface recording, reference-only skipping |
| `packages/gateway/src/perf/bench-runner.ts` | Modify | Update help text to list the new surface IDs |
| `packages/gateway/src/perf/index.ts` | Modify | Re-export the new drivers + stub-reason types |
| `packages/cli/src/tui/App.tsx` | Modify | Env-gated `useEffect` emits `[tui] first-frame` to stderr after first commit (S4 marker) |

**Total:** 19 files created, 6 modified.

---

## Execution order

Sequential: Tasks 1 → 12. Each task is independently committable. Task 1 produces the helper Tasks 2 / 5 / 6 / 7 depend on. Tasks 3 / 4 (S2-b/c wrappers) don't use the helper but reuse `runQueryLatencyOnce`. Task 5 needs the TUI marker landed first (Step 1 inside the task); Tasks 6 / 7 / 8 only need the helper; Task 9 introduces stubs + the schema bump; Task 10 ties everything into `bench-cli.ts`; Task 11 writes the SLO doc; Task 12 is the final smoke + PR.

Dependency graph:

```
T1 (helper) ──┬─→ T2 (S1) ──┐
              ├─→ T5 (S4) ──┤
              ├─→ T7 (S11-a)┤
              └─→ T8 (S11-b)┤
T3 (S2-b)  ────────────────┤
T4 (S2-c)  ────────────────┤
T9 (S3+S5 stubs + schema) ─┤
                            └─→ T10 (register + barrel) → T11 (SLO doc) → T12 (smoke + PR)
T6 (TUI marker) ──→ T5 (S4 driver depends on marker)
```

No parallel tasks.

---

## Task 1 — `process-spawn-bench` helper

**Files:**
- Create: `packages/gateway/src/perf/process-spawn-bench.ts`
- Create: `packages/gateway/src/perf/process-spawn-bench.test.ts`

The helper has two timing modes:
- `"marker"` — match a regex on the child's stdout/stderr, record elapsed ms from spawn to first match, send the child SIGTERM, await exit.
- `"exit"` — record elapsed ms from spawn to clean exit; the child is allowed to terminate on its own.

A timeout (default 30 s) prevents a hung child from blocking the bench. A `Bun.spawn` injection lets unit tests provide a fake.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/gateway/src/perf/process-spawn-bench.test.ts
import { describe, expect, test } from "bun:test";
import { spawnAndTimeToMarker } from "./process-spawn-bench.ts";

interface FakeSubprocess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: (signal?: number | NodeJS.Signals) => void;
}

function streamFrom(chunks: string[], delayMs = 0): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        controller.enqueue(new TextEncoder().encode(c));
      }
      controller.close();
    },
  });
}

function fakeSpawn(opts: {
  stdout?: string[];
  stderr?: string[];
  exitCode?: number;
  delayMs?: number;
}): typeof Bun.spawn {
  return ((..._args: unknown[]) => {
    const proc: FakeSubprocess = {
      stdout: streamFrom(opts.stdout ?? [], opts.delayMs ?? 0),
      stderr: streamFrom(opts.stderr ?? [], opts.delayMs ?? 0),
      exited: Promise.resolve(opts.exitCode ?? 0),
      kill: () => undefined,
    };
    return proc as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}

describe("spawnAndTimeToMarker", () => {
  test("marker mode: returns elapsed ms when stdout matches the regex", async () => {
    const elapsed = await spawnAndTimeToMarker({
      cmd: "fake",
      args: [],
      mode: "marker",
      marker: /\[gateway\] ready/,
      spawn: fakeSpawn({ stdout: ["[gateway] ready (0.1.0) IPC /tmp/sock\n"] }),
    });
    expect(Number.isFinite(elapsed)).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  test("marker mode: matches across stderr too", async () => {
    const elapsed = await spawnAndTimeToMarker({
      cmd: "fake",
      args: [],
      mode: "marker",
      marker: /\[tui\] first-frame/,
      spawn: fakeSpawn({ stderr: ["[tui] first-frame\n"] }),
    });
    expect(Number.isFinite(elapsed)).toBe(true);
  });

  test("exit mode: returns elapsed ms when the process exits", async () => {
    const elapsed = await spawnAndTimeToMarker({
      cmd: "fake",
      args: [],
      mode: "exit",
      spawn: fakeSpawn({ stdout: ["hello\n"], exitCode: 0 }),
    });
    expect(Number.isFinite(elapsed)).toBe(true);
  });

  test("marker mode: throws on timeout", async () => {
    await expect(
      spawnAndTimeToMarker({
        cmd: "fake",
        args: [],
        mode: "marker",
        marker: /never-matches/,
        timeoutMs: 50,
        spawn: fakeSpawn({ stdout: ["unrelated output\n"] }),
      }),
    ).rejects.toThrow(/timeout/i);
  });

  test("exit mode: throws when child exits non-zero", async () => {
    await expect(
      spawnAndTimeToMarker({
        cmd: "fake",
        args: [],
        mode: "exit",
        spawn: fakeSpawn({ exitCode: 1 }),
      }),
    ).rejects.toThrow(/exit/i);
  });

  test("marker mode: throws if child exits before the marker is matched", async () => {
    await expect(
      spawnAndTimeToMarker({
        cmd: "fake",
        args: [],
        mode: "marker",
        marker: /never-matches/,
        timeoutMs: 30_000,
        spawn: fakeSpawn({ stdout: ["something else\n"], exitCode: 1 }),
      }),
    ).rejects.toThrow(/exited.*before marker/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/process-spawn-bench.test.ts
```

Expected: FAIL with `Cannot find module './process-spawn-bench.ts'`.

- [ ] **Step 3: Implement the helper**

```typescript
// packages/gateway/src/perf/process-spawn-bench.ts
/**
 * Cross-process measurement primitive for surfaces that need to time a fresh
 * child invocation (S1 cold start, S4 TUI first-paint, S11 CLI overhead).
 *
 * Two modes:
 *   - "marker" — elapsed ms from spawn to first stdout/stderr regex match.
 *                The child is then sent SIGTERM and awaited.
 *   - "exit"   — elapsed ms from spawn to clean exit. The child must exit
 *                on its own.
 *
 * A timeout (default 30 s) protects against a hung child.
 *
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §3.2 (S1, S4,
 * S11 surfaces) and the PR-B-2a plan for the call sites.
 */

export type SpawnMode = "marker" | "exit";

export interface SpawnAndTimeOptions {
  cmd: string;
  args: string[];
  mode: SpawnMode;
  /** Required when mode === "marker". */
  marker?: RegExp;
  /** Default 30000 ms. */
  timeoutMs?: number;
  /** Test-injectable spawn (defaults to Bun.spawn). */
  spawn?: typeof Bun.spawn;
  /** Optional env overrides. */
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function readUntilMatch(
  stream: ReadableStream<Uint8Array>,
  marker: RegExp,
  onMatch: () => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
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

/**
 * Spawn a child and return the elapsed ms in the requested mode.
 * Throws on timeout or non-zero exit (in "exit" mode).
 */
export async function spawnAndTimeToMarker(opts: SpawnAndTimeOptions): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawn = opts.spawn ?? Bun.spawn;

  if (opts.mode === "marker" && opts.marker === undefined) {
    throw new Error("spawnAndTimeToMarker: mode='marker' requires a marker RegExp");
  }

  const start = performance.now();
  const proc = spawn([opts.cmd, ...opts.args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...(opts.env !== undefined && { env: { ...process.env, ...opts.env } }),
  }) as unknown as {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill: (signal?: number | NodeJS.Signals) => void;
  };

  if (opts.mode === "exit") {
    const exitCode = await Promise.race([
      proc.exited,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error(`spawn-and-time timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    const elapsed = performance.now() - start;
    if (exitCode !== 0) {
      throw new Error(`child exited with code ${exitCode}`);
    }
    return elapsed;
  }

  // marker mode
  const marker = opts.marker as RegExp;
  let matched = false;
  let elapsed = 0;
  const ac = new AbortController();
  const onMatch = (): void => {
    if (!matched) {
      matched = true;
      elapsed = performance.now() - start;
      ac.abort();
    }
  };

  // Race: stdout match, stderr match, timeout, OR child exits before marker.
  // The exit racer guards against the case where the child crashes pre-marker
  // (missing dep, port collision, invalid config) — without it the helper
  // would hang until timeoutMs.
  const racers: Promise<unknown>[] = [
    readUntilMatch(proc.stdout, marker, onMatch, ac.signal),
    readUntilMatch(proc.stderr, marker, onMatch, ac.signal),
    new Promise((_, reject) =>
      setTimeout(() => {
        if (!matched) reject(new Error(`spawn-and-time timeout after ${timeoutMs}ms`));
      }, timeoutMs),
    ),
    proc.exited.then((code) => {
      if (!matched) {
        throw new Error(`child exited with code ${code} before marker matched`);
      }
    }),
  ];

  try {
    await Promise.race(racers);
  } finally {
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

  if (!matched) {
    throw new Error(`marker not found before timeout (${timeoutMs}ms)`);
  }
  return elapsed;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/gateway/src/perf/process-spawn-bench.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/process-spawn-bench.ts packages/gateway/src/perf/process-spawn-bench.test.ts
git commit -m "feat(perf): add spawnAndTimeToMarker helper for cross-process bench surfaces"
```

---

## Task 2 — S1 cold-start driver

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-cold-start.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-cold-start.test.ts`

S1 measures gateway cold-start: spawn `bun packages/gateway/src/index.ts`, time to the existing `[gateway] ready (X.Y.Z) IPC <path>` stdout line, kill. Five samples per run is sufficient — process spawns are expensive.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/gateway/src/perf/surfaces/bench-cold-start.test.ts
import { describe, expect, test } from "bun:test";
import { runColdStartOnce, COLD_START_SAMPLES_PER_RUN } from "./bench-cold-start.ts";

function fakeSpawn(stdoutChunks: string[]): typeof Bun.spawn {
  return ((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({
        start(controller) {
          for (const c of stdoutChunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(0),
      kill: () => undefined,
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}

describe("runColdStartOnce (S1)", () => {
  test("returns COLD_START_SAMPLES_PER_RUN finite samples", async () => {
    const samples = await runColdStartOnce(
      { runs: 1, runner: "local-dev" },
      { spawn: fakeSpawn(["[gateway] ready (0.1.0) IPC /tmp/sock\n"]) },
    );
    expect(samples.length).toBe(COLD_START_SAMPLES_PER_RUN);
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-cold-start.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the driver**

```typescript
// packages/gateway/src/perf/surfaces/bench-cold-start.ts
/**
 * S1 — Gateway cold start (spawn → IPC ready).
 *
 * Spawns a fresh `bun packages/gateway/src/index.ts` per sample and times
 * from spawn to the existing readiness line emitted at the end of main():
 *
 *   [gateway] ready (0.1.0) IPC /path/to/socket
 *
 * Per-sample cost is dominated by Bun runtime warm-up + PAL init + IPC bind.
 * 5 samples per run keeps each run under ~12 s.
 */

import { resolve } from "node:path";

import { spawnAndTimeToMarker } from "../process-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

export const COLD_START_SAMPLES_PER_RUN = 5;
const READY_MARKER = /\[gateway\] ready/;
const COLD_START_TIMEOUT_MS = 30_000;

export interface RunOptions {
  /** Test-injectable spawn (defaults to Bun.spawn). */
  spawn?: typeof Bun.spawn;
  /** Override the gateway entry path (test-only). */
  gatewayEntry?: string;
}

function defaultGatewayEntry(): string {
  // packages/gateway/src/perf/surfaces/bench-cold-start.ts → packages/gateway/src/index.ts
  return resolve(import.meta.dir, "..", "..", "index.ts");
}

export async function runColdStartOnce(
  _opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const samples: number[] = [];
  const entry = runOpts.gatewayEntry ?? defaultGatewayEntry();

  for (let i = 0; i < COLD_START_SAMPLES_PER_RUN; i += 1) {
    const ms = await spawnAndTimeToMarker({
      cmd: process.execPath,
      args: [entry],
      mode: "marker",
      marker: READY_MARKER,
      timeoutMs: COLD_START_TIMEOUT_MS,
      ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
    });
    samples.push(ms);
  }
  return samples;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/gateway/src/perf/surfaces/bench-cold-start.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-cold-start.ts packages/gateway/src/perf/surfaces/bench-cold-start.test.ts
git commit -m "feat(perf): add S1 cold-start surface driver"
```

---

## Task 3 — S2-b query latency on 100 K corpus

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-query-latency-100k.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-query-latency-100k.test.ts`

Thin wrapper that pins `corpus: "medium"`. The unit test runs against the `small` tier (faster) to verify the override-propagation contract.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/perf/surfaces/bench-query-latency-100k.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runQueryLatency100kOnce, S2B_TIER } from "./bench-query-latency-100k.ts";

describe("runQueryLatency100kOnce (S2-b)", () => {
  test("pins the medium corpus tier", () => {
    expect(S2B_TIER).toBe("medium");
  });

  test("returns 100 finite samples (test runs against small tier for speed)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-s2b-test-"));
    try {
      // We pass corpus override at the test level by hand-constructing opts
      // so the test stays fast; production runs use the wrapper's pinned tier.
      const samples = await runQueryLatency100kOnce(
        { runs: 1, runner: "local-dev", corpus: "small" },
        { cacheDir: dir, overrideTier: "small" },
      );
      expect(samples.length).toBe(100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-query-latency-100k.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the wrapper**

```typescript
// packages/gateway/src/perf/surfaces/bench-query-latency-100k.ts
/**
 * S2-b — Query p95 on the 100 K-row corpus tier.
 *
 * Wraps runQueryLatencyOnce with `corpus: "medium"` pinned. The wrapper
 * exists so § 6 acceptance criterion 7 (every SLO row maps to a
 * surfaces/bench-*.ts driver) reads cleanly when scanning the directory.
 */

import { runQueryLatencyOnce, type RunOptions as BaseRunOptions } from "./bench-query-latency.ts";
import type { BenchRunOptions, CorpusTier } from "../types.ts";

export const S2B_TIER: CorpusTier = "medium";

export interface RunOptions extends BaseRunOptions {
  /** Test-only: bypass the pinned tier with a smaller one for fast unit tests. */
  overrideTier?: CorpusTier;
}

export async function runQueryLatency100kOnce(
  opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const tier: CorpusTier = runOpts.overrideTier ?? S2B_TIER;
  const baseOpts: BaseRunOptions = {};
  if (runOpts.cacheDir !== undefined) baseOpts.cacheDir = runOpts.cacheDir;
  return runQueryLatencyOnce({ ...opts, corpus: tier }, baseOpts);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/gateway/src/perf/surfaces/bench-query-latency-100k.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-query-latency-100k.ts packages/gateway/src/perf/surfaces/bench-query-latency-100k.test.ts
git commit -m "feat(perf): add S2-b query-latency wrapper (100K tier)"
```

---

## Task 4 — S2-c query latency on 1 M corpus

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-query-latency-1m.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-query-latency-1m.test.ts`

Identical shape to Task 3 but pins `corpus: "large"`. The reference-only skip is enforced at the CLI layer (Task 10) — the driver itself has no guard.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/perf/surfaces/bench-query-latency-1m.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runQueryLatency1mOnce, S2C_TIER } from "./bench-query-latency-1m.ts";

describe("runQueryLatency1mOnce (S2-c)", () => {
  test("pins the large corpus tier", () => {
    expect(S2C_TIER).toBe("large");
  });

  test("returns 100 finite samples (test runs against small tier for speed)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-s2c-test-"));
    try {
      const samples = await runQueryLatency1mOnce(
        { runs: 1, runner: "local-dev", corpus: "small" },
        { cacheDir: dir, overrideTier: "small" },
      );
      expect(samples.length).toBe(100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-query-latency-1m.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the wrapper**

```typescript
// packages/gateway/src/perf/surfaces/bench-query-latency-1m.ts
/**
 * S2-c — Query p95 on the 1 M-row corpus tier (reference-only).
 *
 * Reference-only because generating a 1 M-item SQLite fixture on every CI
 * run would take minutes per run. The skip is enforced at the CLI layer
 * (REFERENCE_ONLY set in bench-cli.ts) — this driver itself has no guard.
 */

import { runQueryLatencyOnce, type RunOptions as BaseRunOptions } from "./bench-query-latency.ts";
import type { BenchRunOptions, CorpusTier } from "../types.ts";

export const S2C_TIER: CorpusTier = "large";

export interface RunOptions extends BaseRunOptions {
  overrideTier?: CorpusTier;
}

export async function runQueryLatency1mOnce(
  opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const tier: CorpusTier = runOpts.overrideTier ?? S2C_TIER;
  const baseOpts: BaseRunOptions = {};
  if (runOpts.cacheDir !== undefined) baseOpts.cacheDir = runOpts.cacheDir;
  return runQueryLatencyOnce({ ...opts, corpus: tier }, baseOpts);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/gateway/src/perf/surfaces/bench-query-latency-1m.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-query-latency-1m.ts packages/gateway/src/perf/surfaces/bench-query-latency-1m.test.ts
git commit -m "feat(perf): add S2-c query-latency wrapper (1M tier, reference-only)"
```

---

## Task 5 — TUI first-frame marker + S4 driver

**Files:**
- Modify: `packages/cli/src/tui/App.tsx` (env-gated `useEffect` emits the marker after first commit)
- Create: `packages/gateway/src/perf/surfaces/bench-tui-first-paint.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-tui-first-paint.test.ts`

S4 measures `nimbus tui` first-paint. Ink's `render()` returns synchronously *before* React's first commit completes, so writing the marker right after `inkRender(...)` would fire optimistically (before the first frame is actually flushed to the TTY). Instead, emit the marker from a `useEffect(() => {...}, [])` inside the `App` component — that callback fires after the first commit, which guarantees the first frame has been written to stdout.

The marker is gated on `NIMBUS_BENCH === "1"` so production users (running `nimbus tui` normally) never see the stderr line. The S4 driver sets that env when spawning.

- [ ] **Step 1: Add the env-gated first-frame marker to `App.tsx`**

Modify `packages/cli/src/tui/App.tsx`. Inside the `App` component (after the existing notification-handler `useEffect`), add a one-shot effect that emits the marker on first commit:

```diff
   // Install notification handlers once.
   React.useEffect(() => {
     client.onNotification("engine.streamToken", (p) => {
       ...
     });
   }, [client]);

+  // Bench marker for S4 first-paint (docs/perf/slo-ux.md §S4). Fires after
+  // the first commit (i.e., after Ink has flushed the first frame to TTY).
+  // Env-gated so production users never see the stderr line.
+  React.useEffect(() => {
+    if (process.env["NIMBUS_BENCH"] === "1") {
+      process.stderr.write("[tui] first-frame\n");
+    }
+  }, []);
+
   // Flush live buffer into <Static> when stream ends.
   const prevModeRef = React.useRef(state.mode);
```

- [ ] **Step 2: Verify the TUI tests still pass**

```bash
bun test packages/cli/src/tui/
```

Expected: same number of tests passing as before; no regressions. The marker is env-gated and `NIMBUS_BENCH` is unset during normal test runs, so `App.test.tsx` is unaffected.

- [ ] **Step 3: Commit the marker**

```bash
git add packages/cli/src/tui/App.tsx
git commit -m "feat(cli): emit env-gated [tui] first-frame marker after first commit (S4)"
```

- [ ] **Step 4: Write the failing S4 driver test**

```typescript
// packages/gateway/src/perf/surfaces/bench-tui-first-paint.test.ts
import { describe, expect, test } from "bun:test";
import { runTuiFirstPaintOnce, TUI_FIRST_PAINT_SAMPLES_PER_RUN } from "./bench-tui-first-paint.ts";

function fakeSpawn(stderrChunks: string[]): typeof Bun.spawn {
  return ((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(controller) {
          for (const c of stderrChunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      }),
      exited: Promise.resolve(0),
      kill: () => undefined,
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}

describe("runTuiFirstPaintOnce (S4)", () => {
  test("returns TUI_FIRST_PAINT_SAMPLES_PER_RUN finite samples", async () => {
    const samples = await runTuiFirstPaintOnce(
      { runs: 1, runner: "local-dev" },
      { spawn: fakeSpawn(["[tui] first-frame\n"]) },
    );
    expect(samples.length).toBe(TUI_FIRST_PAINT_SAMPLES_PER_RUN);
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
    }
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-tui-first-paint.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 6: Implement the driver**

```typescript
// packages/gateway/src/perf/surfaces/bench-tui-first-paint.ts
/**
 * S4 — TUI first-paint (`nimbus tui` → first frame).
 *
 * Spawns `bun packages/cli/src/index.ts tui` per sample with NIMBUS_BENCH=1
 * set, and times to the `[tui] first-frame` stderr marker emitted from a
 * useEffect inside App.tsx — that effect fires after React's first commit,
 * which is *after* Ink has flushed the first frame to the TTY. Sends
 * SIGTERM after the marker.
 *
 * Note: a running gateway is a precondition — the TUI command exits early
 * if the gateway state is unreadable. The bench operator is responsible
 * for running `nimbus start` before invoking this surface; if the gateway
 * isn't running, the spawn-and-time helper's pre-marker exit guard will
 * throw and the bench-cli will record a per-surface stub_reason.
 */

import { resolve } from "node:path";

import { spawnAndTimeToMarker } from "../process-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

export const TUI_FIRST_PAINT_SAMPLES_PER_RUN = 5;
const FIRST_FRAME_MARKER = /\[tui\] first-frame/;
const TUI_TIMEOUT_MS = 15_000;

export interface RunOptions {
  spawn?: typeof Bun.spawn;
  cliEntry?: string;
}

function defaultCliEntry(): string {
  // packages/gateway/src/perf/surfaces/bench-tui-first-paint.ts
  //   → packages/cli/src/index.ts
  return resolve(import.meta.dir, "..", "..", "..", "..", "cli", "src", "index.ts");
}

export async function runTuiFirstPaintOnce(
  _opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const samples: number[] = [];
  const entry = runOpts.cliEntry ?? defaultCliEntry();
  for (let i = 0; i < TUI_FIRST_PAINT_SAMPLES_PER_RUN; i += 1) {
    const ms = await spawnAndTimeToMarker({
      cmd: process.execPath,
      args: [entry, "tui"],
      mode: "marker",
      marker: FIRST_FRAME_MARKER,
      timeoutMs: TUI_TIMEOUT_MS,
      env: { NIMBUS_BENCH: "1" },
      ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
    });
    samples.push(ms);
  }
  return samples;
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
bun test packages/gateway/src/perf/surfaces/bench-tui-first-paint.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the driver**

```bash
git add packages/gateway/src/perf/surfaces/bench-tui-first-paint.ts packages/gateway/src/perf/surfaces/bench-tui-first-paint.test.ts
git commit -m "feat(perf): add S4 TUI first-paint surface driver"
```

---

## Task 6 — S11-a CLI overhead (cold)

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.test.ts`

S11-a measures cold CLI invocation overhead — fresh process each sample, time to clean exit. We use `nimbus diag --json` because it's a real command that doesn't depend on a running gateway for output. The exit-mode helper handles the timing.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.test.ts
import { describe, expect, test } from "bun:test";
import { runCliOverheadColdOnce, CLI_COLD_SAMPLES_PER_RUN } from "./bench-cli-overhead-cold.ts";

function fakeSpawnExitsClean(): typeof Bun.spawn {
  return ((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(0),
      kill: () => undefined,
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}

describe("runCliOverheadColdOnce (S11-a)", () => {
  test("returns CLI_COLD_SAMPLES_PER_RUN finite samples", async () => {
    const samples = await runCliOverheadColdOnce(
      { runs: 1, runner: "local-dev" },
      { spawn: fakeSpawnExitsClean() },
    );
    expect(samples.length).toBe(CLI_COLD_SAMPLES_PER_RUN);
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the driver**

```typescript
// packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.ts
/**
 * S11-a — CLI invocation overhead (cold).
 *
 * Spawns a fresh `bun packages/cli/src/index.ts help` per sample and times
 * to clean exit. `help` is chosen because it dispatches synchronously to
 * `printHelp()` and exits 0 — no gateway connection, no async I/O beyond
 * the unavoidable file-logger setup. That isolates the measurement to
 * Bun runtime warm-up + module loading + argv dispatch (the actual
 * "invocation overhead" we're trying to characterise).
 *
 * 10 samples per run — CLI invocation is fast enough that a larger sample
 * size is cheap and tightens the p95 estimate.
 */

import { resolve } from "node:path";

import { spawnAndTimeToMarker } from "../process-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

export const CLI_COLD_SAMPLES_PER_RUN = 10;
const CLI_TIMEOUT_MS = 15_000;

export interface RunOptions {
  spawn?: typeof Bun.spawn;
  cliEntry?: string;
}

function defaultCliEntry(): string {
  return resolve(import.meta.dir, "..", "..", "..", "..", "cli", "src", "index.ts");
}

export async function runCliOverheadColdOnce(
  _opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const samples: number[] = [];
  const entry = runOpts.cliEntry ?? defaultCliEntry();
  for (let i = 0; i < CLI_COLD_SAMPLES_PER_RUN; i += 1) {
    const ms = await spawnAndTimeToMarker({
      cmd: process.execPath,
      args: [entry, "help"],
      mode: "exit",
      timeoutMs: CLI_TIMEOUT_MS,
      ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
    });
    samples.push(ms);
  }
  return samples;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.ts packages/gateway/src/perf/surfaces/bench-cli-overhead-cold.test.ts
git commit -m "feat(perf): add S11-a CLI cold-overhead surface driver"
```

---

## Task 7 — S11-b CLI overhead (warm)

**Files:**
- Create: `packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.test.ts`

S11-b measures the second invocation in a same-shell pair — warm Bun runtime caches, warm OS file cache. We approximate this by running each sample as a tight pair: throwaway invocation + measured invocation, recording only the second. 20 samples per run since each is fast.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.test.ts
import { describe, expect, test } from "bun:test";
import { runCliOverheadWarmOnce, CLI_WARM_SAMPLES_PER_RUN } from "./bench-cli-overhead-warm.ts";

function fakeSpawnExitsClean(): typeof Bun.spawn {
  return ((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(0),
      kill: () => undefined,
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}

describe("runCliOverheadWarmOnce (S11-b)", () => {
  test("returns CLI_WARM_SAMPLES_PER_RUN finite samples", async () => {
    const samples = await runCliOverheadWarmOnce(
      { runs: 1, runner: "local-dev" },
      { spawn: fakeSpawnExitsClean() },
    );
    expect(samples.length).toBe(CLI_WARM_SAMPLES_PER_RUN);
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the driver**

```typescript
// packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.ts
/**
 * S11-b — CLI invocation overhead (warm).
 *
 * Approximates "second invocation in the same shell" by running one
 * discarded warm-up invocation before the measurement loop. This warms
 * the OS file cache for the CLI entry; Bun runtime caches are inherently
 * per-process so the warm/cold distinction here is dominated by
 * file-system caching.
 *
 * Uses `nimbus help` (same as S11-a) so cold-vs-warm differs only in
 * file-cache state, not in the work the CLI does post-startup.
 *
 * 20 samples per run — each sample is one cheap invocation.
 */

import { resolve } from "node:path";

import { spawnAndTimeToMarker } from "../process-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

export const CLI_WARM_SAMPLES_PER_RUN = 20;
const CLI_TIMEOUT_MS = 15_000;

export interface RunOptions {
  spawn?: typeof Bun.spawn;
  cliEntry?: string;
}

function defaultCliEntry(): string {
  return resolve(import.meta.dir, "..", "..", "..", "..", "cli", "src", "index.ts");
}

export async function runCliOverheadWarmOnce(
  _opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const samples: number[] = [];
  const entry = runOpts.cliEntry ?? defaultCliEntry();
  const args = [entry, "help"];

  // One discarded invocation outside the loop primes the file cache.
  await spawnAndTimeToMarker({
    cmd: process.execPath,
    args,
    mode: "exit",
    timeoutMs: CLI_TIMEOUT_MS,
    ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
  });

  for (let i = 0; i < CLI_WARM_SAMPLES_PER_RUN; i += 1) {
    const ms = await spawnAndTimeToMarker({
      cmd: process.execPath,
      args,
      mode: "exit",
      timeoutMs: CLI_TIMEOUT_MS,
      ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
    });
    samples.push(ms);
  }
  return samples;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.ts packages/gateway/src/perf/surfaces/bench-cli-overhead-warm.test.ts
git commit -m "feat(perf): add S11-b CLI warm-overhead surface driver"
```

---

## Task 8 — S3 / S5 stub drivers + `stub_reason` schema bump

**Files:**
- Modify: `packages/gateway/src/perf/history-line.ts` (add `stub_reason?: string` field)
- Modify: `packages/gateway/src/perf/history-line.test.ts` (cover the new field)
- Create: `packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.test.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-hitl-popup.ts`
- Create: `packages/gateway/src/perf/surfaces/bench-hitl-popup.test.ts`

S3 and S5 ship as stubs because real measurement needs renderer-side perf marks the harness can't read across the Tauri IPC boundary. The drivers return `[]` and export a `STUB_REASON` constant the orchestrator (Task 10) reads when populating the per-surface entry.

- [ ] **Step 1: Add `stub_reason` to the schema**

Edit `packages/gateway/src/perf/history-line.ts` — add the field to `HistoryLineSurface`:

```diff
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
+  /**
+   * If set, this surface was not actually measured. Examples: stub drivers
+   * (S3, S5 — renderer instrumentation pending); reference-only surfaces
+   * (S2-c, S7-c, S9) skipped on a non-reference run.
+   */
+  stub_reason?: string;
 }
```

- [ ] **Step 2: Add a coverage test**

Append to `packages/gateway/src/perf/history-line.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendHistoryLine, type HistoryLine } from "./history-line.ts";

describe("appendHistoryLine — stub_reason field", () => {
  test("round-trips the stub_reason field on a per-surface entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-stub-test-"));
    const path = join(dir, "history.jsonl");
    try {
      const line: HistoryLine = {
        schema_version: 1,
        run_id: "abc",
        timestamp: "2026-04-26T00:00:00Z",
        runner: "local-dev",
        os_version: "test",
        nimbus_git_sha: "deadbeef",
        bun_version: "1.2.0",
        surfaces: {
          S3: { samples_count: 0, stub_reason: "renderer instrumentation pending" },
        },
      };
      appendHistoryLine(path, line);
      const parsed = JSON.parse(readFileSync(path, "utf8").trim()) as HistoryLine;
      expect(parsed.surfaces.S3?.stub_reason).toBe("renderer instrumentation pending");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run history-line tests to verify the new test passes**

```bash
bun test packages/gateway/src/perf/history-line.test.ts
```

Expected: PASS (existing tests unchanged + 1 new test).

- [ ] **Step 4: Write the failing S3 stub test**

```typescript
// packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.test.ts
import { describe, expect, test } from "bun:test";
import { runDashboardFirstPaintOnce, S3_STUB_REASON } from "./bench-dashboard-first-paint.ts";

describe("runDashboardFirstPaintOnce (S3 stub)", () => {
  test("returns an empty samples array", async () => {
    const samples = await runDashboardFirstPaintOnce({ runs: 1, runner: "local-dev" });
    expect(samples).toEqual([]);
  });

  test("exports a non-empty stub reason", () => {
    expect(typeof S3_STUB_REASON).toBe("string");
    expect(S3_STUB_REASON.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.test.ts
```

Expected: FAIL.

- [ ] **Step 6: Implement the S3 stub**

```typescript
// packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.ts
/**
 * S3 — Dashboard first-paint (Tauri renderer).
 *
 * Stub driver. Real measurement needs renderer-side perf marks the bench
 * harness can read across the Tauri IPC boundary; that instrumentation
 * lands in a separate follow-up PR scoped to packages/ui/.
 *
 * The driver returns [] so the harness records `samples_count: 0`; the
 * orchestrator (bench-cli.ts) reads STUB_SURFACES[id] and writes the
 * per-surface stub_reason field.
 */

import type { BenchRunOptions } from "../types.ts";

export const S3_STUB_REASON = "renderer instrumentation pending (Tauri perf marks)";

export async function runDashboardFirstPaintOnce(
  _opts: BenchRunOptions,
  _runOpts: Record<string, unknown> = {},
): Promise<number[]> {
  return [];
}
```

- [ ] **Step 7: Run S3 tests**

```bash
bun test packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.test.ts
```

Expected: PASS.

- [ ] **Step 8: Write the failing S5 stub test**

```typescript
// packages/gateway/src/perf/surfaces/bench-hitl-popup.test.ts
import { describe, expect, test } from "bun:test";
import { runHitlPopupOnce, S5_STUB_REASON } from "./bench-hitl-popup.ts";

describe("runHitlPopupOnce (S5 stub)", () => {
  test("returns an empty samples array", async () => {
    const samples = await runHitlPopupOnce({ runs: 1, runner: "local-dev" });
    expect(samples).toEqual([]);
  });

  test("exports a non-empty stub reason", () => {
    expect(typeof S5_STUB_REASON).toBe("string");
    expect(S5_STUB_REASON.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

```bash
bun test packages/gateway/src/perf/surfaces/bench-hitl-popup.test.ts
```

Expected: FAIL.

- [ ] **Step 10: Implement the S5 stub**

```typescript
// packages/gateway/src/perf/surfaces/bench-hitl-popup.ts
/**
 * S5 — HITL popup latency (Tauri renderer).
 *
 * Stub driver. Same rationale as S3 — real measurement needs renderer-side
 * perf marks the bench harness can read across the Tauri IPC boundary.
 */

import type { BenchRunOptions } from "../types.ts";

export const S5_STUB_REASON = "renderer instrumentation pending (Tauri perf marks)";

export async function runHitlPopupOnce(
  _opts: BenchRunOptions,
  _runOpts: Record<string, unknown> = {},
): Promise<number[]> {
  return [];
}
```

- [ ] **Step 11: Run S5 tests**

```bash
bun test packages/gateway/src/perf/surfaces/bench-hitl-popup.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/gateway/src/perf/history-line.ts packages/gateway/src/perf/history-line.test.ts \
        packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.ts \
        packages/gateway/src/perf/surfaces/bench-dashboard-first-paint.test.ts \
        packages/gateway/src/perf/surfaces/bench-hitl-popup.ts \
        packages/gateway/src/perf/surfaces/bench-hitl-popup.test.ts
git commit -m "feat(perf): add S3/S5 stub drivers + stub_reason schema field"
```

---

## Task 9 — Register surfaces in `bench-cli.ts` + update barrel

**Files:**
- Modify: `packages/gateway/src/perf/bench-cli.ts`
- Modify: `packages/gateway/src/perf/bench-cli.test.ts`
- Modify: `packages/gateway/src/perf/bench-runner.ts` (help text)
- Modify: `packages/gateway/src/perf/index.ts`

This task wires every new surface into the CLI orchestrator. Three additions:
- `SURFACE_REGISTRY` gains 7 measurement drivers.
- A new `STUB_SURFACES` map (`{ S3: S3_STUB_REASON, S5: S5_STUB_REASON }`) drives the per-surface stub-row branch.
- A new `REFERENCE_ONLY` set (`new Set(["S2-c"])`) skips reference-only surfaces on non-reference runs and records their per-surface entry as `{ samples_count: 0, stub_reason: "reference-only — skipped on <runner>" }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/gateway/src/perf/bench-cli.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBenchCli } from "./bench-cli.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "bench-cli-pr-b-2a-test-"));
}

describe("runBenchCli — PR-B-2a registrations", () => {
  test("--surface S3 records a stub entry with stub_reason", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const exitCode = await runBenchCli(
        ["--surface", "S3", "--runs", "1", "--gha"],
        { runId: "stub-test", historyPath, fixtureCacheDir: dir, stdout: () => {} },
      );
      expect(exitCode).toBe(0);
      const line = JSON.parse(readFileSync(historyPath, "utf8").trim());
      expect(line.surfaces.S3.samples_count).toBe(0);
      expect(typeof line.surfaces.S3.stub_reason).toBe("string");
      expect(line.surfaces.S3.stub_reason.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--surface S2-c on --gha records a reference-only stub entry", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const exitCode = await runBenchCli(
        ["--surface", "S2-c", "--runs", "1", "--gha"],
        { runId: "ref-only-test", historyPath, fixtureCacheDir: dir, stdout: () => {} },
      );
      expect(exitCode).toBe(0);
      const line = JSON.parse(readFileSync(historyPath, "utf8").trim());
      expect(line.surfaces["S2-c"].samples_count).toBe(0);
      expect(line.surfaces["S2-c"].stub_reason).toMatch(/reference-only/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--surface S2-b on --gha measures the medium tier (override to small for test speed)", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const exitCode = await runBenchCli(
        ["--surface", "S2-b", "--runs", "1", "--corpus", "small", "--gha"],
        { runId: "s2b-test", historyPath, fixtureCacheDir: dir, stdout: () => {} },
      );
      expect(exitCode).toBe(0);
      const line = JSON.parse(readFileSync(historyPath, "utf8").trim());
      expect(line.surfaces["S2-b"].samples_count).toBe(100);
      expect(line.surfaces["S2-b"].stub_reason).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a driver failure records stub_reason and continues (does not abort the run)", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const exitCode = await runBenchCli(
        ["--surface", "S2-a", "--runs", "1", "--corpus", "small", "--gha"],
        {
          runId: "drv-fail-test",
          historyPath,
          fixtureCacheDir: dir,
          stdout: () => {},
          stderr: () => {},
          // Inject a S2-a driver that throws — exercises the bench-cli
          // try/catch wrapper without depending on a real spawn.
          surfaceDriverOverrides: {
            "S2-a": () => Promise.reject(new Error("synthetic driver failure")),
          },
        },
      );
      expect(exitCode).toBe(0);
      const line = JSON.parse(readFileSync(historyPath, "utf8").trim());
      expect(line.surfaces["S2-a"].samples_count).toBe(0);
      expect(line.surfaces["S2-a"].stub_reason).toMatch(/driver-failed.*synthetic/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

**Why no `--all` integration test:** running `--all` in the unit test runner would invoke real `Bun.spawn` for S1 / S4 / S11 (those drivers spawn the gateway / TUI / CLI). That's fragile under `bun test` (port conflicts, IPC socket cleanup, path resolution). The per-driver tests already exercise each driver in isolation with injected fake spawns; the bench-cli tests stay focused on the orchestration logic (registry routing, stub branch, reference-only branch) using only the in-process drivers (S2-a/b, S3, S5). The end-to-end smoke test in Task 11 covers the full `--all` invocation against real processes.

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/gateway/src/perf/bench-cli.test.ts
```

Expected: FAIL on the new tests (existing PR-B-1 tests still pass).

- [ ] **Step 3: Update `bench-cli.ts`**

Replace the `SURFACE_REGISTRY`, add helper sets / maps, and update the dispatch loop. The full file becomes:

```typescript
// packages/gateway/src/perf/bench-cli.ts
/**
 * `nimbus bench` orchestrator. Parses flags, routes to surface drivers,
 * appends a HistoryLine, prints a human summary.
 *
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §3.2 (surface
 * table), §4.1 (reference protocol), §4.5 (aggregation).
 */

import { hostname, platform, release } from "node:os";

import { runBench } from "./bench-harness.ts";
import { appendHistoryLine, type HistoryLine, type HistoryLineSurface } from "./history-line.ts";
import { runColdStartOnce } from "./surfaces/bench-cold-start.ts";
import { runCliOverheadColdOnce } from "./surfaces/bench-cli-overhead-cold.ts";
import { runCliOverheadWarmOnce } from "./surfaces/bench-cli-overhead-warm.ts";
import {
  runDashboardFirstPaintOnce,
  S3_STUB_REASON,
} from "./surfaces/bench-dashboard-first-paint.ts";
import { runHitlPopupOnce, S5_STUB_REASON } from "./surfaces/bench-hitl-popup.ts";
import { runQueryLatencyOnce } from "./surfaces/bench-query-latency.ts";
import { runQueryLatency100kOnce } from "./surfaces/bench-query-latency-100k.ts";
import { runQueryLatency1mOnce } from "./surfaces/bench-query-latency-1m.ts";
import { runTuiFirstPaintOnce } from "./surfaces/bench-tui-first-paint.ts";
import type { BenchRunOptions, BenchSurfaceId, BenchSurfaceResult, RunnerKind } from "./types.ts";

export interface BenchCliDeps {
  /**
   * Caller-supplied UUID for the run. Threaded through to the HistoryLine
   * AND to the signal-handler context factory so an interrupted run records
   * the SAME run_id it would have recorded on success — not a generic
   * "interrupted" sentinel. Generated by `bench-runner.ts`, never by the
   * orchestrator itself.
   */
  runId: string;
  historyPath: string;
  fixtureCacheDir?: string;
  stdout: (s: string) => void;
  stderr?: (s: string) => void;
  /** Defaults to interactive y/n prompt; tests inject a stub. */
  confirmReferenceProtocol?: () => boolean | Promise<boolean>;
  /** Defaults to env-aware lookup; tests inject a stub. */
  resolveGitSha?: () => string;
  /**
   * Test-only: replace the SURFACE_REGISTRY entry for specific ids. Used by
   * unit tests to verify orchestration behaviour (driver failure, success
   * paths) without depending on real spawn / fixture state.
   */
  surfaceDriverOverrides?: Partial<Record<BenchSurfaceId, DriverFn>>;
}

type DriverFn = (
  opts: BenchRunOptions,
  runOpts: { cacheDir?: string },
) => Promise<number[]>;

// Each driver has its own RunOptions shape (S2-b/c pass cacheDir through;
// spawn-based drivers and stubs ignore it). Lambda adapters keep the registry
// value uniformly DriverFn-typed without forcing a kitchen-sink RunOptions
// interface across unrelated surfaces.
const SURFACE_REGISTRY: Partial<Record<BenchSurfaceId, DriverFn>> = {
  S1: (opts) => runColdStartOnce(opts),
  "S2-a": (opts, runOpts) => runQueryLatencyOnce(opts, runOpts),
  "S2-b": (opts, runOpts) => runQueryLatency100kOnce(opts, runOpts),
  "S2-c": (opts, runOpts) => runQueryLatency1mOnce(opts, runOpts),
  S3: (opts) => runDashboardFirstPaintOnce(opts),
  S4: (opts) => runTuiFirstPaintOnce(opts),
  S5: (opts) => runHitlPopupOnce(opts),
  "S11-a": (opts) => runCliOverheadColdOnce(opts),
  "S11-b": (opts) => runCliOverheadWarmOnce(opts),
};

/** Surfaces that ship as stubs — driver returns []; orchestrator writes stub_reason. */
const STUB_SURFACES: Partial<Record<BenchSurfaceId, string>> = {
  S3: S3_STUB_REASON,
  S5: S5_STUB_REASON,
};

/** Surfaces that should only run when runner === reference-m1air. */
const REFERENCE_ONLY: ReadonlySet<BenchSurfaceId> = new Set<BenchSurfaceId>(["S2-c"]);

function takeFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
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
  return false;
}

function defaultResolveGitSha(): string {
  return process.env["GITHUB_SHA"] ?? "unknown";
}

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
  return out;
}

function resolveSurfaces(args: string[], surfaceArg: string | undefined): BenchSurfaceId[] {
  if (hasFlag(args, "--all")) return Object.keys(SURFACE_REGISTRY) as BenchSurfaceId[];
  if (surfaceArg !== undefined) return [surfaceArg as BenchSurfaceId];
  return [];
}

export async function runBenchCli(args: string[], deps: BenchCliDeps): Promise<number> {
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(`${s}\n`));
  const surfaceArg = takeFlag(args, "--surface");
  const runsArg = takeFlag(args, "--runs");
  const corpusArg = takeFlag(args, "--corpus");
  const runs = runsArg === undefined ? 5 : Number.parseInt(runsArg, 10);
  const runner = detectRunner(args);
  const corpus =
    corpusArg === "small" || corpusArg === "medium" || corpusArg === "large"
      ? corpusArg
      : undefined;
  const opts: BenchRunOptions = {
    runs: Number.isFinite(runs) && runs > 0 ? runs : 5,
    runner,
    ...(corpus !== undefined && { corpus }),
  };

  if (runner === "reference-m1air") {
    const confirm = deps.confirmReferenceProtocol ?? defaultConfirm;
    const ok = await confirm();
    if (!ok) {
      stderr("Reference-run protocol checklist not confirmed. Refusing to record. See spec §4.2.");
      return 2;
    }
  }

  const surfaces = resolveSurfaces(args, surfaceArg);

  if (surfaces.length === 0) {
    stderr(
      "Pass --surface <id> or --all. Available surfaces: " +
        Object.keys(SURFACE_REGISTRY).join(", "),
    );
    return 2;
  }

  const surfaceResults: Record<string, HistoryLineSurface> = {};
  for (const id of surfaces) {
    // Stub branch — driver exists but returns no samples; record stub_reason.
    const stubReason = STUB_SURFACES[id as BenchSurfaceId];
    if (stubReason !== undefined) {
      surfaceResults[id] = { samples_count: 0, stub_reason: stubReason };
      deps.stdout(`${id}  stub: ${stubReason}`);
      continue;
    }

    // Reference-only skip branch — record a per-surface stub entry.
    if (REFERENCE_ONLY.has(id as BenchSurfaceId) && runner !== "reference-m1air") {
      const reason = `reference-only — skipped on ${runner}`;
      surfaceResults[id] = { samples_count: 0, stub_reason: reason };
      deps.stdout(`${id}  skipped: ${reason}`);
      continue;
    }

    const driver =
      deps.surfaceDriverOverrides?.[id as BenchSurfaceId] ?? SURFACE_REGISTRY[id as BenchSurfaceId];
    if (driver === undefined) {
      stderr(`Surface ${id} has no driver registered yet (PR-B-2b work).`);
      return 2;
    }
    const runOpts = deps.fixtureCacheDir !== undefined ? { cacheDir: deps.fixtureCacheDir } : {};

    // A driver failure (e.g., S4 invoked with no gateway running, or any
    // spawn-based driver hitting a missing dependency) must not abort the
    // entire run. Record a per-surface stub_reason and continue — successful
    // surface entries on the same line stay valid for delta comparisons.
    let result;
    try {
      result = await runBench(id, (o) => driver(o, runOpts), opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      surfaceResults[id] = { samples_count: 0, stub_reason: `driver-failed: ${msg}` };
      stderr(`${id} driver failed: ${msg}`);
      deps.stdout(`${id}  failed: ${msg}`);
      continue;
    }

    surfaceResults[id] = resultToHistorySurface(result);
    deps.stdout(
      `${id}  p95=${result.p95Ms?.toFixed(2) ?? "-"}ms  p99=${result.p99Ms?.toFixed(2) ?? "-"}ms  samples=${result.samplesCount}`,
    );
  }

  const resolveGitSha = deps.resolveGitSha ?? defaultResolveGitSha;
  const line: HistoryLine = {
    schema_version: 1,
    run_id: deps.runId,
    timestamp: new Date().toISOString(),
    runner,
    os_version: `${platform()} ${release()} (${hostname()})`,
    nimbus_git_sha: resolveGitSha(),
    bun_version: typeof Bun === "undefined" ? "unknown" : Bun.version,
    surfaces: surfaceResults as Partial<Record<BenchSurfaceId, HistoryLineSurface>>,
    ...(runner === "reference-m1air" && { reference_protocol_compliant: true }),
  };
  appendHistoryLine(deps.historyPath, line);
  return 0;
}
```

- [ ] **Step 4: Update help text in `bench-runner.ts`**

Edit `packages/gateway/src/perf/bench-runner.ts` — update the `HELP` constant's `--surface <id>` line:

```diff
-  --surface <id>      surface id (S2-a is the only registered driver in PR-B-1)
+  --surface <id>      one of: S1, S2-a, S2-b, S2-c, S3, S4, S5, S11-a, S11-b
+                      (cluster C — S6/S7/S8/S9/S10 — lands in PR-B-2b)
```

Also update the same `HELP` constant in `packages/cli/src/commands/bench.ts` to match.

- [ ] **Step 5: Update `packages/gateway/src/perf/index.ts`**

Add re-exports for the new drivers:

```typescript
// packages/gateway/src/perf/index.ts

export { type BenchCliDeps, runBenchCli } from "./bench-cli.ts";
export { runBench, type SurfaceFn } from "./bench-harness.ts";
export {
  appendHistoryLine,
  type HistoryLine,
  type HistoryLineSurface,
} from "./history-line.ts";
export { computePercentiles, type PercentileResult } from "./percentiles.ts";
export { buildSyntheticIndex, FIXTURE_SEED, FIXTURE_TIER_SIZES } from "./perf-fixture.ts";
export {
  type IncompleteContext,
  installIncompleteSignalHandler,
  writeIncompleteLine,
} from "./signal-handler.ts";
export { spawnAndTimeToMarker, type SpawnAndTimeOptions, type SpawnMode } from "./process-spawn-bench.ts";
export {
  COLD_START_SAMPLES_PER_RUN,
  runColdStartOnce,
} from "./surfaces/bench-cold-start.ts";
export {
  CLI_COLD_SAMPLES_PER_RUN,
  runCliOverheadColdOnce,
} from "./surfaces/bench-cli-overhead-cold.ts";
export {
  CLI_WARM_SAMPLES_PER_RUN,
  runCliOverheadWarmOnce,
} from "./surfaces/bench-cli-overhead-warm.ts";
export {
  runDashboardFirstPaintOnce,
  S3_STUB_REASON,
} from "./surfaces/bench-dashboard-first-paint.ts";
export {
  runHitlPopupOnce,
  S5_STUB_REASON,
} from "./surfaces/bench-hitl-popup.ts";
export { runQueryLatency100kOnce, S2B_TIER } from "./surfaces/bench-query-latency-100k.ts";
export { runQueryLatency1mOnce, S2C_TIER } from "./surfaces/bench-query-latency-1m.ts";
export {
  runTuiFirstPaintOnce,
  TUI_FIRST_PAINT_SAMPLES_PER_RUN,
} from "./surfaces/bench-tui-first-paint.ts";
export type {
  BenchRunOptions,
  BenchSurfaceId,
  BenchSurfaceResult,
  CorpusTier,
  RunnerKind,
} from "./types.ts";
```

- [ ] **Step 6: Run the bench-cli tests + perf coverage gate**

```bash
bun test packages/gateway/src/perf/bench-cli.test.ts
bun run test:coverage:perf
```

Expected: All bench-cli tests pass (existing + 3 new). Coverage gate ≥80% lines.

If the `--all` integration test trips the default 30 s test timeout, add `, { timeout: 60_000 }` to that specific `test()` block.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/perf/bench-cli.ts packages/gateway/src/perf/bench-cli.test.ts \
        packages/gateway/src/perf/bench-runner.ts packages/cli/src/commands/bench.ts \
        packages/gateway/src/perf/index.ts
git commit -m "feat(perf): register PR-B-2a surfaces in bench-cli with stub + reference-only branches"
```

---

## Task 10 — Write `docs/perf/slo-ux.md`

**Files:**
- Create: `docs/perf/slo-ux.md`

The published UX SLO sheet for PR-B-2a contains the full 16-row surface table from spec § 3.2 (UX surfaces with concrete thresholds; workload surfaces flagged `TBD Phase 2`), the mandatory M1-Air caveat row from spec § 4.1, and per-row citations.

Citation choices:
- **S1** (cold start) — Nielsen 1 s "flow" threshold (the user maintains an uninterrupted flow of thought up to 1 s).
- **S2-a/b/c** (query) — Nimbus product claim ("local-first should feel snappier than SaaS"); Nielsen 0.1 s "perception" threshold for cross-check.
- **S3** (dashboard first-paint) — Nielsen 1 s flow threshold; RAIL "Load" budget (≤1 s).
- **S4** (TUI first-paint) — RAIL "Response" (≤100 ms target); Nielsen 1 s ceiling.
- **S5** (HITL popup) — RAIL "Response" (≤100 ms); Nielsen 0.1 s perception threshold.
- **S11-a/b** (CLI overhead) — Nielsen 1 s flow threshold (cold); RAIL "Response" (warm ≤100 ms target).

- [ ] **Step 1: Write `docs/perf/slo-ux.md`**

```markdown
# Nimbus UX SLO Sheet

> **Status:** PR-B-2a — UX surfaces published with concrete thresholds; workload surfaces (S6, S7, S8, S9, S10) are flagged `TBD Phase 2` and will be filled in once `nimbus bench --reference` measurement runs land.
>
> **Spec source:** [`docs/superpowers/specs/2026-04-26-perf-audit-design.md`](../superpowers/specs/2026-04-26-perf-audit-design.md) §3.

## Reference hardware caveat

These figures are measured on a **2020 M1 MacBook Air, 8 GB / 256 GB**. Performance on x64 / older hardware is measured but **not threshold-gated** for `v0.1.0`; see GHA matrix results in [`history.jsonl`](./history.jsonl) for that baseline. The reference machine anchors the published SLO to a real-world worst-case "Nimbus runs on your existing laptop" profile; runs on equal-or-better hardware should meet or beat these targets.

## Threshold semantics

For every measurement entry, `threshold` is the maximum allowed value for the **specified percentile of a multi-run aggregate** (median-of-medians across 5 runs — see spec §4.5). Almost all UX rows use **p95**.

A bench fails when either:
- the measured aggregate exceeds the absolute reference or GHA threshold, **or**
- the run delta vs the most recent `main` history entry for the same `runner` exceeds the per-surface noise floor (`max(noise_floor_pct, absolute_noise_floor_ms / previous × 100)`).

## Surface table

| # | Surface | Class | Inputs / preconditions | Metric (aggregate) | Reference threshold | GHA threshold | Noise floor (rel %, abs) | Citation |
|---|---|---|---|---|---|---|---|---|
| S1 | Gateway cold start (PAL → IPC ready) | UX | none | p95 of cold-start ms across 5 fresh-process runs | **≤2 000 ms** | ≤10 000 ms | 25 %, 200 ms | Nielsen 1 s "flow" threshold¹ |
| S2-a | Query p95 (`engine.askStream`) — **10 K corpus** | UX | synthetic snapshot tier `small` | p95 ms across 5 runs × 100 queries | **≤30 ms** | ≤200 ms | 25 %, 5 ms | Nimbus product claim²; Nielsen 0.1 s perception threshold¹ |
| S2-b | Query p95 — **100 K corpus** | UX | synthetic snapshot tier `medium` | p95 ms across 5 runs × 100 queries | **≤80 ms** | ≤500 ms | 25 %, 10 ms | Nimbus product claim²; Nielsen 0.1 s perception threshold¹ |
| S2-c | Query p95 — **1 M corpus** | UX | synthetic snapshot tier `large`, **reference only** (skipped on GHA — corpus generation cost) | p95 ms across 5 runs × 100 queries | **≤300 ms** | n/a (reference only) | 25 %, 25 ms | Nimbus product claim²; Nielsen 1 s flow threshold¹ as ceiling |
| S3 | Dashboard first-paint | UX | synthetic snapshot tier `medium`, warm gateway | p95 ms across 5 cold-app launches | **≤1 500 ms** | ≤7 500 ms | 25 %, 100 ms | Nielsen 1 s flow threshold¹; RAIL Load budget³ |
| S4 | TUI first-paint (`nimbus tui` → first frame) | UX | warm gateway | p95 ms across 5 invocations | **≤500 ms** | ≤2 500 ms | 25 %, 50 ms | RAIL Response budget³; Nielsen 1 s ceiling¹ |
| S5 | HITL popup latency | UX | warm gateway, popup window pre-warmed | p95 ms (`consent.request` → renderer paint) across 20 invocations | **≤200 ms** | ≤1 000 ms | 25 %, 25 ms | RAIL Response budget³; Nielsen 0.1 s perception threshold¹ |
| S6 | Sync throughput per connector (Drive / Gmail / GitHub) | Workload | recorded HTTP trace via MSW; fetch-only | items/sec, p50 across 5 replays | TBD Phase 2 | per-OS TBD Phase 2 | 25 %, 5 items/sec | (workload surface — set after measurement) |
| S7-a | Memory RSS — **idle** | Workload | warm gateway, synthetic snapshot `medium`, **Linux only gates** (macOS/Windows informational) | p95 of `process.memoryUsage().rss` over 60 s sampling | TBD Phase 2 | n/a (Linux GHA only) | 20 %, 20 MB | (workload surface — set after measurement) |
| S7-b | Memory RSS — **heavy sync** | Workload | as S7-a + scripted parallel sync of 3 connectors | p95 RSS over the sync window | TBD Phase 2 | n/a | 20 %, 50 MB | (workload surface — set after measurement) |
| S7-c | Memory RSS — **multi-agent** | Workload | as S7-a + 3-sub-agent decomposition; **reference only** (requires loaded LLM, see S9) | p95 RSS during multi-agent run | TBD Phase 2 | n/a (reference only) | 20 %, 50 MB | (workload surface — set after measurement) |
| S8 | Embedding generation throughput (MiniLM) | Workload | synthetic text fixtures (50/500/5 000 chars; batch sizes 1/8/32/64) | items/sec by `(length, batch)`; matrix output | TBD Phase 2 | per-OS TBD Phase 2 | 25 %, 5 items/sec | (workload surface — set after measurement) |
| S9 | Local LLM round-trip (Ollama, `llama3.2:3b-instruct-q4_K_M`, warm-model) | Workload | canonical 3-prompt set; **reference only on Apple Silicon GPU**; GHA-skipped | first-token-ms p50 + tokens/sec median across 5 runs per prompt | TBD Phase 2 | n/a (skipped) | 30 %, 50 ms / 2 tps | (workload surface — set after measurement) |
| S10 | SQLite write throughput under contention | Workload | scripted concurrent writers (sync + watcher fire + audit append) against fresh DB | writes/sec p50 across 5 runs | TBD Phase 2 | per-OS TBD Phase 2 | 25 %, 100 writes/sec | (workload surface — set after measurement) |
| S11-a | CLI invocation overhead — **cold** (`nimbus help`) | UX | fresh process, no warm cache | p95 ms across 5 invocations | **≤300 ms** | ≤1 500 ms | 25 %, 50 ms | Nielsen 1 s flow threshold¹ |
| S11-b | CLI invocation overhead — **warm** | UX | second invocation within same shell | p95 ms across 5 invocations | **≤50 ms** | ≤250 ms | 25 %, 10 ms | RAIL Response budget³ |

## Surfaces shipped as stubs in PR-B-2a

S3 and S5 publish a target threshold but their bench drivers ship as stubs (return `[]`, write a per-surface `stub_reason` field) until renderer-side perf marks land in a follow-up PR scoped to `packages/ui/`. The bidirectional driver↔row mapping (spec §6 acceptance criterion 7) holds because `surfaces/bench-dashboard-first-paint.ts` and `surfaces/bench-hitl-popup.ts` exist and are registered.

## Citations

1. **Nielsen, J.** — *Response Times: The 3 Important Limits.* Nielsen Norman Group, 1993, updated at <https://www.nngroup.com/articles/response-times-3-important-limits/>. Three thresholds: 0.1 s = perceived as instantaneous; 1.0 s = limit of uninterrupted flow; 10 s = limit of attention.
2. **Nimbus product claim** — see [`docs/mission.md`](../mission.md): "local-first should feel snappier than SaaS." Concretely, sub-100 ms query latency on a 10 K-row local corpus is the floor that makes the claim defensible against cloud-hosted equivalents (typical SaaS dashboard query: ~200–500 ms RTT).
3. **Google** — *Measure performance with the RAIL model.* <https://web.dev/articles/rail>. Four budgets: Response ≤100 ms, Animation ≤16 ms / frame, Idle ≤50 ms work units, Load ≤1 s.

## What this sheet is not

- **Not a workload SLO.** S6 / S7 / S8 / S9 / S10 thresholds are filled in by Phase 2 (PR-C) once `nimbus bench --reference` has produced a baseline.
- **Not a `slo.md`.** Phase 2 renames this file to `docs/perf/slo.md` once the workload rows are populated.
- **Not a regression-tracking document.** The ongoing per-run history lives in [`history.jsonl`](./history.jsonl).
```

- [ ] **Step 2: Verify the doc renders cleanly**

```bash
bun run lint:fix
```

Expected: no formatting errors.

- [ ] **Step 3: Commit**

```bash
git add docs/perf/slo-ux.md
git commit -m "docs(perf): publish UX SLO sheet with M1-Air caveat + per-row citations"
```

---

## Task 11 — End-to-end smoke + final CI run

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full perf coverage gate**

```bash
bun run test:coverage:perf
```

Expected: PASS, ≥80 % lines.

- [ ] **Step 2: Run typecheck + lint**

```bash
bun run typecheck
bun run lint
```

Expected: zero errors.

- [ ] **Step 3: Smoke-run each surface individually**

`--all` cannot be used here because S1 spawns fresh gateway processes (each one tries to bind the IPC socket) and S4 requires a *running* gateway to connect to — those two surfaces have mutually exclusive preconditions. The smoke runs split into two passes.

**Pass A — no gateway running** (covers S1, S2-a/b/c, S3, S5, S11-a, S11-b):

```bash
HIST=/tmp/nimbus-bench-smoke.jsonl
FIX=/tmp/nimbus-bench-fixtures
rm -f "$HIST"

for surface in S1 S2-a S2-b S2-c S3 S5 S11-a S11-b; do
  bun packages/cli/src/index.ts bench --surface "$surface" --runs 1 --corpus small --gha --history "$HIST" --fixture-cache "$FIX"
done
```

Expected: 8 successful invocations, each appending one JSON line to `$HIST`. `S2-c` carries `stub_reason: "reference-only — skipped on gha-..."`; `S3` and `S5` carry the `renderer instrumentation pending` stub reason; the others have non-zero `samples_count`. S11-a/b spawn `nimbus help` (Note 2 fix) — does not require a gateway.

**Pass B — gateway running** (covers S4 only). In a separate shell:

```bash
# Shell A
bun run packages/gateway/src/index.ts
# (wait for "[gateway] ready" line)
```

Then in your working shell:

```bash
bun packages/cli/src/index.ts bench --surface S4 --runs 1 --gha --history "$HIST" --fixture-cache "$FIX"
```

Expected: command exits 0, S4 entry appended with non-zero `samples_count`. Stop the gateway in Shell A (`Ctrl+C`).

**Verify:** `$HIST` contains 9 JSONL lines, all parse as valid JSON, all have `schema_version: 1`. Quick parse check:

```bash
wc -l "$HIST"             # → 9
head -1 "$HIST" | jq .    # parses cleanly; surfaces.S1.samples_count > 0
```

If S1 / S4 spawn paths fail on Windows due to `process.execPath` quirks, note the failure and address in a small follow-up commit before opening the PR.

- [ ] **Step 4: Run the full CI suite**

```bash
bun run test:ci
```

Expected: PASS.

- [ ] **Step 5: Commit any fixes uncovered by smoke / CI**

If any errors surface, fix them and commit each fix as a small standalone commit (one fix per commit) before opening the PR.

---

## Task 12 — Open PR-B-2a

**Files:** none modified.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin dev/asafgolombek/perf-audit
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --title "perf(B2): Phase 1B — 8 surface drivers + UX SLO sheet (PR-B-2a)" --body "$(cat <<'EOF'
## Summary

Lands PR-B-2a of the B2 perf audit: 7 measurement drivers (S1 cold start, S2-b/c query-tier wrappers, S4 TUI first-paint, S11-a/b CLI overhead) + 2 stub drivers (S3 dashboard first-paint, S5 HITL popup) + the published UX SLO sheet.

PR-B-1 (#115) shipped the harness scaffolding and the S2-a proof driver. This PR fans the harness out across the remaining UX surface classes from spec §3.2.

- New `process-spawn-bench.ts` helper times cross-process surfaces (S1, S4, S11) using either a stdout marker or clean exit.
- S3 and S5 ship as stubs (`[]` samples + per-surface `stub_reason`) until a follow-up PR adds Tauri renderer perf marks. The bidirectional driver↔row mapping in spec §6 criterion 7 holds because the driver files exist and are registered.
- S2-c (1 M corpus) is gated reference-only at the CLI layer (`REFERENCE_ONLY` set in `bench-cli.ts`); GHA runs record an `incomplete` per-surface entry.
- One-line stderr marker added in `packages/cli/src/commands/tui.tsx` after Ink mounts (S4 first-paint signal).
- `docs/perf/slo-ux.md` publishes UX thresholds with the M1-Air caveat row and per-row Nielsen / RAIL / Nimbus-claim citations.

Spec: `docs/superpowers/specs/2026-04-26-perf-audit-design.md`
Plan: `docs/superpowers/plans/2026-04-26-perf-audit-phase-1b.md`

## Out of scope (lands later)

- Cluster C workload drivers (S6 sync MSW, S7 memory RSS, S8 embedding throughput, S9 LLM, S10 SQLite contention) — PR-B-2b plan.
- Real Tauri renderer instrumentation for S3 / S5 — separate small PR scoped to `packages/ui/`.
- CI workflow `_perf.yml`, workload thresholds, `baseline.md`, `missed.md` — Phase 2 / PR-C work.

## Test plan

- [ ] `bun run test:ci` passes locally
- [ ] `bun run test:coverage:perf` ≥80 % lines
- [ ] Manual smoke: `bun packages/cli/src/index.ts bench --all --runs 1 --corpus small --gha` writes one valid JSONL line with all 9 surface IDs (S2-c / S3 / S5 carry `stub_reason`)
- [ ] Three-OS CI matrix passes (Ubuntu / macOS / Windows)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify CI starts**

```bash
gh pr view --web
```

Watch CI status; address any platform-specific failures (Windows path quirks in spawn paths are the most likely class).

---

## Self-review checklist

After implementing all tasks, verify:

1. **Spec coverage:** Every PR-B-2 deliverable from spec §10 (PR-B-2 deliverables) lands or is explicitly deferred to PR-B-2b. Specifically: 8 of 16 surface drivers exist (S1, S2-b, S2-c, S3, S4, S5, S11-a, S11-b); SLO sheet is published; bidirectional driver↔row mapping holds for all 8 PR-B-2a surfaces; the M1-Air caveat row appears in `slo-ux.md`.
2. **Bidirectional mapping (spec §6 criterion 7):** Every surface ID registered in `SURFACE_REGISTRY` has a `surfaces/bench-*.ts` file; every `surfaces/bench-*.ts` file is registered. No orphans.
3. **Schema additivity:** The `stub_reason` field is **optional**. Existing PR-B-1 history-line consumers (none yet, but downstream tooling) read older lines without breaking.
4. **Reference-only gating:** `S2-c` does not run on `--gha` runs. Verified by the bench-cli test added in Task 9.
5. **Test discipline:** Every driver has a `.test.ts`. Every TDD task wrote test → ran failing → implemented → ran passing → committed.
6. **Coverage gate:** `test:coverage:perf` passes at ≥80 % lines.
7. **No `any`, no plaintext credentials, no `0.0.0.0` defaults** — none of the new code touches IPC, vault, or LAN; the non-negotiables in CLAUDE.md don't apply directly but verify no regressions via lint + typecheck.
