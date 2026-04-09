# Review: Q2 2026 Implementation Plan — The Bridge

This document captures open questions, suggestions, and potential improvements for the Q2 2026 Implementation Plan.

Legend: ✅ Resolved in plan | ⏭ Deferred (see Deferred Decisions section) | 🔲 Open

---

## Open Questions

### 1. Credential & Secret Management

- ✅ **Initial Setup:** The plan mentions "Export credentials via `process.env` only (injected by Gateway `registry.ts`)". How are the initial Client IDs and Secrets for OAuth-based services (Google, Microsoft, Slack, Notion) provided? Are these hardcoded in the app, or must the user provide their own developer credentials for each service?
  > **Resolution (§1.0):** Nimbus ships with bundled default OAuth client IDs registered as public/desktop PKCE clients (no secret). Users may override per-provider in `nimbus.toml` under `[auth.<provider>]`. Documented with rationale (AGPL desktop app precedent, no secret required for PKCE).

- ✅ **Vault Migration:** How does `NimbusVault` handle the transition if a user moves their local index to a new machine? Are the credentials tied to the hardware (DPAPI/Keychain) in a way that requires re-authentication?
  > **Resolution (§1.0 + Deferred Decisions):** Yes — DPAPI/Keychain tokens are machine-scoped. Moving machines requires re-authentication. This is documented in the `nimbus connector auth` help text. Full credential portability is handled by Q4's `nimbus data import` flow (which re-triggers PKCE on the new machine). Explicitly listed in the Deferred Decisions table.

### 2. Synchronization & Performance

- ✅ **Resource Constraints:** On a typical local machine, running 13+ simultaneous MCP servers and background syncs could be resource-intensive. Is there a global "concurrency limit" for the `SyncScheduler` to prevent CPU spikes?
  > **Resolution (§1.2 + §1.5):** `SyncScheduler` now has a `maxConcurrentSyncs` config (default: 3) backed by a semaphore. Lazy connector startup (§1.5) means MCP server processes only run when needed, capping total live processes to `maxConcurrentSyncs + active_tool_calls`.

- ✅ **Sync Priority:** Can users prioritize specific connectors (e.g., "Sync Slack every 5 minutes, but Google Drive only once a day")?
  > **Resolution (§1.2 + §1.6):** `SyncScheduler.setInterval()` persists per-connector intervals to `sync_state`. Users configure via `nimbus connector set-interval <service> <duration>` or `[sync.intervals]` in `nimbus.toml`. Example config added to the spec.

- ✅ **Large Files:** For Google Drive and OneDrive, will the FTS5 index include the *content* of documents (PDFs, Word, etc.) or just the metadata? If content is indexed, how is the "body_preview" limit of 512 characters reconciled with deep search?
  > **Resolution (§Architecture Changes, Deferred Decisions):** Q2 indexes title + 512-char `body_preview` only. Full document content extraction is explicitly deferred to Q3 (embedding pipeline). This limitation is documented in the schema section and the Deferred Decisions table.

### 3. People Graph & Identity

- ✅ **Conflicting Emails:** The linker algorithm relies heavily on `canonical_email`. How does it handle a situation where a person uses different emails across services (e.g., personal email for GitHub, work email for Slack) but they are the same individual? Is there a manual "Link Person" tool?
  > **Resolution (§6.1):** Split-email persons create separate unlinked `person` records (`linked = false`). The linker never merges on name alone. `nimbus people list --unlinked` surfaces candidates; `nimbus people link <id-a> <id-b>` performs the manual merge. `mergePeople` updates all `item.author_id` FKs atomically.

- ✅ **Privacy:** Since the People Graph aggregates data across all services, are there specific privacy controls for the "People" view?
  > **Resolution (§6.1):** People graph is local-only, never synced externally. `nimbus connector remove` prunes person records whose only items came from that service. Only persons who directly appear as author/reviewer/assignee/sender/recipient are indexed — passive workspace members are not.

### 4. Network & Connectivity

- ✅ **Offline Mode:** How does the `SyncScheduler` behave during prolonged offline periods? Will it "queue up" syncs and cause a burst of activity when the connection returns?
  > **Resolution (§1.2):** `catchUpOnRestart` defaults to `false` — missed syncs are skipped and the interval clock resets from restart time. Users may set `catchUpOnRestart = true` in config for a single immediate catch-up sync per connector on startup (not a full backlog replay).

- ✅ **PKCE Redirects:** The random ephemeral port for PKCE is standard, but some corporate environments or local firewalls block random ports. Should there be a fallback to a fixed port range?
  > **Resolution (§1.1):** `PKCEOptions` now has a `portRange?: [number, number]` field. Port selection order: explicit `--port` → configured `portRange` → OS-assigned random. Configurable in `nimbus.toml` under `[auth]`. Documented in `nimbus connector auth` help.

---

## Suggestions & Improvements

### 1. Search & Ranking

- ✅ **Ranking Algorithm:** The plan mentions "ranked results". It would be beneficial to define the ranking strategy. Should it favor recency, frequency of access, or specific services?
  > **Resolution (§7.0):** Explicit weighted formula defined: `0.5 × BM25 + 0.3 × recency_score + 0.2 × service_priority_score`. Service weights are user-configurable in `nimbus.toml`. Tie-breaking by `modified_at DESC`.

- ✅ **Cross-Service Collisions:** If the same file is shared via Slack and stored in OneDrive, the local index will have two entries. Consider an "Item Deduplication" logic to link these together in the search results.
  > **Resolution (§Architecture Changes + §7.0):** Added `canonical_url TEXT` column to the `item` table. `upsertItem` checks for matching `canonical_url` before inserting. `searchItems` groups results by `canonical_url` and returns only the highest-scoring item per URL, with a `duplicates` field listing suppressed service IDs.

### 2. Observability & Health

- ✅ **Sync Dashboard:** Add a requirement for a "Sync Health" view in the UI/CLI that shows real-time progress, rate-limit status, and last success/failure for every connector.
  > **Resolution (§7.3):** `nimbus connector list` renders a structured health table (service, status, last sync, next sync, item count, error). `SyncStatus` interface specified with all required fields. `nimbus connector status <service>` adds verbose view with cursor, rate-limit remaining, consecutive failure count.

- ✅ **Audit Logging:** The plan mentions an audit log for `nimbus connector remove`. This should be extended to all write operations and HITL approvals.
  > **Resolution (§7.4):** Audit log scope expanded to: HITL approved/rejected, connector auth completed (scopes granted, no token), connector removed, sync completed/errored, people merge. All entries in `audit.jsonl`; no credential values in any field. CI check added to security hardening list.

### 3. Architecture & Extensibility

- ✅ **Lazy Loading:** For the `MCPClient` performance risk, implement "Lazy Connector Startup" by default. The MCP server process should only spawn when a sync is scheduled or a tool is called, and shut down after a period of inactivity.
  > **Resolution (§1.5):** Full lazy connector startup spec added as Phase 1 deliverable. Connectors start on first tool call or sync tick; shut down after `inactivityTimeoutMs` (default: 5 min) with no activity. Scheduler calls `registry.ensureRunning()` before dispatching; concurrency semaphore prevents premature shutdown mid-sync.

- ✅ **Schema Migrations:** Define a formal migration runner within the Gateway to handle the transition from v1 to v2 (and future versions) safely.
  > **Resolution (§1.4):** Formal migration runner added as Phase 1 deliverable. Migrations are numbered, append-only, run in a single SQLite transaction each, and tracked in a `_migrations` table. Gateway runs `runMigrations()` on startup before any connector starts.

### 4. Security

- ⏭ **DB Encryption:** Since the SQLite DB stores `body_preview` (which may contain sensitive snippets) and metadata, consider if the DB itself should be encrypted at rest using a key stored in the `NimbusVault`.
  > **Deferred (see Deferred Decisions):** SQLCipher would require native platform binaries incompatible with the pure-JS Bun build. OS-level filesystem encryption (BitLocker/FileVault/LUKS) covers the threat model. Revisit post-Q2 if a security audit identifies a gap.

- ✅ **Token Scope Minimization:** For Google and Microsoft, ensure the plan explicitly requests the *minimum* possible scopes. For example, do we really need `Mail.Read` for Outlook if the user only wants to index Calendar? The `nimbus connector auth` command should ideally support optional scope flags.
  > **Resolution (§1.1 + §2.5):** `nimbus connector auth` gains a `--scopes` flag. Connectors validate granted scopes at runtime and **disable** tools for which scopes are missing (no fatal error). Outlook spec now lists both full scope set and minimum viable scope (`Calendars.Read` only). Security hardening checklist includes a minimum-scope test.

---

## New Suggestions (Post-Update)

### 1. Data Retention & Disk Management
- ✅ **The Problem:** A unified index of 13+ services (including Slack and Gmail) will grow indefinitely. SQLite performance and disk space will eventually degrade.
- **Suggestion:** Implement a global `retention_days` setting (default: 90 days) in `nimbus.toml`. The `SyncScheduler` should run a "Prune" job weekly to delete items from the `item` table older than the retention limit, except for specific types (e.g., `file` or items manually "pinned" by the user).
  > **Resolution (§1.2):** `SyncSchedulerConfig.retentionDays` added (default: 90). `pinned INTEGER` column added to the `item` schema — connectors set it for starred/saved items; all `type = "file"` items are also exempt. Per-connector depth overrideable in `[sync.initial_depth_days]` in `nimbus.toml`. Configurable as `retention_days = 0` to keep forever.

### 2. LLM Context Window Management
- ✅ **The Problem:** If `nimbus ask` finds 200 "relevant" items for a query, sending all of them to the LLM will hit token limits or cause high latency.
- **Suggestion:** Implement a "Context Ranker" in the Gateway. Before sending results to the LLM, the engine should take the top-N (e.g., top 20) ranked results from the local index and provide a "Source Summary" for the rest, allowing the LLM to request more details on specific items if needed.
  > **Resolution (§7.0):** `ContextRanker` added as an engine-layer deliverable. Selects top-N items (default: 20, configurable via `engine.context_window_items`), collapses the remainder into a `SourceGroup[]` summary appended to the LLM prompt. A `fetchMoreResults` tool lets the LLM page in additional results on demand.

### 3. "Generic" MCP Connector Support
- ⏭ **The Problem:** The plan focuses on 13 first-party connectors. Users will want to add their own custom MCP servers (e.g., a local DB, a niche API).
- **Suggestion:** Add a `nimbus connector add --mcp "<command>"` command. This allows users to register any compliant MCP server by providing its startup command. This makes Nimbus a generic MCP host, not just a walled garden of 13 connectors.
  > **Deferred to Q3 (see Deferred Decisions):** The Q3 Extension Registry v1 is the correct home — it adds manifest hash verification, sandboxed processes, and scoped credential injection. Shipping a simpler version in Q2 would create a parallel unsafe code path to migrate in Q3.

### 4. Initial Sync "Depth"
- ✅ **The Problem:** Syncing a 10-year-old Gmail account or a Slack workspace with millions of messages on the first run will trigger aggressive rate limiting and take days.
- **Suggestion:** Add a `sync_depth_days` parameter to the `Syncable` interface. For the first sync, connectors should only fetch items from the last N days (default: 30). Users can then run `nimbus connector sync --full` if they explicitly want the entire history.
  > **Resolution (§1.2):** `Syncable.initialSyncDepthDays` added (default: 30). On first sync (cursor = null), connectors limit history to this window. `nimbus connector sync --full <service>` clears the cursor and runs an unlimited background sync. Per-connector overrides configurable in `nimbus.toml` under `[sync.initial_depth_days]`.

### 5. Natural Language People Mapping
- ✅ **The Problem:** If a user asks "Show me PRs from Sarah", the agent needs to know which `person.id` Sarah maps to.
- **Suggestion:** Add a `people-resolver` tool to the Gateway's core toolset. When the LLM detects a person's name, it calls this tool first to get the canonical `person.id` (using the People Graph's `people.search` IPC method) before querying the `item` table.
  > **Resolution (§7.0):** `resolvePerson` tool added to the Gateway's core agent toolset alongside `searchLocalIndex`. Returns up to 3 candidate `person` objects (id, display_name, known handles); LLM selects the best match or asks for clarification on ambiguity.

---

## Final Hardening Suggestions

### 1. Provider-Level Rate Limiting
- ✅ **The Problem:** Multiple connectors sharing the same provider (e.g., Google Drive, Gmail, Photos) could collectively trigger a 429 "Too Many Requests" if they sync at the same time, even if each connector is individually "polite".
- **Suggestion:** Implement a `ProviderRateLimiter` in Phase 1. Connectors shouldn't just back off locally; they should request a "permit" from the Gateway before making a batch of network calls to a specific provider.
  > **Resolution (§1.2):** `ProviderRateLimiter` added as a Phase 1 deliverable. Token-bucket per provider with conservative defaults (e.g., Google: 600 req/min burst 20, Slack: 20 req/min). Injected into `SyncContext` so connectors call `ctx.rateLimiter.acquire(provider)` per request batch and `ctx.rateLimiter.penalise(provider, retryAfterMs)` on 429. Overrideable per-provider in `nimbus.toml` under `[sync.quotas]`. Coverage gate ≥85%.

### 2. Immediate Catch-up for `hasMore`
- ✅ **The Problem:** The `Syncable.sync` method returns a `SyncResult` with `hasMore: boolean`. If a connector fetches 100 items but has 5,000 more pending, waiting for the next full sync interval (e.g., 30 minutes) to get the next 100 is too slow.
- **Suggestion:** The `SyncScheduler` should be updated to immediately re-queue a connector for execution (bypassing the interval timer but respecting the concurrency semaphore) whenever a sync returns `hasMore: true`.
  > **Resolution (§1.3):** `hasMore = true` triggers an immediate re-queue without interval delay, while still respecting the `maxConcurrentSyncs` semaphore. `had_more` recorded in `sync_telemetry`. Verified in `scheduler.test.ts`.

### 3. Local Sync Telemetry
- ✅ **The Problem:** It's currently difficult to diagnose which connector is "heavy" on the CPU or network without looking at OS-level process monitors.
- **Suggestion:** Add a `sync_telemetry` table to track `(service, started_at, duration_ms, items_upserted, items_deleted, bytes_transferred)`. Expose this via `nimbus connector status <service> --stats` to help users identify and tune slow connectors.
  > **Resolution (§Schema + §7.5):** `sync_telemetry` table added to schema migration v2: `(id, service, started_at, duration_ms, items_upserted, items_deleted, bytes_transferred, had_more, error_msg)`. `SyncResult` extended with `durationMs` and optional `bytesTransferred`. `nimbus connector status <service> --stats` renders a 30-day rolling summary (avg/P95 duration, totals, hasMore count, error count). Telemetry rows pruned by the weekly retention job after 90 days.
