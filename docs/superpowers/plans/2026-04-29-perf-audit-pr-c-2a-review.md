# Review: Perf Audit (B2) — PR-C-2a Implementation Plan

**Reviewer:** Gemini CLI
**Date:** 2026-04-29
**Target Doc:** [`2026-04-29-perf-audit-pr-c-2a.md`](./2026-04-29-perf-audit-pr-c-2a.md)

## Summary
The implementation plan is highly detailed and follows the design doc closely. The sequence of tasks is logical, and the inclusion of precondition checks for the deletion of legacy scripts is excellent.

## Open Questions & Clarifications

1.  **`reference_protocol_compliant` Field (Task 1.1):**
    *   **Question:** The test in Step 1.1 expects `parsed.reference_protocol_compliant` to be `true`. Does the `runBenchCli` orchestrator (in `bench-cli.ts`) automatically set this field in the JSON output when `confirmReferenceProtocol` returns `true`?
    *   **Suggestion:** If it doesn't, we need to either update the orchestrator or adjust the test expectation.

2.  **`os_version` in History Line (Task 3.2):**
    *   **Clarification:** Step 3.2's sanity check validates that `os_version` is a populated string. While the `ctxFactory` for incomplete runs (Step 1.3) includes it, we should confirm that the successful history line written by the orchestrator also captures this field. 

3.  **Sanity Check vs. Incremental Changes (Task 3.2):**
    *   **Observation:** The check `changed=$(git status --porcelain | awk '{print $2}')` followed by `if [[ "$changed" != "docs/perf/history.jsonl" ]]` will fail if *multiple* files are changed.
    *   **Suggestion:** Use a more robust check to ensure `docs/perf/history.jsonl` is the *only* modified file, for example:
        ```bash
        changed_count=$(git status --porcelain | wc -l)
        if [[ "$changed_count" != "1" ]] || [[ $(git status --porcelain) != *"docs/perf/history.jsonl"* ]]; then
          echo "::error::Unexpected file changes."
          exit 1
        fi
        ```

4.  **`bun install` side-effects:**
    *   **Question:** Is it possible for `bun install` or the setup action to modify `bun.lock` or other files in the self-hosted environment?
    *   **Recommendation:** If the runner isn't guaranteed to be clean, we might need a `git checkout -- .` or similar before the bench run, or explicitly ignore certain files in the sanity check.

## Suggestions for Improvement

1.  **Task 8 Cleanup:**
    *   In Step 8.2, we create `/tmp/perf-precondition`. It would be good practice to add a cleanup step at the end of Task 8 or in the defer-path.

2.  **Workflow Input Description:**
    *   In `_perf-reference.yml`, the `protocol_attested` description mentions "Low Power Mode off". For M1 Air specifically, it's also worth mentioning "Plugged into power" as Apple Silicon can throttle on battery. (Wait, it is mentioned: "AC powered").

3.  **`BenchCliDeps` Type Safety:**
    *   As noted in the design review, ensure `packages/gateway/src/perf/bench-cli.ts` (or wherever `BenchCliDeps` is defined) has `confirmReferenceProtocol` marked as optional: `confirmReferenceProtocol?: () => boolean | Promise<boolean>`.

## Next Steps
Once these minor points are clarified (especially the `reference_protocol_compliant` field existence), the plan is solid and ready for execution.
