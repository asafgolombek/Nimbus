# Feedback — Cluster C Drivers Sub-PR 1 (PR-B-2b-1) Implementation Plan

**Date:** 2026-04-27
**Target Doc:** [`2026-04-27-perf-audit-cluster-c-1.md`](./2026-04-27-perf-audit-cluster-c-1.md)

## 1. Open Questions

1.  **S7-b IPC Client Wiring Details:** Task 11 mentions that production wiring for the IPC client is deferred to plan-execution. Will this use a standard `@nimbus-dev/client` instance, or a raw Bun socket connection for maximum control/minimal overhead? Providing a small snippet of the intended wiring would clarify the "Real" path.
2.  **Child Process Stderr Visibility:** In `gateway-spawn-bench.ts`, if `waitForMarker` times out, the error message only says `gateway not ready in {timeoutMs}ms`. Should we capture and include the last N lines of the child's `stderr` in the exception? This would be invaluable for debugging "port in use" or "module not found" errors during bench development.
3.  **MSW Passthrough Policy:** In Task 13-15, the `runSyncThroughput*Once` drivers use `onUnhandledRequest: "warn"`. Given the "sentinel" goal mentioned in the plan, should we stick to `"error"` (like the unit tests) to ensure we have 100% coverage of the connector's network footprint?
4.  **Task 2 Audit Trail:** The plan suggests recording the HTTP verification verdicts in Task 17's commit message. Since Task 2 is the actual research step, should we commit a small `packages/gateway/src/perf/fixtures/README.md` or similar to document the verification results and Octokit version check permanently, rather than relying solely on git history?

## 2. Suggestions & Improvements

1.  **Helper Reuse in Tests:** In `gateway-spawn-bench.test.ts`, the `fakeSpawn` and `streamFrom` functions are very similar to what's likely used in other perf tests. If these are common patterns, consider moving them to a `packages/gateway/src/perf/test-helpers.ts` to reduce boilerplate across the 22 new files.
2.  **`rss-sampler` Sampling Drift:** The `sampleRss` implementation uses `setTimeout(resolve, wait)` which doesn't account for the execution time of `sampler(opts.pid)`. For a 250ms interval, this could lead to cumulative drift. Consider using a "next tick" calculation (e.g., `performance.now() + intervalMs`) to maintain a more consistent cadence.
3.  **`S6-*` Count SQL Performance:** The drivers use `SELECT COUNT(*) AS c FROM item WHERE service = '...'`. While correct, ensure the `item` table has an index on the `service` column (it should, based on architecture.md) so the "before" and "after" checks don't add significant overhead to the throughput measurement.
4.  **`REFERENCE_ONLY_REASONS` Consistency:** Task 17 Step 5 introduces a new lookup for skip reasons. To keep `bench-cli.ts` clean, consider if these reasons should live inside the driver modules themselves (e.g. `export const STUB_REASON = ...`) and be imported into the registry.
5.  **Temp Dir Cleanup:** In Tasks 13-15, `rmSync(home, { recursive: true, force: true })` is in a `finally` block. This is perfect. Just ensure the `mkdtempSync` prefix is unique enough to avoid any collisions during parallel local runs (though `nimbus bench` runs surfaces sequentially).

## 3. Explanations of Key Implementation Details

*   **ResultKind Aggregation:** The extension to `runBench` is critical. By using "median of medians" for throughput and "p95 of all samples" for RSS, the plan correctly balances stability (removing outliers in throughput) with peak-sensitivity (capturing memory spikes).
*   **Gateway-Spawn Logic:** The use of `AbortController` and `signal` in `gateway-spawn-bench.ts` ensures that if a workload crashes, the sampler is stopped immediately and the child process is not left as a zombie.
*   **Trace Determinism:** The use of a Linear Congruential Generator (LCG) for synthetic data is excellent engineering. It ensures that "Large" tier results are comparable across different developer machines and CI environments.
