# Phase 3 Implementation Plan — Intelligence

**Phase:** 3  
**Theme:** Intelligence  
**Goal:** Make Nimbus semantically aware and proactively useful. Extend the index into CI/CD, cloud infrastructure, and observability. Ship the Extension Registry so the community can build what the core team cannot.  
**Depends on:** Phase 2 complete (unified `item`/`person` schema v5, lazy connector mesh, `nimbus connector` CLI, people graph)

---

## Implementation Status (living)

*Updated as deliverables land on `main`. Last reviewed: **2026-04-11**.*

| Deliverable | Status | Location / notes |
|---|---|---|
| sqlite-vec integration + schema migration (v6) | Planned | |
| Embedding pipeline — chunk + embed at sync time | Planned | |
| Hybrid search (BM25 + vector, RRF fusion) | Planned | |
| RAG conversational memory | Planned | |
| Local relationship graph (entity/relation tables, schema v7) | Planned | |
| Extension Registry v1 — `@nimbus-dev/sdk` public API stable | Planned | |
| Extension manifest schema v1 (`nimbus.extension.json`) | Planned | |
| Extension manifest hash verification on Gateway startup | Planned | |
| Extension sandbox (scoped child process, env injection) | Planned | |
| `nimbus scaffold extension` CLI command | Planned | |
| `nimbus extension install/list/enable/disable/remove` | Planned | |
| `nimbus connector add --mcp "<cmd>"` (generic user MCP) | Planned | |
| Jenkins MCP connector + sync | Planned | |
| GitHub Actions MCP connector + sync | Planned | |
| CircleCI MCP connector + sync | Planned | |
| GitLab CI MCP connector + sync (extends GitLab connector) | Planned | |
| AWS MCP connector + sync | Planned | |
| Azure MCP connector + sync | Planned | |
| GCP MCP connector + sync | Planned | |
| IaC awareness — Terraform, CloudFormation, Pulumi index | Planned | |
| IaC write ops — `plan` → HITL → `apply` | Planned | |
| Kubernetes MCP connector + sync | Planned | |
| Datadog MCP connector + sync | Planned | |
| Grafana MCP connector + sync | Planned | |
| Sentry MCP connector + sync | Planned | |
| PagerDuty MCP connector + sync | Planned | |
| New Relic MCP connector + sync | Planned | |
| Workflow pipeline engine + `nimbus workflow` CLI | Planned | |
| Watcher system + `nimbus watch` CLI | Planned | |
| Proactive anomaly detection (baseline + alerting) | Planned | |
| Filesystem connector v2 (git-aware, semantic code search, dependency graph) | Planned | |
| Session CLI (`nimbus` with no args) | Planned | |
| Script files (`nimbus run <path>`) | Planned | |
| DevOps agent (domain-tuned, scoped tool set) | Planned | |
| Research agent (document synthesis, long-context RAG) | Planned | |
| Coverage gates — embedding ≥80%, watcher ≥80%, workflow ≥80% | Planned | |

---

## Table of Contents

1. [Prerequisites & Entry Criteria](#prerequisites--entry-criteria)
2. [Architecture Changes](#architecture-changes)
3. [Wave 1 — Semantic Foundation](#wave-1--semantic-foundation)
4. [Wave 2 — Extension Ecosystem](#wave-2--extension-ecosystem)
5. [Wave 3 — CI/CD & Infrastructure Connectors](#wave-3--cicd--infrastructure-connectors)
6. [Wave 4 — Workflow Automation & Knowledge Graph](#wave-4--workflow-automation--knowledge-graph)
7. [Wave 5 — Interaction Layer & Agent Specialization](#wave-5--interaction-layer--agent-specialization)
8. [HITL Extensions for Phase 3 Actions](#hitl-extensions-for-phase-3-actions)
9. [Acceptance Criteria Checklist](#acceptance-criteria-checklist)
10. [Risk Register](#risk-register)
11. [Deferred Decisions](#deferred-decisions)

---

## Prerequisites & Entry Criteria

All items below must be verified before Phase 3 development begins. Resolve any failures before advancing.

| # | Prerequisite | Verification |
|---|---|---|
| 1 | Phase 2 unified `item` schema at `user_version = 5`; migration runner operational | `PRAGMA user_version` returns `5` on a fresh Gateway start |
| 2 | `NimbusVault` coverage ≥90% | `bun run test:coverage:vault` |
| 3 | Engine coverage ≥85%, Sync scheduler ≥80% | `bun run test:coverage:engine`, `bun run test:coverage:scheduler` |
| 4 | Lazy connector mesh operational; all Phase 2 connectors start on demand | `nimbus connector list` shows ≥14 connectors with no startup errors |
| 5 | People linker populates `person.github_login`, `slack_handle`, `linear_member_id` | `identity-resolution.e2e.test.ts` green |
| 6 | `bun:sqlite` + WAL mode confirmed; `sqlite-vec` loadable via Bun FFI or `bun:sqlite` extension path | `import { Database } from "bun:sqlite"` + `db.loadExtension("vec0")` succeeds on all three CI runners |

---

## Architecture Changes

### New Packages

```
packages/
  mcp-connectors/
    jenkins/          # Phase 3 Wave 3
    github-actions/
    circleci/
    aws/
    azure/
    gcp/
    iac/              # Terraform / CloudFormation / Pulumi (local file reader, not a network MCP server)
    kubernetes/
    datadog/
    grafana/
    sentry/
    pagerduty/
    new-relic/
    filesystem-v2/    # Git-aware upgrade of the Phase 1 filesystem connector
```

> GitLab CI is delivered as an update to `packages/mcp-connectors/gitlab/` (adds pipeline/job tools and sync), not a new package.

### New Gateway Modules

```
packages/gateway/src/
  embedding/
    pipeline.ts          # §1.1 — chunk → embed → upsert vec_items
    chunker.ts           # §1.1 — text chunking (fixed-size + sentence-boundary)
    model.ts             # §1.1 — local @xenova/transformers model loader
    openai-embedder.ts   # §1.1 — OpenAI opt-in embedder (same interface)
  search/
    hybrid.ts            # §1.2 — RRF fusion of BM25 ranks + vector cosine scores
    vec-store.ts         # §1.2 — sqlite-vec query helpers
  memory/
    session-store.ts     # §1.3 — RAG session chunks; insert/search/prune
    session-manager.ts   # §1.3 — per-session lifecycle
  graph/
    relationship-graph.ts  # §1.4 — entity/relation CRUD + traversal helpers
    graph-populator.ts     # §1.4 — sync hooks that populate graph from item upserts
  extensions/
    registry.ts          # §2.1 — install, load, verify, sandbox, enable/disable
    manifest.ts          # §2.1 — parse + validate nimbus.extension.json
    scaffold.ts          # §2.1 — nimbus scaffold extension code generator
    hash-verifier.ts     # §2.2 — SHA-256 manifest hash check on Gateway startup
    sandbox.ts           # §2.3 — child process spawn with scoped env injection
  automation/
    workflow-engine.ts   # §4.1 — YAML pipeline execution (shared with script files)
    workflow-store.ts    # §4.1 — saved pipelines, run history, step results
    watcher-engine.ts    # §4.2 — condition evaluation loop over sync cycles
    watcher-store.ts     # §4.2 — watcher definitions, history, baseline snapshots
    anomaly-detector.ts  # §4.3 — baseline tracking + deviation scoring
  session/
    session-cli.ts       # §5.1 — persistent interactive session state
    script-runner.ts     # §5.2 — nimbus run <path> execution
  agents/
    devops-agent.ts      # §5.3 — domain-tuned agent definition
    research-agent.ts    # §5.4 — research agent definition
```

### SQLite Schema Additions (Migrations 6–10)

Phase 2 left the DB at `user_version = 5`. Phase 3 adds the following migrations via the existing `runIndexedSchemaMigrations` runner. Each migration runs in a single transaction and is idempotent.

**Migration 6 — Embedding store**

```sql
-- Vector embedding per item chunk (requires sqlite-vec extension loaded).
-- Table name is dimension-qualified (vec_items_384) so a future multi-model migration
-- can add vec_items_1536 side-by-side without schema breakage.
CREATE VIRTUAL TABLE IF NOT EXISTS vec_items_384
  USING vec0(embedding float[384]);  -- 384 dims for all-MiniLM-L6-v2

-- Metadata for each embedded chunk (1 item may produce N chunks)
CREATE TABLE IF NOT EXISTS embedding_chunk (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL,     -- 0-based position within the item
  chunk_text   TEXT NOT NULL,        -- the actual text that was embedded
  vec_rowid    INTEGER NOT NULL,     -- rowid in vec_items_384 (or the appropriate dim table)
  model        TEXT NOT NULL,        -- e.g. "all-MiniLM-L6-v2" or "text-embedding-3-small"
  dims         INTEGER NOT NULL,     -- vector dimension (384, 1536, etc.)
  embedded_at  INTEGER NOT NULL,     -- Unix ms
  UNIQUE(item_id, chunk_index)
);
```

> **Storage estimate:** At 384 dims × 4 bytes/float per vector, each chunk row costs ~1.5 KB in `vec_items_384` plus ~0.5 KB overhead in `embedding_chunk`. For 50,000 items averaging 2 chunks each, expect ~150 MB of additional SQLite storage for embeddings. Users with large indices (>200k items) should be informed of this during the backfill progress display.

**Migration 7 — Relationship graph**

```sql
CREATE TABLE IF NOT EXISTS graph_entity (
  id          TEXT PRIMARY KEY,   -- deterministic UUID v5 from (type, external_id)
  type        TEXT NOT NULL,      -- "person" | "project" | "document" | "incident" | "pr" | "deployment" | "repo"
  external_id TEXT NOT NULL,      -- e.g. item.id or person.id
  label       TEXT NOT NULL,      -- human-readable display name
  service     TEXT,               -- originating service (null for cross-service entities)
  metadata    TEXT,               -- JSON blob
  UNIQUE(type, external_id)
);

CREATE TABLE IF NOT EXISTS graph_relation_type (
  name        TEXT PRIMARY KEY,   -- e.g. "authored", "reviewed", "triggered", "resolves", "mentions"
  directed    INTEGER NOT NULL DEFAULT 1  -- 1 = (from → to) has semantics; 0 = symmetric
);

CREATE TABLE IF NOT EXISTS graph_relation (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id     TEXT NOT NULL REFERENCES graph_entity(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES graph_entity(id) ON DELETE CASCADE,
  type        TEXT NOT NULL REFERENCES graph_relation_type(name),
  weight      REAL NOT NULL DEFAULT 1.0,
  metadata    TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE(from_id, to_id, type)
);
```

**Migration 8 — Watcher system**

```sql
CREATE TABLE IF NOT EXISTS watcher (
  id              TEXT PRIMARY KEY,     -- UUID
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  condition_type  TEXT NOT NULL,        -- see WatcherConditionType enum
  condition_json  TEXT NOT NULL,        -- serialised WatcherCondition
  action_type     TEXT NOT NULL,        -- "notify" | "run_workflow" | "ask_agent"
  action_json     TEXT NOT NULL,        -- serialised WatcherAction
  created_at      INTEGER NOT NULL,
  last_checked_at INTEGER,
  last_fired_at   INTEGER
);

CREATE TABLE IF NOT EXISTS watcher_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  watcher_id  TEXT NOT NULL REFERENCES watcher(id) ON DELETE CASCADE,
  fired_at    INTEGER NOT NULL,
  condition_snapshot TEXT NOT NULL,     -- JSON: what matched
  action_result      TEXT              -- JSON: outcome of the action (null if async)
);
```

**Migration 9 — Workflow system**

```sql
CREATE TABLE IF NOT EXISTS workflow (
  id          TEXT PRIMARY KEY,     -- UUID
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  steps_json  TEXT NOT NULL,        -- serialised WorkflowStep[]
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_run (
  id          TEXT PRIMARY KEY,     -- UUID
  workflow_id TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  triggered_by TEXT NOT NULL,       -- "cli" | "watcher:<watcher_id>" | "api"
  status      TEXT NOT NULL,        -- "pending" | "running" | "done" | "error" | "aborted"
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  error_msg   TEXT
);

CREATE TABLE IF NOT EXISTS workflow_run_step (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  step_index  INTEGER NOT NULL,
  label       TEXT,
  status      TEXT NOT NULL,        -- "pending" | "running" | "done" | "hitl_pending" | "error" | "skipped"
  hitl_action TEXT,                 -- JSON: proposed action shown to user at HITL
  hitl_approved INTEGER,            -- 1 = approved, 0 = rejected, NULL = pending
  result_json TEXT,
  started_at  INTEGER,
  finished_at INTEGER
);
```

**Migration 10 — Extension registry + session memory**

```sql
CREATE TABLE IF NOT EXISTS extension (
  id              TEXT PRIMARY KEY,   -- npm package name e.g. "@community/nimbus-notion"
  version         TEXT NOT NULL,
  install_path    TEXT NOT NULL,      -- absolute path on disk
  manifest_hash   TEXT NOT NULL,      -- SHA-256 of nimbus.extension.json at install time
  entry_hash      TEXT NOT NULL,      -- SHA-256 of the compiled entry point (e.g. dist/server.js)
  enabled         INTEGER NOT NULL DEFAULT 1,
  installed_at    INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_memory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,        -- UUID; one per `nimbus` interactive session or `nimbus run`
  chunk_text    TEXT NOT NULL,
  vec_rowid     INTEGER NOT NULL,     -- rowid in vec_items (same pool, different model tag)
  role          TEXT NOT NULL,        -- "user" | "assistant" | "tool"
  created_at    INTEGER NOT NULL
);
```

---

## Wave 1 — Semantic Foundation

**Gate:** Nothing in Wave 2 or later requires Wave 1 to be complete, except: the embedding pipeline must be tested before shipping to users (risk of silent degradation). Wave 3 connectors may merge independently. Wave 4 watcher `anomaly_detector` requires the embedding pipeline for baseline encoding.

### 1.1 Embedding Pipeline

**Why:** Phase 2 FTS5 search covers title + 512-char preview only. Users need semantic recall — "show me emails about the Zurich project" should work even when the word "Zurich" isn't in the subject.

**Architecture:**

```typescript
// packages/gateway/src/embedding/pipeline.ts

export interface Chunk {
  itemId: string;         // FK → item.id
  chunkIndex: number;     // 0-based
  text: string;           // the text that was embedded
}

export interface EmbeddingPipeline {
  /** Called by sync handlers after upsertIndexedItem. */
  embedItem(item: IndexedItem): Promise<void>;
  /** Called by connector remove to clean up orphaned chunks. */
  deleteItemEmbeddings(itemId: string): Promise<void>;
  /** Called by the migration runner on first startup to backfill existing items. */
  backfillAll(onProgress?: (done: number, total: number) => void): Promise<void>;
}
```

**Chunking strategy:**

```typescript
// packages/gateway/src/embedding/chunker.ts

export interface ChunkOptions {
  maxChunkTokens: number;   // default: 256 (tokens ≈ chars / 4)
  overlapTokens: number;    // default: 32
}

export function chunkText(text: string, opts?: ChunkOptions): string[];
```

- Input text: `item.title + "\n" + (item.body_preview ?? "")`. Future: full body when document extraction lands.
- Sentence-boundary aware: never splits in the middle of a sentence.
- Items shorter than `maxChunkTokens` produce exactly one chunk.

**Model selection:**

```typescript
// packages/gateway/src/embedding/model.ts

export interface Embedder {
  model: string;            // e.g. "all-MiniLM-L6-v2" or "text-embedding-3-small"
  dims: number;             // output vector dimension
  embed(texts: string[]): Promise<Float32Array[]>;
}

export async function createLocalEmbedder(): Promise<Embedder>;   // @xenova/transformers
export async function createOpenAIEmbedder(apiKey: string): Promise<Embedder>;  // opt-in
```

**Default model:** `all-MiniLM-L6-v2` (384 dims, ~22MB download, runs in-process via `@xenova/transformers`). Model files are cached in `{dataDir}/models/`. OpenAI `text-embedding-3-small` (1536 dims) is selectable via `nimbus.toml` `[embedding] provider = "openai"`.

**Configuration (`nimbus.toml`):**

```toml
[embedding]
enabled = true               # default true; set false to disable entirely
provider = "local"           # "local" | "openai"
model = "all-MiniLM-L6-v2"  # local model name; cached in {dataDir}/models/ after first download
chunk_tokens = 256
chunk_overlap_tokens = 32
backfill_batch_size = 50     # items per batch during backfill (throttled to avoid CPU spike)
pause_on_battery = true      # pause worker thread when running on battery (laptop/mobile)
```

> **Offline / installer bundling:** The `all-MiniLM-L6-v2` model files (~22 MB) are downloaded on first use and cached in `{dataDir}/models/`. The headless installer bundles the model files so no internet connection is required after installation. The `NIMBUS_EMBEDDING_MODEL_DIR` environment variable overrides the cache location (used in CI to point at a pre-downloaded artefact). **`scripts/package-headless-bundle.ts` must be updated** to copy the model directory from `{dataDir}/models/` into the bundle before packaging — this is a build prerequisite tracked as an acceptance criterion.

**Sync integration:** After every `upsertIndexedItem`, the scheduler calls `pipeline.embedItem(item)` asynchronously (non-blocking; errors are logged but do not fail the sync). To avoid CPU contention with the Gateway's IPC and sync scheduling loops, the embedding pipeline runs inside a **Bun Worker thread** (`new Worker("./embedding/worker.ts")`). The main thread sends work items via `postMessage` and receives `{ itemId, vecRowid }` acknowledgements; the worker manages the `@xenova/transformers` pipeline instance and writes directly to the DB.

**Backfill:** On first startup after migration 6, `EmbeddingPipeline.backfillAll()` runs as a background job inside the same worker thread. Progress is visible via `nimbus status` (`embedding_backfill: 12340 / 50000`).

**Provider / model switching:** On startup the Gateway reads the `model` field from `nimbus.toml` and compares it against the `model` column in `embedding_chunk`. Three cases:

| Situation | Action |
|---|---|
| All existing chunks use the current model | No re-index needed — proceed normally. |
| Model changed (e.g. `local` → `openai`, or local model version bump) | Delete all `embedding_chunk` rows where `model ≠ currentModel` (cascading to `vec_items_384`), then re-trigger `backfillAll()`. Progress tracked in `nimbus status`. |
| Switching back to a previously-used model | Check if `embedding_chunk` rows already exist for the target `model`. Items that already have chunks under the target model are skipped during backfill — only the delta is re-embedded. |

A warning is always printed before a re-index begins: `Embedding model changed (old → new) — re-indexing N items in the background.` Re-indexing is resumable: if the Gateway restarts mid-backfill, the worker picks up from the last un-embedded item (identified by `NOT EXISTS` in `embedding_chunk` for the current model).

**Model version upgrades:** `embedding/model.ts` exports a `MINIMUM_MODEL_VERSION` string. If the bundled model on disk predates this version (checked via the model's `config.json` metadata), the worker treats it as a model change and re-triggers backfill automatically. This ensures a project-wide model upgrade is applied without user intervention.

**Tests required:**
- `embedding/pipeline.test.ts` — chunk + embed + vec_items insert; verify `embedding_chunk` FK integrity; delete cascade on `item` delete.
- `embedding/chunker.test.ts` — sentence boundary, overlap, single-chunk short text.
- Coverage gate: ≥80%.

---

### 1.2 Hybrid Search

**Why:** BM25 keyword recall + vector similarity are complementary. Keyword is precise for code symbols and proper names; vector captures semantic variants. RRF (Reciprocal Rank Fusion) merges them without requiring calibrated scores.

```typescript
// packages/gateway/src/search/hybrid.ts

export interface HybridSearchOptions {
  query: string;
  limit: number;
  services?: string[];                   // optional service filter
  since?: number;                        // Unix ms lower bound on modified_at
  semantic?: boolean;                    // default true if embedding pipeline is active
  bm25Weight?: number;                   // default 0.6
  vectorWeight?: number;                 // default 0.4
  rrfK?: number;                         // RRF constant, default 60
}

export interface HybridSearchResult {
  item: IndexedItem;
  bm25Rank: number | null;              // null if not in BM25 results
  vectorRank: number | null;            // null if not in vector results
  rrfScore: number;                     // higher is better
  duplicates?: string[];                // canonical_url siblings suppressed
}

export async function hybridSearch(
  db: Database,
  opts: HybridSearchOptions
): Promise<HybridSearchResult[]>;
```

**RRF formula:** `score(d) = sum(1 / (k + rank(d, list)))` over each result list that contains `d`.

**Chunk deduplication:** A single large item (e.g. a 50-page Confluence doc) may contribute many chunks to the vector results. After RRF scoring, `hybridSearch` deduplicates by `item_id` — only the highest-scoring chunk per item is kept in the result list. For agent context assembly, the two immediately adjacent chunks (index − 1, index + 1) are fetched and appended to the winning chunk's text, providing "parent document retrieval" without loading the full document. This gives the LLM coherent surrounding context without flooding its context window.

**`nimbus search --semantic` flag:** Explicitly enables hybrid mode even if the embedding backfill is still running (partial embedding coverage is acceptable — items not yet embedded fall back to BM25 only).

**Agent tool update:** `searchLocalIndex` tool gains a `semantic: boolean` parameter (default: `true`). The context ranker uses `HybridSearchResult.rrfScore` for its composite score instead of the Phase 2 BM25-only rank. The tool also exposes a `contextChunks: number` parameter (default: `2`) that controls how many adjacent chunks are appended around the best-matching chunk.

---

### 1.3 RAG Conversational Memory

**Why:** Today `nimbus ask` starts cold on every invocation. The session CLI needs cross-turn memory so "now move the ones from last month" is understood without re-specifying the prior search.

```typescript
// packages/gateway/src/memory/session-store.ts

export interface SessionChunk {
  sessionId: string;
  text: string;           // summary or raw turn content
  role: "user" | "assistant" | "tool";
  createdAt: number;
}

export interface SessionMemoryStore {
  append(chunk: SessionChunk): Promise<void>;
  recall(sessionId: string, query: string, topK?: number): Promise<SessionChunk[]>;
  pruneOlderThan(sessionId: string, keepMs: number): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
```

**Recall mechanism:** Embeds the query using the same `Embedder` as the item pipeline → searches `vec_items` filtered to `session_memory` chunks for `sessionId` → returns top-K by cosine similarity.

**Session scoping:** Each `nimbus` interactive session and each `nimbus run` invocation gets a unique `sessionId` (UUID). Session memory is pruned 24 hours after the last write (configurable via `nimbus.toml` `[session] memory_ttl_hours = 24`).

**Proactive cleanup:** Pruning is performed by a Gateway background job (a scheduled task that runs once per hour, not triggered by new sessions). This prevents stale `session_memory` rows from accumulating on long-lived Gateway processes where no new sessions are started. The cleanup job calls `pruneOlderThan(sessionId, ttlMs)` for every `session_id` found in `session_memory`, then removes the corresponding `vec_items_384` rows. `nimbus session list` shows active session IDs and their last-write timestamps.

**Privacy:** Session memory is stored locally only. `nimbus session clear` deletes all session chunks and their `vec_items_384` rows. Session chunks are stored as plaintext in SQLite (no encryption at the SQLite level in Phase 3 — OS filesystem encryption covers the threat model for a locked machine, per the security boundary in `docs/SECURITY.md`). Encrypting `session_memory` rows with a user-derived or Vault-backed key is noted as a Phase 4/5 consideration if user demand or threat-model analysis warrants it.

---

### 1.4 Local Relationship Graph

**Why:** Enables natural language graph traversal — "show me everything connected to the payment-service incident" — without a network call.

**Populator:** `graph-populator.ts` registers as a sync hook that fires after every `upsertIndexedItem`. It creates/updates `graph_entity` nodes and inserts `graph_relation` edges based on the item's `type` and `metadata`:

| Item type | Edges created |
|---|---|
| `pr` | `person –authored→ pr`, `person –reviewed→ pr`, `pr –targets→ repo`, `pr –resolves→ issue` |
| `issue` | `person –opened→ issue`, `person –assigned→ issue`, `issue –belongs_to→ project` |
| `deployment` | `deployment –triggers→ ci_run`, `ci_run –tests→ pr`, `deployment –affects→ service` |
| `alert` | `alert –fires_on→ service`, `alert –correlates_with→ deployment` |
| `message` | `person –posted→ message`, `message –mentions→ entity` (via regex on known entity names) |

**Graph cleanup:** `graph_entity.external_id` references `item.id` or `person.id` by value, not by foreign key (entities span multiple sources). To prevent "ghost nodes" accumulating after item deletion, `graph-populator.ts` registers a `beforeItemDelete` sync hook: when an item is removed from the index, the populator looks up its associated `graph_entity` by `(type, external_id = item.id)` and deletes it. Because `graph_relation` has `ON DELETE CASCADE` on both `from_id` and `to_id`, all edges are removed automatically. The same hook fires for `person` removals.

**Agent tool:** `traverseGraph(entityId: string, relationTypes?: string[], depth?: number)` — returns a subgraph as a structured JSON payload. Added to the core Gateway agent toolset alongside `searchLocalIndex`.

**Natural language gateway:** The intent router detects relational queries ("what's connected to", "what caused", "who is involved in") and calls `traverseGraph` before `searchLocalIndex`.

---

## Wave 2 — Extension Ecosystem

**Gate:** The Extension Registry must be stable and tested before the Phase 3 connector wave ships, since those connectors should be dog-fooded through the extension loading path (even if they're first-party packages installed from the local workspace).

### 2.1 Extension Registry v1

**Why:** The community cannot build connectors without a stable SDK and a verified loading mechanism. Phase 5 depends on this.

**Manifest schema (`nimbus.extension.json`):**

```json
{
  "$schema": "https://nimbus.sh/schemas/extension/v1.json",
  "name": "@community/nimbus-jenkins",
  "version": "1.0.0",
  "description": "Jenkins CI connector for Nimbus",
  "author": "Jane Dev <jane@example.com>",
  "license": "MIT",
  "nimbus": {
    "sdk": "^1.0.0",
    "entry": "./dist/server.js",
    "services": ["jenkins"],
    "permissions": {
      "vault": ["jenkins.url", "jenkins.api_token"],
      "network": ["*.jenkins.internal", "ci.mycompany.com"],
      "hitl": ["jenkins.build.trigger", "jenkins.build.abort"]
    },
    "sync": {
      "defaultIntervalMs": 300000
    }
  }
}
```

**Key manifest fields:**

| Field | Purpose |
|---|---|
| `nimbus.sdk` | semver range; Registry rejects extensions requiring an unsupported SDK version |
| `nimbus.permissions.vault` | exact list of Vault keys the extension is allowed to read; Gateway injects only these |
| `nimbus.permissions.network` | hostname allowlist; Gateway validates (does not enforce at network layer — honour system in v1, syscall filter in v2) |
| `nimbus.permissions.hitl` | action IDs that will be registered in `HITL_REQUIRED`; Gateway merges these in on extension load |

**Install sources:** `nimbus extension install` accepts three source formats:

| Format | Example | Resolution |
|---|---|---|
| npm package name | `nimbus extension install @community/nimbus-jenkins` | Resolved via the npm registry (or a configured private registry via `.npmrc`) |
| Direct URL | `nimbus extension install https://github.com/user/repo/releases/download/v1.0.0/plugin.tgz` | Fetched directly; content-addressed by SHA-256 of the tarball |
| Local path | `nimbus extension install ./my-local-extension` | Used for development; `entry_hash` is recomputed on every Gateway start for local-path extensions |

**Install flow (`nimbus extension install <pkg>`):**

1. Resolve and download the source to a temp dir (npm pack / URL fetch / local copy).
2. Read and validate `nimbus.extension.json`.
3. Compute SHA-256 of the manifest file → store in `extension.manifest_hash`.
4. Resolve the entry point path (`manifest.nimbus.entry`) and compute its SHA-256 → store in `extension.entry_hash`.
5. Move to `{dataDir}/extensions/<name>/`.
6. Print a security notice:
   ```
   ⚠  Security notice: network permissions declared in this extension are enforced on
      a best-effort basis in v1 (process isolation only). Full network sandboxing ships
      in a future release. Only install extensions you trust.
   
   Declared permissions:
     vault:   jenkins.url, jenkins.api_token
     network: *.jenkins.internal
     hitl:    jenkins.build.trigger, jenkins.build.abort
   
   Proceed with installation? [y/n]:
   ```
7. Insert into `extension` table.
8. Gateway restart (or hot reload signal) triggers the hash verifier and loads the extension.

**Hash verifier (`hash-verifier.ts`):** On every Gateway startup, for each row in `extension` where `enabled = 1`, recompute two SHA-256 hashes:
1. The manifest file (`nimbus.extension.json`) — compared against `manifest_hash`.
2. The compiled entry point (resolved from `manifest.nimbus.entry`, e.g. `dist/server.js`) — compared against `entry_hash`.

If either hash diverges: log an `ERROR`-level security warning identifying the extension by name and the file that was tampered, set `enabled = 0`, and skip process spawn. This ensures that modifying the code while leaving the manifest intact is still detected.

**`nimbus scaffold extension` generator:**

```bash
nimbus scaffold extension --name jenkins --output ./nimbus-jenkins
```

Produces a working MCP server skeleton with:
- `nimbus.extension.json` pre-filled
- `src/server.ts` with `MockGateway` import and a sample tool
- `bun test` passing green
- A `README.md` explaining how to iterate and publish

---

### 2.2 Extension Sandbox

**Threat model:** A third-party extension must not be able to read credentials it wasn't granted, connect to the Gateway IPC socket, or enumerate other extensions' data.

**Implementation:**

```typescript
// packages/gateway/src/extensions/sandbox.ts

export interface SandboxOptions {
  extensionId: string;
  entryPath: string;
  vaultKeys: string[];           // from manifest permissions.vault
  additionalEnv?: Record<string, string>;
}

export function spawnSandboxed(opts: SandboxOptions): ChildProcess;
```

**Sandbox contract:**
- Extension process is spawned as a Bun child process (not via `MCPClient` directly, but through a sandboxed wrapper).
- Environment variables injected: only the Vault values for the declared `permissions.vault` keys (resolved via `NimbusVault.get()`). No other env vars from the parent process.
- The Gateway's IPC socket path is **not** in the child's environment. Extensions communicate with the Gateway only through their declared MCP tools (Gateway → extension direction).
- Stdout/stderr are captured; logged under `extension:<name>` in the structured log.
- Process is killed on `inactivityTimeoutMs` (default: 5 min, same as lazy mesh) and on extension disable/remove.

**v1 network isolation caveat:** Network permissions declared in the manifest are validated against the allowlist at install time and shown to the user, but are **not enforced at the OS/syscall level** in v1. An extension that calls `fetch()` to an undeclared host will succeed. Phase 5 will add kernel-level enforcement (seccomp on Linux, Sandbox entitlement on macOS, AppContainer on Windows). An alternative being evaluated for Phase 5 is running extensions as [Extism](https://extism.org/) WASM plugins, which provides strict network and filesystem isolation without platform-specific syscall filters.

**Tests required:**
- `extensions/sandbox.test.ts` — verify injected env contains only declared vault keys; verify IPC socket path not present; verify process kill on timeout; verify that a mock extension attempting to read an undeclared vault key via env receives `undefined`.

---

### 2.3 `@nimbus-dev/sdk` Public API Stabilization

The SDK package (`packages/sdk/`) must reach API stability before community connectors are built against it. All breaking changes after this point require a major version bump.

**Stable surface (v1.0.0):**

```typescript
// packages/sdk/src/index.ts

export { createMCPServer } from "./server.ts";
export { MockGateway } from "./testing/mock-gateway.ts";
export { defineConnector } from "./connector.ts";
export type {
  ConnectorDefinition,
  SyncContext,
  SyncResult,
  Syncable,
  IndexedItem,
  HITLAction,
} from "./types.ts";
```

**`defineConnector`** is the primary entry point for extension authors — it handles tool registration, sync handler wiring, and HITL declaration in one call, abstracting the raw MCP server API.

**`MockGateway`** provides: in-memory `NimbusVault`, in-memory `LocalIndex`, fake `SyncContext` with a controllable clock — sufficient to write unit tests without a running Gateway.

---

## Wave 3 — CI/CD & Infrastructure Connectors

All connectors in this wave follow the same Phase 2 pattern: a workspace package under `packages/mcp-connectors/<name>/`, a sync handler in `packages/gateway/src/connectors/<name>-sync.ts`, and lazy mesh registration in `lazy-mesh.ts`. Connectors that require no user auth beyond an API token are simpler than OAuth connectors.

**Wave 3 is split into three sub-batches to keep CI manageable and allow early user feedback on each domain before the next batch ships.** Each batch requires all three-platform CI checks to be green before the next batch merges.

| Sub-wave | Connectors | Focus |
|---|---|---|
| **3a — CI/CD Foundation** | Jenkins, GitHub Actions, GitLab CI, CircleCI | Core dev loop: build triggers, log tailing, PR ↔ CI cross-links |
| **3b — Infrastructure** | AWS, Azure, GCP, Kubernetes, IaC | Cloud resource awareness and IaC write ops |
| **3c — Observability** | Datadog, Grafana, Sentry, PagerDuty, New Relic | Alert → incident → deployment correlation |

> Filesystem v2 ships alongside Wave 3a (no external auth, lower risk) so the dependency graph is available for cross-linking by the time cloud connectors land.

**Shared `CIContext` type injected into all CI/CD sync handlers:**

```typescript
export interface CIContext {
  repoService: "github" | "gitlab" | "bitbucket";   // cross-link PRs to CI runs
  repoExternalId: string;                             // e.g. "org/repo"
}
```

---

### 3.1 Jenkins

**Vault keys:** `jenkins.url` (base URL), `jenkins.api_token` (Basic auth: `<user>:<token>`)  
**Auth CLI:** `nimbus connector auth jenkins --url <url> --username <user> --token <token>` (env: `NIMBUS_JENKINS_URL`, `NIMBUS_JENKINS_USERNAME`, `NIMBUS_JENKINS_API_TOKEN`)  
**Sync cursor:** `nimbus-jnk1:<jobName>:<lastBuildNumber>` — per-job cursor stored as a JSON map in `sync_state.cursor`  
**Sync strategy:** Fetch all jobs via `/api/json`; for each job, poll builds newer than the cursor; index as `type = "ci_run"`.  
**Item metadata fields:** `{ jobName, buildNumber, result, duration_ms, triggeredByCommit, branchName, artifactUrls }`  
**HITL actions:** `jenkins.build.trigger`, `jenkins.build.abort`  
**MCP tools:** `jenkins_job_list`, `jenkins_job_get`, `jenkins_build_list`, `jenkins_build_get`, `jenkins_build_trigger` (HITL), `jenkins_build_abort` (HITL), `jenkins_build_log_tail`

---

### 3.2 GitHub Actions

**Vault key:** `github.pat` (shared with GitHub connector)  
**Sync cursor:** `nimbus-gha1:<owner>/<repo>:<lastRunId>` — per-repo cursor  
**Sync strategy:** For each repo already in the index from the GitHub connector, fetch `/repos/{owner}/{repo}/actions/runs?created=>cursor`; index as `type = "ci_run"`.  
**Item metadata fields:** `{ workflowName, runId, event, conclusion, headSha, headBranch, durationMs }`  
**HITL actions:** `github_actions.run.trigger`, `github_actions.run.cancel`  
**MCP tools:** `gha_workflow_list`, `gha_run_list`, `gha_run_get`, `gha_run_jobs`, `gha_run_log`, `gha_run_trigger` (HITL), `gha_run_cancel` (HITL)  
**Cross-link:** On index, insert `graph_relation` edges: `ci_run –tests→ pr` (matching `headSha` to PRs in the GitHub connector index).

---

### 3.3 CircleCI

**Vault key:** `circleci.api_token`  
**Auth CLI:** `nimbus connector auth circleci --token <token>` (env: `NIMBUS_CIRCLECI_API_TOKEN`)  
**Sync cursor:** `nimbus-cci1:<project-slug>:<lastPipelineNumber>`  
**Sync strategy:** `/api/v2/pipeline?org-slug=<org>` → for each pipeline, fetch workflows and jobs; index pipeline as `type = "ci_run"`.  
**HITL actions:** `circleci.pipeline.trigger`, `circleci.job.cancel`  
**MCP tools:** `circleci_pipeline_list`, `circleci_pipeline_get`, `circleci_workflow_list`, `circleci_job_list`, `circleci_job_artifacts`, `circleci_pipeline_trigger` (HITL)

---

### 3.4 GitLab CI (extends GitLab connector)

The existing `nimbus-mcp-gitlab` package gains additional tools for pipelines and jobs. The `gitlab-sync.ts` handler is extended to also fetch pipeline events.

**New MCP tools (added to existing package):** `gitlab_pipeline_jobs_get`, `gitlab_job_log_tail`, `gitlab_pipeline_retry` (HITL), `gitlab_pipeline_cancel` (HITL)  
**HITL actions:** `gitlab.pipeline.retry`, `gitlab.pipeline.cancel`

---

### 3.5 AWS

**Vault keys:** `aws.access_key_id`, `aws.secret_access_key`, `aws.region` (or profile-based via `~/.aws/credentials` — Vault stores a reference to the profile name, not the key itself)  
**Auth CLI:** `nimbus connector auth aws [--profile <name>] [--access-key <key> --secret <secret> --region <region>]`  
**Sync strategy:** Multi-service polling — each AWS sub-service is a sub-sync with its own cursor:

| Sub-service | Cursor key | Indexed as |
|---|---|---|
| CloudWatch Logs (log groups) | `nimbus-aws-cw1:` | `type = "log_stream"` |
| CloudWatch Alarms | `nimbus-aws-cwa1:` | `type = "alert"` |
| ECS services | `nimbus-aws-ecs1:` | `type = "service"` |
| Lambda functions | `nimbus-aws-lam1:` | `type = "function"` |
| EC2 instances | `nimbus-aws-ec21:` | `type = "instance"` |
| S3 buckets (metadata only) | `nimbus-aws-s31:` | `type = "storage_bucket"` |
| Cost Explorer (daily by service) | `nimbus-aws-ce1:` | `type = "cost_report"` |

**HITL actions:** `aws.ecs.service.update`, `aws.lambda.invoke`, `aws.ec2.instance.stop`, `aws.ec2.instance.start`  
**MCP tools (subset):** `aws_cloudwatch_logs_tail`, `aws_cloudwatch_alarm_list`, `aws_ecs_service_list`, `aws_ecs_service_describe`, `aws_lambda_list`, `aws_lambda_invoke` (HITL), `aws_ec2_instance_list`, `aws_s3_bucket_list`, `aws_cost_summary`

---

### 3.6 Azure

**Vault keys:** `azure.tenant_id`, `azure.client_id`, `azure.client_secret` (service principal) **or** `azure.oauth` (delegated, PKCE — preferred for personal accounts)  
**Auth CLI:** `nimbus connector auth azure [--tenant <id> --client <id> --secret <secret>]`  
**Sync strategy:** Azure Monitor alerts → `type = "alert"`; App Service deployment slots → `type = "deployment"`; AKS cluster state → `type = "cluster"`  
**HITL actions:** `azure.app_service.restart`, `azure.aks.node_pool.scale`  
**MCP tools:** `azure_monitor_alert_list`, `azure_app_service_list`, `azure_app_service_deployments`, `azure_app_service_restart` (HITL), `azure_aks_cluster_list`, `azure_aks_node_pool_list`

---

### 3.7 GCP

**Vault keys:** `gcp.service_account_json` (path to or inline JSON of a service account key)  
**Auth CLI:** `nimbus connector auth gcp --key-file <path>`  
**Sync strategy:** Cloud Run revisions → `type = "deployment"`; GKE workloads → `type = "cluster"`; Cloud Monitoring alerts → `type = "alert"`  
**HITL actions:** `gcp.cloud_run.deploy`, `gcp.gke.workload.restart`  
**MCP tools:** `gcp_cloud_run_service_list`, `gcp_cloud_run_revisions`, `gcp_gke_cluster_list`, `gcp_gke_workload_list`, `gcp_monitoring_alert_list`

---

### 3.8 IaC Awareness & Write Operations

**Design:** Unlike the cloud connectors, IaC awareness reads **local files** (Terraform state files, CloudFormation templates, Pulumi stacks) — no MCP server is required. A file-watcher and a CLI runner live directly in the Gateway.

**Vault keys:** none by default (local files); `iac.terraform.backend_token` for remote state backends (Terraform Cloud / HCP Terraform)  
**Auth CLI:** `nimbus connector auth iac --terraform-workspace <path> [--tf-cloud-token <token>]`

**Indexed item types:**

| Source | Type | Cursor |
|---|---|---|
| Terraform state (local `.tfstate`) | `iac_resource` | `nimbus-iac-tf1:<workspace_path>:<state_serial>` |
| Terraform Cloud workspace | `iac_resource` | `nimbus-iac-tfc1:<workspace_id>:<run_id>` |
| CloudFormation stack | `iac_resource` | `nimbus-iac-cfn1:<stack_name>:<last_event_id>` |
| Pulumi stack | `iac_resource` | `nimbus-iac-pul1:<stack_name>:<update_id>` |

**Drift detection:** After each IaC sync, compare indexed `iac_resource` items against live cloud state (queried via the AWS/Azure/GCP connectors). Resources present in IaC but absent in the cloud (or with differing config values) are flagged with `metadata.drift = true` and surfaced in `nimbus status --drift`.

**Connector availability handling:** Before attempting drift comparison, the IaC sync handler checks whether the corresponding cloud connector is active by querying `sync_state` for a recent successful sync of the relevant service (within the last 2× the connector's `defaultIntervalMs`). Three cases:
- **Connector active and recently synced:** drift check runs against indexed cloud items — no extra network call.
- **Connector configured but stale (last sync > 2× interval ago):** IaC connector triggers a one-off lazy fetch of just the relevant resource types from the cloud provider before running the comparison. This is non-blocking but adds latency to that sync cycle.
- **Connector not configured:** drift check is skipped; `nimbus status --drift` shows `⚠ Drift detection unavailable — AWS connector not configured` for affected resources.

**IaC write operations:**

```
nimbus ask "apply the terraform changes in ~/infra/payment-service"
→ Agent calls iac_terraform_plan(workspace) → HITL shows diff → Agent calls iac_terraform_apply(workspace)
```

```typescript
// HITL action IDs
"iac.terraform.apply"
"iac.terraform.destroy"
"iac.cloudformation.deploy"
"iac.pulumi.up"
```

**MCP tools:** `iac_terraform_plan`, `iac_terraform_apply` (HITL), `iac_terraform_destroy` (HITL), `iac_terraform_output`, `iac_cfn_stack_list`, `iac_cfn_deploy` (HITL), `iac_pulumi_stack_list`, `iac_pulumi_preview`, `iac_pulumi_up` (HITL)  
**Test:** E2E test uses a mock Terraform binary (shell script returning a canned plan JSON) to verify the plan → HITL → apply flow end-to-end in CI.

---

### 3.9 Kubernetes

**Vault key:** `kubernetes.kubeconfig` (path to kubeconfig file; the file itself is not stored in Vault — only the path)  
**Auth CLI:** `nimbus connector auth kubernetes [--kubeconfig <path>] [--context <context-name>]`  
**Sync strategy:** List pods, deployments, events, and recent restart counts via the Kubernetes API server (using the kubeconfig); index as `type = "k8s_workload"` / `type = "k8s_event"`.  
**Sync cursor:** `nimbus-k8s1:<context>:<namespace>:<resourceVersion>`  
**HITL actions:** `kubernetes.rollout.restart`, `kubernetes.pod.delete`, `kubernetes.deployment.scale`  
**MCP tools:** `k8s_pod_list`, `k8s_pod_describe`, `k8s_pod_logs`, `k8s_deployment_list`, `k8s_deployment_describe`, `k8s_event_list`, `k8s_rollout_restart` (HITL), `k8s_deployment_scale` (HITL)

---

### 3.10 Datadog

**Vault key:** `datadog.api_key`, `datadog.app_key`, `datadog.site` (default: `datadoghq.com`)  
**Auth CLI:** `nimbus connector auth datadog --api-key <key> --app-key <key> [--site <site>]`  
**Sync cursor:** `nimbus-dd1:<lastEventId>` (Datadog Events API)  
**Indexed types:** `type = "alert"` (monitors in ALERT state), `type = "incident"` (Datadog Incidents), `type = "service"` (Service Catalog entries)  
**MCP tools:** `datadog_monitor_list`, `datadog_monitor_get`, `datadog_incident_list`, `datadog_incident_get`, `datadog_service_list`, `datadog_dashboard_list`, `datadog_metric_query`

---

### 3.11 Grafana

**Vault key:** `grafana.url`, `grafana.api_token`  
**Auth CLI:** `nimbus connector auth grafana --url <url> --token <token>`  
**Sync cursor:** `nimbus-grf1:<lastAlertFiredAt>`  
**Indexed types:** `type = "alert"` (firing alert rules), `type = "dashboard"` (metadata only, not panels)  
**MCP tools:** `grafana_alert_list`, `grafana_alert_get`, `grafana_dashboard_list`, `grafana_dashboard_get`, `grafana_datasource_list`

---

### 3.12 Sentry

**Vault key:** `sentry.auth_token`, `sentry.org_slug`, `sentry.url` (default: `sentry.io`)  
**Auth CLI:** `nimbus connector auth sentry --token <token> --org <slug> [--url <url>]`  
**Sync cursor:** `nimbus-snt1:<lastIssueId>`  
**Indexed types:** `type = "error_issue"`, `type = "release"`  
**MCP tools:** `sentry_issue_list`, `sentry_issue_get`, `sentry_release_list`, `sentry_event_list`, `sentry_performance_list`

---

### 3.13 PagerDuty

**Vault key:** `pagerduty.api_token`  
**Auth CLI:** `nimbus connector auth pagerduty --token <token>`  
**Sync cursor:** `nimbus-pd1:<lastIncidentId>`  
**Indexed types:** `type = "incident"` (open + recently resolved), `type = "alert"`  
**HITL actions:** `pagerduty.incident.acknowledge`, `pagerduty.incident.resolve`, `pagerduty.incident.escalate`  
**MCP tools:** `pagerduty_incident_list`, `pagerduty_incident_get`, `pagerduty_alert_list`, `pagerduty_escalation_policy_list`, `pagerduty_on_call_list`, `pagerduty_incident_acknowledge` (HITL), `pagerduty_incident_resolve` (HITL)

---

### 3.14 New Relic

**Vault key:** `newrelic.api_key`, `newrelic.account_id`  
**Auth CLI:** `nimbus connector auth newrelic --api-key <key> --account-id <id>`  
**Sync cursor:** `nimbus-nr1:<lastAlertViolationId>`  
**Indexed types:** `type = "alert"` (active violations), `type = "deployment"` (New Relic deployment markers)  
**MCP tools:** `newrelic_alert_violation_list`, `newrelic_alert_policy_list`, `newrelic_apm_app_list`, `newrelic_deployment_list`, `newrelic_nrql_query`

---

## Wave 4 — Workflow Automation & Knowledge Graph

### 4.1 Workflow Pipeline Engine

**Why:** Users need named, repeatable, HITL-safe multi-step workflows that persist across sessions. Script files (`nimbus run`) and saved pipelines (`nimbus workflow`) share the same execution engine.

**YAML pipeline format:**

```yaml
name: weekly-incident-report
description: Summarize last week's incidents and post to Slack
steps:
  - label: gather-incidents
    run: Find all PagerDuty incidents from the last 7 days that are resolved
  - label: correlate
    run: For each incident, find the associated GitHub PR and deployment
  - label: draft-report
    run: Write a Markdown summary of root causes and affected services
  - label: post-to-slack
    run: Post the summary to #sre-weekly
    continue-on-error: false
```

**Execution engine interface:**

```typescript
// packages/gateway/src/automation/workflow-engine.ts

export interface WorkflowStep {
  label?: string;
  run: string;               // natural language instruction
  continueOnError?: boolean; // default false
}

export interface WorkflowRunOptions {
  workflowId?: string;       // from saved pipeline; null for ad-hoc script files
  steps: WorkflowStep[];
  triggeredBy: "cli" | `watcher:${string}` | "api";
  sessionId: string;         // for RAG memory scoping
  dryRun?: boolean;          // preview only — identify HITL steps, do not execute
}

export interface WorkflowRunResult {
  runId: string;
  status: "done" | "error" | "aborted";
  stepResults: Array<{ label?: string; status: string; output?: string }>;
}

export async function runWorkflow(opts: WorkflowRunOptions): Promise<WorkflowRunResult>;
```

**Preview phase (mandatory for `nimbus run` and `nimbus workflow run`):**

Before executing any step, the engine calls `runWorkflow({ ...opts, dryRun: true })`. This:
1. Runs each step with the LLM in planning mode (no tool calls executed).
2. Identifies steps that will require HITL (by inspecting tool call proposals against `HITL_REQUIRED`).
3. Returns a structured plan summary shown to the user.

User must type `y` (or confirm in desktop UI) before execution begins.

**No-TTY safety:** If `process.stdout.isTTY === false` and the dry-run reveals HITL-required steps, the runner aborts with a structured JSON error listing the offending steps. Read-only pipelines (no HITL steps detected) run unattended — safe for cron and CI.

**CLI commands:**

```bash
nimbus workflow save ./weekly.yml --name weekly-incident-report
nimbus workflow list
nimbus workflow run weekly-incident-report
nimbus workflow run weekly-incident-report --dry-run
nimbus workflow edit weekly-incident-report
nimbus workflow delete weekly-incident-report
nimbus workflow history weekly-incident-report
```

---

### 4.2 Watcher System

**Why:** Users want ambient monitoring — "alert me when a P1 fires in PagerDuty", "notify me if the zurich-project Drive folder hasn't changed in 3 days". Watchers are evaluated on every sync cycle tick, not on a separate schedule.

**Condition types:**

```typescript
export type WatcherConditionType =
  | "email_match"          // item.service = "gmail"/"imap" and body/subject matches pattern
  | "file_changed"         // item.service = "google_drive"/"onedrive" and modified_at updated
  | "file_not_changed"     // item.modified_at hasn't changed for > threshold_ms
  | "deploy_failed"        // ci_run.result = "FAILURE" for a given repo/job pattern
  | "alert_fired"          // item.type = "alert" and matches service/severity filter
  | "pr_merged"            // item.type = "pr" and status changed to "merged"
  | "schedule"             // cron expression (no item condition; fires on time)
  | "anomaly"              // anomaly-detector score > threshold (see §4.3)
  | "item_count_change"    // count of items matching a filter changed by > N%;

export interface WatcherCondition {
  type: WatcherConditionType;
  filter?: Record<string, unknown>;    // service, type, pattern, threshold, cron, etc.
}
```

**Action types:**

```typescript
export type WatcherActionType = "notify" | "run_workflow" | "ask_agent";

export interface WatcherAction {
  type: WatcherActionType;
  workflowName?: string;    // for run_workflow
  agentPrompt?: string;     // for ask_agent
  notificationMessage?: string; // for notify (template with {item.*} placeholders)
}
```

**Evaluation loop:** The `SyncScheduler` calls `WatcherEngine.evaluate()` after each connector sync completes. Evaluation is lightweight — it queries the `item` table with indexed conditions and compares to the watcher's last-checked snapshot. Fired watchers append to `watcher_event` and run their action.

**`schedule` (cron) watchers:** Cron watchers are evaluated only when the cron expression matches the current tick — not on every sync cycle completion. `WatcherEngine.evaluate()` gates `schedule` watchers with a quick `isCronDue(expression, lastCheckedAt, now)` check before running the condition; watchers whose cron has not yet elapsed are skipped in O(1) without a DB query. This prevents every sync cycle from running cron parsing against all schedule watchers.

**Infinite-loop protection:** Two guards prevent runaway automation:
1. **Rate limit:** Each watcher tracks `fires_in_last_hour` (count of `watcher_event` rows in the past 60 min). If this count exceeds `max_fires_per_hour` (default: 10, configurable per watcher), the watcher is automatically paused and the user is notified: `Watcher "p1-alerts" rate-limited (10 fires in 60 min). Resume with: nimbus watch resume p1-alerts`.
2. **Cycle detection:** A watcher action of type `run_workflow` passes its `watcher_id` as the `triggeredBy` value. If the resulting workflow steps generate new items that would re-trigger the same watcher within the same evaluation cycle, the evaluation loop detects the `watcher_id` already in the active-run set and skips the re-trigger.

Each watcher condition evaluation is also bounded by a 500 ms timeout; slow evaluations are logged as warnings and do not block subsequent watchers.

**CLI commands:**

```bash
nimbus watch create --name "p1-alerts" \
  --condition '{"type":"alert_fired","filter":{"service":"pagerduty","severity":"P1"}}' \
  --action '{"type":"notify","notificationMessage":"P1 fired: {item.title}"}'

nimbus watch list
nimbus watch pause p1-alerts
nimbus watch delete p1-alerts
nimbus watch history p1-alerts
```

**IPC methods:** `watcher.create`, `watcher.list`, `watcher.pause`, `watcher.resume`, `watcher.delete`, `watcher.history`

---

### 4.3 Proactive Anomaly Detection

**Why:** Explicitly-defined watchers require the user to know what to watch. Anomaly detection surfaces things the user didn't know to look for.

**Baseline model:** For each `(service, type)` pair, the anomaly detector maintains a rolling baseline (7-day window, updated nightly) of:
- Item creation rate (items/hour)
- Average `body_preview` embedding centroid (via sqlite-vec centroid query)
- P95 `duration_ms` for `ci_run` items

**Scoring:** On each sync, new items are scored against the baseline:
- **Volume anomaly:** creation rate deviates >2σ from the baseline → score +=1
- **Semantic anomaly:** new item embedding is in the bottom 5th percentile of cosine similarity to the centroid → score +=1
- **Latency anomaly:** (CI runs only) duration >3× P95 baseline → score +=1

Items with score ≥ 2 are stored in `metadata.anomaly_score`. A watcher with `condition_type = "anomaly"` and `filter.threshold = 2` will fire on these.

**Surfacing:** `nimbus status --anomalies` lists the top-10 anomalous items from the last 24 hours. The DevOps agent has this tool pre-registered.

---

### 4.4 Filesystem Connector v2

**Upgrade from Phase 1:** The Phase 1 filesystem connector indexes file metadata only. v2 adds git awareness, semantic code search, and dependency graph indexing.

**New capabilities:**

**Git-aware indexing:**
- On each sync, run `git log --since=<cursor> --format=json` in each configured repo root.
- Index commits as `type = "git_commit"`: `{ sha, message, author, changed_files[], insertions, deletions }`.
- Generate diff summaries for commits touching >5 files: LLM-summarized via the agent (async, non-blocking).
- Link commits to PRs (match `sha` against GitHub/GitLab/Bitbucket PR head SHAs in the index).

**Semantic code search:**
- Parse source files for exported symbols: functions, classes, types, constants.
- Index each symbol as `type = "code_symbol"`: `{ name, kind, file, line, docstring }`.
- Embed symbol name + docstring; store in `vec_items`.
- `nimbus search --code "function that handles OAuth token refresh"` queries this index.

**Dependency graph:**
- On each sync, parse manifest files: `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`, `pyproject.toml`.
- Index each declared dependency as `type = "dependency"`.
- Cross-reference against known CVE databases (offline JSON feed bundled with the Gateway; updated on install).
- Flag dependencies with known HIGH/CRITICAL CVEs in `metadata.vuln_ids`.

**Vault key:** none (local filesystem access)  
**Config (`nimbus.toml`):**

```toml
[[filesystem.roots]]
path = "~/code"
git_aware = true
code_index = true
dependency_graph = true
exclude = ["node_modules", ".git", "dist", "target"]
```

---

## Wave 5 — Interaction Layer & Agent Specialization

### 5.1 Session CLI

**Why:** `nimbus ask "..."` is stateless — each invocation is a cold start. Engineers need a persistent interactive session where context accumulates across turns.

**Invocation:** `nimbus` with no arguments. Detects whether stdin is a TTY; if not, behaves identically to `nimbus ask` (one-shot, no session state).

**Session lifecycle:**

```
$ nimbus
Nimbus — Phase 3 (Intel). Type /help for commands, Ctrl+C to exit.
Connected to Gateway [PID 4821] — 52,341 items indexed.

> find all open PRs that mention payment-service
[searches local index, returns 4 results]

> which ones have failing CI?
[uses session context — no need to re-specify "PRs about payment-service"]
[cross-references ci_run items from GitHub Actions connector]
→ PR #312 — CI failing since commit a3f9c12

> show me what changed in that commit
→ [fetches from git_commit index, no network call]

> summarize and post to #payment-team
⚠ CONSENT — post message to #payment-team. Review? [y/n]: y
✅ Posted.

> /clear
Session memory cleared.
> 
```

**Session commands (prefixed with `/`):**

| Command | Description |
|---|---|
| `/clear` | Clear session memory for this session |
| `/history` | Print the last N turns of this session |
| `/connector list` | Shorthand for `nimbus connector list` inline |
| `/help` | List available commands |
| `Ctrl+C` / `/exit` | End the session |

**State persistence:** Session state (conversation turns, RAG memory chunks) persists in the Gateway as long as the Gateway process is running. A new `nimbus` invocation within the same Gateway process can resume the previous session (opt-in via `nimbus --resume`).

**HITL in session mode:** Consent prompts appear inline as a conversation turn, not as a separate prompt. The agent proposes the action in structured Markdown; the user types `y`/`n`. No separate process or dialog is spawned.

---

### 5.2 Script Files (`nimbus run`)

**Why:** Repeatable multi-step automation that is safe to schedule, share, and audit.

**Format (same as workflow YAML):**

```yaml
name: zurich-weekly-cleanup
steps:
  - Find all PDF files in Google Drive not opened in 90 days tagged "Zurich"
  - Summarize them by subfolder
  - Move the ones from /Active to /Archive/2026
  - Send me an email with the summary
```

**Execution:**

```bash
nimbus run ./zurich-cleanup.yml
nimbus run ./zurich-cleanup.yml --dry-run   # preview only
nimbus run ./zurich-cleanup.yml --no-ttv    # explicit no-TTY; aborts if HITL required
```

**Preview output:**

```
Script: zurich-weekly-cleanup (4 steps)

  Step 1  Find PDFs not opened in 90 days       READ — no approval needed
  Step 2  Summarize by subfolder                READ — no approval needed
  Step 3  Move files to /Archive/2026           ⚠ REQUIRES APPROVAL — calls gdrive_file_move (restricted: gdrive.file.move)
  Step 4  Send summary email                    ⚠ REQUIRES APPROVAL — calls gmail_send (restricted: gmail.message.send)

Proceed? [y/n]:
```

The dry-run preview always names the specific tool call and HITL action ID that will require consent. This ensures users understand exactly which security boundary is being crossed before agreeing to run the script.

**Script files and workflow pipelines share the same `WorkflowEngine`. `nimbus workflow save ./zurich-cleanup.yml --name zurich-cleanup` promotes an ad-hoc script into a saved, named pipeline.**

---

### 5.3 DevOps Agent

**Why:** A general-purpose agent will give mediocre answers to incident questions if it has no awareness of the deployment ↔ alert ↔ PR causal chain. A domain-tuned agent with a scoped tool set is significantly more useful.

**Definition:**

```typescript
// packages/gateway/src/agents/devops-agent.ts

export const devopsAgent = new MastraAgent({
  name: "devops",
  systemPrompt: DEVOPS_SYSTEM_PROMPT,  // see below
  tools: [
    searchLocalIndex,
    fetchMoreIndexResults,
    resolvePerson,
    traverseGraph,
    // CI/CD tools
    "jenkins_build_list", "gha_run_list", "circleci_pipeline_list",
    // Infra tools
    "k8s_pod_list", "k8s_pod_logs", "k8s_event_list",
    "aws_cloudwatch_logs_tail", "aws_ecs_service_describe",
    "datadog_incident_get", "pagerduty_incident_list", "pagerduty_incident_acknowledge",
    "iac_terraform_plan",
    // Write (all behind HITL)
    "jenkins_build_trigger", "gha_run_trigger", "k8s_rollout_restart",
    "pagerduty_incident_resolve", "iac_terraform_apply",
  ],
  memory: {
    scope: "devops",
    recallTopK: 10,
  },
});
```

**System prompt highlights (`DEVOPS_SYSTEM_PROMPT`):**
- Always start by querying the local index before making any tool calls that could go to the network.
- When an alert is mentioned, immediately call `traverseGraph` to find associated deployments and PRs before summarizing.
- Never trigger a CI build, rollout restart, or IaC apply without first presenting a structured plan and waiting for HITL.
- Cite the data source (connector + timestamp) for every fact in the response.

**Invocation:** `nimbus ask --agent devops "what caused the payment-service alert?"` or automatically selected by the intent router when the query contains CI/CD, incident, deployment, or infrastructure keywords.

---

### 5.4 Research Agent

**Why:** Document synthesis across Drive, Notion, Confluence, and email requires different tool priorities and prompt framing than incident response.

**Definition:**

```typescript
export const researchAgent = new MastraAgent({
  name: "research",
  systemPrompt: RESEARCH_SYSTEM_PROMPT,
  tools: [
    searchLocalIndex,       // semantic mode enabled by default
    fetchMoreIndexResults,
    resolvePerson,
    // Document tools
    "gdrive_file_read", "notion_page_get", "confluence_page_get",
    "gmail_thread_read", "gmail_message_read",
    // Write (all behind HITL)
    "gdrive_file_create", "notion_page_create", "gmail_draft_create",
  ],
  memory: {
    scope: "research",
    recallTopK: 20,          // larger recall window for synthesis tasks
  },
});
```

**System prompt highlights:** Synthesize across sources; cite every factual claim with `[source: <service>:<item_id>]`; prefer the most recent version of a document when multiple versions exist; never fabricate information not present in the index.

**Invocation:** `nimbus ask --agent research "summarize the Zurich project status across Notion and email"` or automatically selected for synthesis and summarization queries.

---

## HITL Extensions for Phase 3 Actions

All new write actions must be added to `HITL_REQUIRED` in `packages/gateway/src/engine/executor.ts` before the corresponding connector is merged.

| Action ID | Connector | Description |
|---|---|---|
| `jenkins.build.trigger` | Jenkins | Trigger a Jenkins build |
| `jenkins.build.abort` | Jenkins | Abort a running Jenkins build |
| `github_actions.run.trigger` | GitHub Actions | Trigger a GitHub Actions workflow run |
| `github_actions.run.cancel` | GitHub Actions | Cancel a running workflow run |
| `circleci.pipeline.trigger` | CircleCI | Trigger a CircleCI pipeline |
| `circleci.job.cancel` | CircleCI | Cancel a CircleCI job |
| `gitlab.pipeline.retry` | GitLab CI | Retry a failed GitLab pipeline |
| `gitlab.pipeline.cancel` | GitLab CI | Cancel a running GitLab pipeline |
| `aws.ecs.service.update` | AWS | Update an ECS service (image, desired count) |
| `aws.lambda.invoke` | AWS | Invoke a Lambda function |
| `aws.ec2.instance.stop` | AWS | Stop an EC2 instance |
| `aws.ec2.instance.start` | AWS | Start an EC2 instance |
| `azure.app_service.restart` | Azure | Restart an App Service |
| `azure.aks.node_pool.scale` | Azure | Scale an AKS node pool |
| `gcp.cloud_run.deploy` | GCP | Deploy a Cloud Run revision |
| `gcp.gke.workload.restart` | GCP | Restart a GKE workload |
| `iac.terraform.apply` | IaC | Apply a Terraform plan |
| `iac.terraform.destroy` | IaC | Destroy Terraform-managed resources |
| `iac.cloudformation.deploy` | IaC | Deploy a CloudFormation stack |
| `iac.pulumi.up` | IaC | Run `pulumi up` |
| `kubernetes.rollout.restart` | Kubernetes | Restart a Kubernetes deployment rollout |
| `kubernetes.pod.delete` | Kubernetes | Delete a Kubernetes pod |
| `kubernetes.deployment.scale` | Kubernetes | Scale a Kubernetes deployment |
| `pagerduty.incident.acknowledge` | PagerDuty | Acknowledge a PagerDuty incident |
| `pagerduty.incident.resolve` | PagerDuty | Resolve a PagerDuty incident |
| `pagerduty.incident.escalate` | PagerDuty | Escalate a PagerDuty incident |

---

## Acceptance Criteria Checklist

These gate Phase 3 completion. All must pass before Phase 3 is marked complete.

- [ ] `nimbus ask "what caused the payment-service incident last night?"` correlates the PagerDuty alert, GitHub PR, Jenkins build, CloudWatch error spike, and Slack incident thread — sourced entirely from the local index — in a single response
- [ ] `nimbus search --semantic "function that refreshes OAuth tokens"` returns the relevant code symbol from the Filesystem v2 index without the word "refresh" appearing in the symbol name (semantic recall)
- [ ] Hybrid search RRF results are measurably better than BM25-only on a held-out query set (≥10% improvement in MRR@10) — verified by `packages/gateway/test/benchmark/search-quality.bench.ts`
- [ ] A community developer can publish a working Nimbus extension in under one working day using `nimbus scaffold extension` and `MockGateway` from the SDK — verified by a contributor walkthrough doc
- [ ] A tampered extension (manifest hash mismatch on disk) is disabled before its process starts; a Gateway startup log entry at `ERROR` level identifies it by name
- [ ] `nimbus extension install @community/nimbus-jenkins` (from a local tarball in CI) installs, loads, and starts syncing Jenkins jobs without requiring any Gateway source changes
- [ ] A watcher with `condition_type = "alert_fired"` fires within one sync cycle of a PagerDuty incident being indexed; the `watcher_event` row is written before the action is dispatched
- [ ] Missed watcher conditions during a Gateway downtime are evaluated on next startup (one catch-up evaluation, not a full backlog)
- [ ] `nimbus run ./weekly-report.yml --dry-run` correctly identifies all HITL-required steps without executing any tool calls; `nimbus run ./weekly-report.yml` with `--no-ttv` aborts if any HITL steps are present
- [ ] `terraform plan` → HITL → `terraform apply` flow is tested end-to-end in CI against a mock Terraform binary (shell script returning a canned plan JSON)
- [ ] IaC drift detected between local Terraform state and an AWS connector item is surfaced in `nimbus status --drift` within one sync cycle
- [ ] Session CLI: `nimbus` interactive session maintains context across turns; "now move the ones from last month" after a prior file search executes correctly without re-specifying the search
- [ ] Session memory is scoped per session; clearing one session does not affect another concurrent session
- [ ] DevOps agent automatically selects `traverseGraph` before `searchLocalIndex` when an incident is described in the query
- [ ] Coverage gates met: Embedding pipeline ≥80%, Watcher engine ≥80%, Workflow engine ≥80%, Extension registry ≥85%
- [ ] `bun audit --audit-level high` passes clean; no HIGH/CRITICAL CVEs in any Phase 3 package
- [ ] All Phase 3 write actions appear in `HITL_REQUIRED` and are exercised by `hitl-write-ops.e2e.test.ts`
- [ ] The three-platform CI matrix (Ubuntu / macOS / Windows) is green for all Phase 3 tests; `sqlite-vec` loads correctly on all three runners
- [ ] `scripts/package-headless-bundle.ts` includes the `all-MiniLM-L6-v2` model files (~22 MB); a freshly-installed headless bundle embeds a document without network access

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `sqlite-vec` loading broken on Windows or macOS CI runners | Medium | High | Test `db.loadExtension("vec0")` as a Phase 3 gate in Week 1; pin `sqlite-vec` version; document fallback (disable embedding, fall back to BM25-only) if the extension fails to load |
| `@xenova/transformers` model download blocked in CI (network) | Medium | Medium | Cache model files in CI artefact store; provide a `NIMBUS_EMBEDDING_MODEL_DIR` env var pointing to a pre-downloaded bundle |
| Extension sandbox escape (child process reads parent env) | Low | High | Bun `subprocess` does not inherit parent env by default when `env` is explicitly set; add an automated test that spawns a mock extension and asserts it cannot read `NIMBUS_VAULT_KEY` or the IPC socket path |
| AWS/Azure/GCP API surface too broad to ship safely in one wave | High | Medium | Ship each cloud connector behind a feature flag (`NIMBUS_CONNECTOR_AWS_ENABLED=true`); connectors are off by default until the connector's own E2E test suite is green on all three platforms |
| IaC `terraform apply` HITL bypassed by a crafted plan output | Low | High | HITL gate is structural — executor checks `HITL_REQUIRED` before dispatching; `iac_terraform_apply` is in that set regardless of plan content; add fuzz test for crafted plan payloads |
| Watcher engine adds measurable latency to every sync cycle | Medium | Medium | Watcher evaluation runs after connector sync completes (not blocking it); add a timeout (500ms) per watcher condition evaluation; log slow watchers |
| Session CLI state leaks between concurrent sessions | Medium | High | `session_id` is scoped per CLI invocation; `session_memory` queries always filter by `session_id`; add concurrency test with two simultaneous sessions |
| Too many CI/CD connectors ship in one PR, breaking CI matrix | High | Medium | Gate each connector on its own feature flag; ship connectors in sub-batches (Jenkins+GHA → CircleCI+GitLab CI → cloud connectors → observability) with a CI green gate between each batch |
| Workflow engine HITL can be pre-approved via `--dry-run` then bypassed | Low | High | `--dry-run` never produces an approval token; the actual run always re-evaluates HITL conditions live; add a test asserting that dry-run output cannot be piped into a real run to skip consent |

---

## Deferred Decisions

Items raised during Phase 3 planning that are acknowledged but deliberately not addressed in Phase 3.

| Topic | Decision | Reason |
|---|---|---|
| **Multi-model embedding** (different models per item type — e.g. code vs prose) | Deferred to Phase 5 | Single `all-MiniLM-L6-v2` model is sufficient for Phase 3 use cases. Multi-model adds schema complexity (different dims → separate vec tables) and model management overhead. **Schema is pre-positioned for this:** `vec_items_384` is named by dimension, `embedding_chunk.dims` records the dimension, and `embedding_chunk.model` records the model name — adding `vec_items_1536` for OpenAI in Phase 5 requires only a new virtual table and an additional `dims = 1536` code path, not a schema migration. |
| **Remote vector store** (Qdrant, Weaviate, Pinecone) | Deferred to Phase 9 | Local-first principle: `sqlite-vec` is the correct choice for Phase 3. Remote vector stores introduce a cloud dependency and a privacy boundary violation unless self-hosted. Revisit for enterprise deployments in Phase 9. |
| **Extension network sandboxing** (syscall filter, seccomp, container) | Deferred to Phase 5 | Phase 3 sandbox is process isolation + env restriction (honour system for network). Full syscall filtering requires platform-specific implementation (seccomp on Linux, Sandbox on macOS, AppContainer on Windows) — a Phase 5 security hardening item. |
| **Watcher conditions on relationship graph** (e.g. "alert me when a new PR author has no prior reviews") | Deferred to Phase 4 | Requires graph traversal in the watcher condition evaluator, which adds significant complexity. The Phase 3 condition types cover the most common use cases. |
| **Workflow branching and conditionals** (if/else steps, parallel branches) | Deferred to Phase 4/5 | Linear sequential execution covers the primary use cases. Branching requires a more complex workflow DSL and execution engine; deferred until user feedback identifies specific patterns. |
| **`nimbus connector add --mcp` for arbitrary user MCP servers** | **Included in Phase 3 via Extension Registry** | The Phase 2 deferral is resolved. Extension Registry v1 provides manifest hash verification, sandboxed child processes, and scoped credential injection — the prerequisites for safe third-party MCP servers. `nimbus connector add --mcp` is sugar over `nimbus extension install` for a local server. |
| **Per-connector OAuth vault keys** (vs shared `google.oauth`, `microsoft.oauth`) | Deferred to Phase 4 | No user-reported breakage from shared keys yet. Revisit if scope-collision UX issues are reported. Separating keys would require migrating existing stored tokens — high disruption for low current benefit. |
