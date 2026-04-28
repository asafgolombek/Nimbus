# Review: Perf Audit (B2) — Cluster C Drivers, Sub-PR 2 (PR-B-2b-2)

**Plan File:** `docs/superpowers/plans/2026-04-28-perf-audit-cluster-c-2.md`
**Reviewer:** Gemini CLI
**Date:** 2026-04-28

## Overall Assessment
The plan is **Exemplary**. It provides high-signal technical details, follows the `writing-plans` skill requirements (no placeholders, exact code, TDD flow), and maintains strict parity with production code paths (e.g., using `dbRun` and identical INSERT schemas).

## Technical Strengths
1.  **D-1 (Worker Constructor):** Correctly identifies that Bun's Web Worker implementation follows the standard Web API (URL only) rather than the Node.js `worker_threads` API.
2.  **S10 Contention Strategy:** Using three distinct Worker scripts for Sync, Watcher, and Audit provides a realistic simulation of OS-level file lock contention.
3.  **Production Parity:** Reusing `computeAuditRowHash` and the 13-column `item` INSERT recipe ensures the benchmark measures real-world code performance.
4.  **Task 9 (Smoke Task):** Including a non-committable verification task for Worker booting is an excellent "look before you leap" practice.

## Suggestions for Improvement
1.  **Worker Path Compatibility (Task 13):**
    *   **Current:** `path.replace(/\\/g, "/")` is used to handle Windows paths in URLs.
    *   **Suggestion:** Ensure that `import.meta.dir` resolution remains robust when the gateway is compiled to a binary (Task 19 smoke should verify this if the runner is the source file).

2.  **S10 Sample Stability:**
    *   **Observation:** The default duration is 5 seconds.
    *   **Question:** Is 5 seconds sufficient to reach a stable state for `SQLITE_BUSY` retries, or might it be susceptible to OS scheduling noise? Consider suggesting a 10s default for the "large" corpus runs.

3.  **Sentinel Reset Safety:**
    *   **Observation:** `S10_BUSY_RETRIES` is a module-level sentinel.
    *   **Suggestion:** In Task 13 (Step 7), ensure the sentinel is cleared *before* the driver runs to prevent leakage if a previous run crashed. The plan does this in Task 10, but adding a "defensive clear" in the orchestrator (`bench-cli.ts`) would be safer.

## Open Questions for Claude
1.  **S8 Vocabulary Size:** The `synthetic-text.ts` uses a 30-word vocabulary. Does the MiniLM model (or its tokenizer) have any optimizations for repetitive small vocabularies that might artificially inflate throughput?
2.  **Worker OOM:** At the largest S8 tier (5000 chars × 64 batch), the memory footprint is estimated at 20MB. When running S10 with three concurrent workers plus the main process, has the aggregate RSS footprint been considered for lower-tier GHA runners (e.g., Ubuntu 7GB)?

## Recommended Approval
**Approved.** The plan is ready for execution.
