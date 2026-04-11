# Phase 3 Review — Intelligence Plan

**Date:** 2026-04-11  
**Reviewer:** Gemini CLI  
**Subject:** Review of `docs/phase-3-intelligence-plan.md`

This document provides a review of the Phase 3 (Intelligence) implementation plan for Nimbus. The plan is comprehensive, covering semantic search, extension ecosystems, and a wide array of infrastructure connectors.

---

## 1. General Observations & Commendations

- **Local-First Alignment:** The choice of `@xenova/transformers` and `sqlite-vec` perfectly aligns with the project's local-first principle, ensuring that semantic awareness does not come at the cost of privacy or cloud dependency.
- **Structural Integrity:** The use of migration-gated schema updates (Migrations 6–10) provides a clear path for database evolution.
- **User Experience:** The "Session CLI" (persistent interactive state) is a significant step forward in making Nimbus feel like a collaborative partner rather than a one-shot command-line tool.

---

## 2. Architectural Suggestions & Improvements

### 2.1 Embedding Pipeline Performance
- **Issue:** Running `@xenova/transformers` (even a small model like `all-MiniLM-L6-v2`) in the main Gateway process can be CPU/Memory intensive, potentially causing latency in the JSON-RPC response loop during heavy sync or backfill.
- **Suggestion:** Consider spawning the embedding pipeline in a **Worker Thread** or a separate low-priority process. This ensures that the Gateway's core IPC and sync scheduling remain responsive even when the CPU is saturated by vector generation.
- **Improvement:** Add a "pause on battery" or "low power mode" to the embedding pipeline to prevent background embedding from draining resources on mobile/laptop devices (relevant for Phase 4/8).

### 2.2 Semantic Search & RAG
- **Handling Large Items:** The plan mentions a 256-token chunk size. For large documents (e.g., 50-page PDFs or long Confluence pages), this results in many chunks. 
- **Question:** How does the `searchLocalIndex` tool handle results that return multiple chunks from the same document? Does it perform **re-ranking** or **chunk deduplication** before presenting context to the LLM?
- **Improvement:** Implement "Parent Document Retrieval" — when a chunk matches, retrieve the surrounding chunks or the document summary to provide better context to the LLM.

### 2.3 Relationship Graph Cleanup
- **Issue:** While `graph_relation` has `ON DELETE CASCADE` on `graph_entity`, the `graph_entity` table itself does not seem to have a direct link back to the `item` table that would trigger a cleanup when an item is deleted.
- **Suggestion:** Ensure the `graph-populator.ts` includes a cleanup listener that removes `graph_entity` nodes (and their associated edges) when the source `item` or `person` is removed. Otherwise, the graph will accumulate "ghost nodes" over time.

---

## 3. Security & Extension Ecosystem

### 3.1 Sandbox Limitations
- **Issue:** The plan describes the v1 sandbox as process isolation + env restriction but notes it as an "**honour system**" for network permissions.
- **Concern:** If an extension declares no network permissions but performs a `fetch()` anyway, it will currently succeed.
- **Improvement:** Add a mandatory **security disclaimer** in the `nimbus extension install` flow for v1, explicitly stating that network isolation is not yet enforced at the kernel/syscall level.
- **Future-proofing:** Consider using Bun's native `--allow-net` (once stable) or a lightweight WASM runtime (like Extism) for even stricter isolation in Wave 2.

### 3.2 Manifest Hash Integrity
- **Question:** The plan verifies the manifest hash at Gateway startup. Does it also verify the integrity of the **entry point script** (e.g., `./dist/server.js`)? 
- **Suggestion:** Store a recursive hash of the entire extension directory or at least the entry point file to prevent an attacker from modifying the code while keeping the manifest intact.

---

## 4. Wave 3 (Connectors) Scope Management

- **Observation:** Wave 3 is extremely ambitious (14+ major connectors). Shipping all of these in a single wave risks "breadth without depth."
- **Suggestion:** Split Wave 3 into prioritized sub-waves:
    1. **Wave 3a (CI/CD Foundation):** Jenkins, GitHub Actions, GitLab CI.
    2. **Wave 3b (Infrastructure):** AWS, Kubernetes, IaC.
    3. **Wave 3c (Observability):** PagerDuty, Datadog, Sentry.
- This allows for better testing of the `graph_relation` patterns specific to each domain (e.g., CI/CD links vs. Observability correlations).

---

## 5. Workflow & Watcher Logic

### 5.1 Circular Trigger Protection
- **Question:** How does the `WatcherEngine` prevent infinite loops? (e.g., Watcher A fires on `pr_merged`, runs a Workflow that triggers an event which causes another `pr_merged` state).
- **Improvement:** Add a **depth limit** or a **cooldown period** per watcher to prevent runaway automation.

### 5.2 Workflow Dry-Run Clarity
- **Improvement:** When `nimbus run --dry-run` identifies a HITL step, it should provide the specific reason: "Step 3 calls `iac.terraform.apply` which is a restricted tool call." This helps users understand the security boundaries being crossed.

---

## 6. Open Questions for the Core Team

1. **Storage Growth:** Has any projection been made for the SQLite file size growth once embeddings (Migration 6) are active? 384-dim vectors for 50k items can add significant MBs.
2. **Cold Start Embeddings:** If a user disables `local` embeddings and switches to `openai`, does the system re-embed the entire index? 
3. **Session Privacy:** Is session memory stored in plaintext in SQLite? If so, should we consider encrypting the `session_memory` table with a session-specific key or a user-provided vault key?
4. **Offline Capability:** Does the local embedding pipeline require a one-time internet connection to download the model, or is there a plan to bundle the model with the headless installer?

---

## 7. Deferred Decisions Revisited

- **Multi-model embedding:** While deferred to Phase 5, the current schema (Migration 6) hardcodes `float[384]`. If we want to support 1536-dim (OpenAI) or 768-dim (other local models) later, we may need a more flexible schema or multiple vector tables.
- **Suggestion:** Consider naming the table `vec_items_384` to allow for future side-by-side model migrations without breaking the existing index.
