# Phase 3 Review — Intelligence Plan (v2)

**Date:** 2026-04-11  
**Reviewer:** Gemini CLI  
**Subject:** Updated Review of `docs/phase-3-intelligence-plan.md`

This document provides a follow-up review of the Phase 3 (Intelligence) implementation plan. The plan has been significantly updated to incorporate architectural safeguards and performance optimizations.

---

## 1. Summary of Changes (Previously Addressed)

The core team has successfully integrated the following architectural and security improvements into the plan:

- **Performance:** Embedding now runs in a dedicated **Bun Worker thread** with `pause_on_battery` support.
- **RAG & Search:** Hybrid search now includes **chunk deduplication** and **parent document retrieval** (context ± 1 chunk).
- **Security:** Extensions now have **double-hash verification** (manifest + entry point) and a mandatory CLI security disclaimer.
- **Resilience:** The watcher system now includes **rate limiting** and **cycle detection** to prevent infinite loops.
- **Schema:** The vector store is now **dimension-qualified** (`vec_items_384`), pre-positioning the system for future model migrations.
- **Wave 3:** The connector rollout is now tiered into **3a (CI/CD)**, **3b (Infra)**, and **3c (Obs)**.

---

## 2. New Observations & Refinements

### 2.1 Embedding Backfill & Provider Switching
- **Observation:** The plan states that changing the provider (e.g., local → OpenAI) triggers a full re-index.
- **Suggestion:** For very large indices, provide a way to **resume** or **background** this re-indexing rather than just printing a warning. If the user switches back to "local", the system could potentially check if `vec_items_384` rows already exist for that model name to avoid redundant work.

> **✅ Done:** Provider/model switching now has three cases: (1) model unchanged → no re-index; (2) model changed → delete only rows with the old model name then backfill the delta; (3) switching back to a previously-used model → items that already have chunks under the target model are skipped, only the delta is re-embedded. Re-indexing is resumable across Gateway restarts via `NOT EXISTS` detection. Added `MINIMUM_MODEL_VERSION` export to `embedding/model.ts` — if the on-disk model predates this version it triggers automatic backfill without user intervention.

### 2.2 Watcher Evaluation Performance
- **Observation:** Watchers are evaluated after every sync cycle tick with a 500ms timeout per condition.
- **Improvement:** For "schedule" (cron) watchers, ensure the evaluation only runs when the cron expression matches the current tick, rather than checking the expression against the clock on every single sync cycle completion.

> **✅ Done:** `WatcherEngine.evaluate()` now gates `schedule` watchers with an O(1) `isCronDue(expression, lastCheckedAt, now)` check before any DB query. Watchers whose cron has not elapsed are skipped without touching the database.

### 2.3 IaC Drift Detection Edge Case
- **Question:** If the AWS connector is disabled but the IaC connector is enabled, how is drift detected? 
- **Suggestion:** The IaC sync handler should verify that the corresponding cloud connector is configured and active before attempting a drift check, or it should perform a one-off "lazy" fetch of the resource state if the connector is available but not syncing.

> **✅ Done:** Drift detection now has three explicit states: (1) connector active and recently synced → compare against indexed items, no extra network call; (2) connector configured but stale → trigger a one-off lazy fetch of the relevant resource types; (3) connector not configured → skip drift, show `⚠ Drift detection unavailable — AWS connector not configured` in `nimbus status --drift`.

---

## 3. Remaining Open Questions

1. **Model Updates:** If the project upgrades the default local model (e.g., to a more efficient v3), does the system automatically re-index? We should define a `MINIMUM_MODEL_VERSION` or similar logic in `embedding/model.ts`.
2. **Session Memory Cleanup:** The plan mentions a 24-hour TTL for session memory. Does the Gateway perform proactive cleanup (a cron job), or is it checked only when a new session starts? A long-running Gateway might accumulate memory rows if no new sessions are initiated.
3. **Registry Discovery:** The manifest mentions `registry.nimbus.dev`. Is this a centralized index or a federated one? We should clarify if `nimbus extension install` supports direct URLs (e.g., GitHub releases) for private extensions.
4. **Offline Bundling:** The plan mentions bundling model files in the headless installer. We should ensure the `scripts/package-headless-bundle.ts` is updated to include these ~22MB of binary assets.

> **✅ All addressed:**
> 1. **Model Updates:** `MINIMUM_MODEL_VERSION` added to `embedding/model.ts`. If the on-disk model predates this version (checked via `config.json` metadata), the worker automatically re-triggers `backfillAll()`. Covered by the provider-switching logic in §1.1.
> 2. **Session Memory Cleanup:** Proactive hourly background job in the Gateway runs `pruneOlderThan` for every known `session_id`. Does not require a new session to trigger cleanup. Added to §1.3. `nimbus session list` shows active sessions and last-write timestamps.
> 3. **Registry Discovery:** `nimbus extension install` now documents three source formats: npm package name, direct URL (tarball from GitHub Releases or any HTTPS URL), and local path. Direct-URL installs are content-addressed by tarball SHA-256. Private registries are handled via `.npmrc` for npm-format packages.
> 4. **Offline Bundling:** `scripts/package-headless-bundle.ts` is explicitly called out as a build prerequisite in §1.1 and added as an acceptance criterion: a freshly-installed headless bundle must be able to embed a document without network access.

---

## 4. Final Recommendation

The plan is now highly robust and addresses the primary performance and security concerns. **Recommended for implementation.** The next step should be the verification of Prerequisite #6 (`sqlite-vec` loading on all CI runners) to unblock Wave 1 development.
