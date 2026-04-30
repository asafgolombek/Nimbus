# Review: Perf Audit — PR-C-2a Design

**Reviewer:** Gemini CLI
**Date:** 2026-04-29
**Target Doc:** [`2026-04-29-perf-audit-pr-c-2a-design.md`](./2026-04-29-perf-audit-pr-c-2a-design.md)

## Summary
The design for PR-C-2a is comprehensive and correctly separates infrastructure concerns from hardware-dependent data population. The use of a dedicated reference workflow with explicit operator attestation is a strong security and quality gate.

## Open Questions & Clarifications

1.  **Initial `history.jsonl` State:**
    *   **Question:** If `docs/perf/history.jsonl` does not exist or is empty, will the `nimbus bench` command handle it gracefully? 
    *   **Context:** Section 4 shows the workflow invoking `nimbus bench` with `--history "${{ github.workspace }}/docs/perf/history.jsonl"`. If this is the first-ever run, we should ensure the directory exists and the harness can initialize the file.

2.  **Sanity Check Brittleness:**
    *   **Suggestion:** The check `new_lines=$(git diff -- docs/perf/history.jsonl | grep -c '^+{')` assumes the diff only contains the new JSON line. If the file was just created (adding a header) or if there are whitespace changes, this count might be off.
    *   **Improvement:** Consider using `tail -n 1` combined with `jq` to validate the content, and perhaps `git diff --name-only` to ensure no other files were touched.

3.  **Artifact Dependencies in `_perf.yml`:**
    *   **Question:** Does the `bench-ci` orchestrator or any downstream job in `_perf.yml` depend on the artifacts that are now being skipped on weekday nightlies for macOS/Windows?
    *   **Context:** If a later job expects the `perf-macos-15` artifact to exist, it might fail when the "heavy" steps are skipped. Ensure the downstream logic handles missing artifacts (e.g., using `continue-on-error` or checking for artifact existence).

4.  **Self-Hosted Runner Security:**
    *   **Suggestion:** For public repositories, GitHub recommends against using self-hosted runners due to RCE risks via PRs. 
    *   **Clarification:** Although `_perf-reference.yml` is `workflow_dispatch` only (reducing surface), the runner itself might be reachable if it's left online. The `reference-runner-setup.md` should explicitly warn about the "one-shot" vs "persistent" trade-offs regarding security.

5.  **`protocol_attested` Input Type:**
    *   **Observation:** The input is a `boolean` with `default: false`. 
    *   **Question:** Since GHA UI shows a checkbox, is it possible for a user to trigger it without "attesting"? (The `if: inputs.protocol_attested != true` gate correctly handles this, but a `required: true` on a boolean in GHA sometimes just means the field must exist, not that it must be `true`).

## Suggestions for Improvement

1.  **`_perf-reference.yml` - Explicit Directory Creation:**
    *   Add `mkdir -p docs/perf` before the benchmark run to ensure the history file path is valid.

2.  **Runner Metadata:**
    *   In the `history.jsonl` sanity check, also verify that `os_version` is populated. The design mentions it's auto-captured, but an explicit check ensures the capture logic in `bench-runner.ts` is working.

3.  **`reference-runner-setup.md` - `gh` auth:**
    *   The setup guide mentions `gh api`. It might be helpful to remind the operator to run `gh auth login` with appropriate scopes (especially `repo` and `workflow`) before starting.

4.  **`BenchCliDeps` - Type Safety:**
    *   Ensure that `confirmReferenceProtocol` is correctly typed as an optional function in the `BenchCliDeps` interface to avoid runtime errors when it's not provided.

## Next Steps
Please address the questions regarding artifact dependencies in `_perf.yml` and the initial state of the history file. Once clarified, this design is ready for the implementation plan.
