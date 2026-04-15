# Phase 3.5 — Detailed Implementation Plan

> **Theme:** Observability & Developer Experience  
> **Goal:** Make Nimbus debuggable, composable, and trustworthy before Phase 4 begins.  
> **Constraint:** Solo developer — all workstreams are sequential unless explicitly noted as parallelisable.  
> **Release gate:** Phase 4 does not begin until every acceptance criterion in this document passes on all three platforms.

**Living status (2026-04-15):** Implementation on `main` is **code-complete** for Phase 3.5 (observability, query/diag/db, telemetry with DB-backed aggregates, client publish workflow, docs hub, doctor, first-start hints, optional query bench). This document remains the engineering spec. **What is already on `main`** is summarized in [`docs/roadmap.md`](./roadmap.md). Use the **consolidated acceptance list** at the end of *this* file for per-OS release sign-off (`[x] code` vs `[ ] verified`); tick only after manual verification, not when code alone exists.

---

## Docs Site Stack Decision: Astro Starlight

**Choice:** [Astro Starlight](https://starlight.astro.build)  
**Location:** `packages/docs/` (new workspace package)

**Reasons over alternatives:**

| Criterion | Astro Starlight | Docusaurus | VitePress |
|---|---|---|---|
| Built-in full-text search | ✅ Pagefind (static, zero external services) | ❌ Algolia required for good search | ⚠️ Local index, limited |
| TypeScript-first | ✅ | ✅ | ✅ |
| MDX support | ✅ | ✅ | ⚠️ Limited |
| Auto-sidebar from filesystem | ✅ | ⚠️ Manual config | ⚠️ Manual config |
| Built-in versioning | ✅ via content collections | ✅ via `--docs-version` | ❌ Manual |
| Build performance | ✅ Fastest (Islands architecture) | ❌ Slowest (full React SSR) | ✅ Fast |
| Zero-config dark mode | ✅ | ✅ | ✅ |
| CLI reference auto-gen | ✅ via MDX + remark | ⚠️ Plugin needed | ⚠️ Plugin needed |
| Hosting | Static — GitHub Pages or Cloudflare Pages, free | Static | Static |

The built-in Pagefind integration is the deciding factor: the roadmap requires full-text search with no external service, and Pagefind generates a static search index at build time with zero runtime dependencies.

---

## Execution Order

The workstreams have dependencies. For a solo developer the recommended sequence is:

```
1. Data Integrity & Recovery       (foundation — unblocks migration safety for all later work)
2. Connector Health Model          (shared state — observability, onboarding, and doctor all read it)
3. Self-Observability              (builds on health model; defines the metrics surface)
4. Configuration Management        (needed before telemetry; relatively self-contained)
5. Data Layer API + @nimbus-dev/client  (IPC must be stable before client library ships)
6. Telemetry                       (needs config infra + metrics surface from step 3)
7. Onboarding                      (nimbus doctor needs health model + diag; wizard needs connector health)
8. Extension Testing Infrastructure (SDK stability prerequisite; low-risk at this point)
9. Documentation Site              (last — documents everything built in steps 1–8)
```

Each workstream section below follows this order.

---

## Workstream 1 — Data Integrity & Recovery

**Why first:** Every later workstream touches the database. Schema migrations, repairs, and snapshot infrastructure need to exist before anything else lands.

### 1.1 `nimbus db verify`

**New file:** `packages/gateway/src/db/verify.ts`

Checks performed (in order, all non-destructive):
1. `PRAGMA integrity_check` — SQLite page-level corruption
2. FTS5 consistency — `INSERT INTO items_fts(items_fts) VALUES('integrity-check')` shadow table walk
3. `vec_items_384` rowid alignment — `SELECT COUNT(*) FROM vec_items_384` vs `SELECT COUNT(*) FROM items WHERE embedding IS NOT NULL`; mismatch = finding
4. Orphaned sync tokens — `sync_state` rows whose `connector_id` has no entry in the connectors registry
5. Schema version match — `_schema_migrations` latest applied vs `CURRENT_SCHEMA_VERSION` constant in `packages/gateway/src/db/schema.ts`
6. Foreign key integrity — `PRAGMA foreign_key_check` — reports any row whose foreign key references a non-existent parent row (e.g., a `graph_relation` pointing to a deleted `graph_entity`); each violation reported as `fk_violation:<table>.<column>`

Output:
```
[ok]   integrity_check
[ok]   fts5_consistency
[FAIL] vec_rowid_mismatch: 412 vec rows, 398 metadata rows (+14)
[ok]   orphaned_sync_tokens
[ok]   schema_version
[ok]   foreign_key_integrity
```

Exit codes: `0` = all pass, `1` = at least one finding.

**Test:** `packages/gateway/test/unit/db/verify.test.ts` — manually corrupt an FTS5 shadow table and assert exit code `1` and the correct finding label.

---

### 1.2 `nimbus db repair`

**New file:** `packages/gateway/src/db/repair.ts`

Repair actions (each conditional on the corresponding `verify` finding):
- `vec_rowid_mismatch` → delete orphaned `vec_items_384` rows, re-queue affected connectors for full resync via the scheduler
- FTS5 inconsistency → `INSERT INTO items_fts(items_fts) VALUES('rebuild')`
- Unrecoverable rows → `DELETE FROM items WHERE rowid IN (...)`, write deleted ids to audit log
- Orphaned sync tokens → `DELETE FROM sync_state WHERE connector_id NOT IN (...)`

Requires explicit confirmation unless `--yes` flag is passed (mirrors `nimbus connector remove` pattern).  
Writes a structured repair report to `audit_log` with `action = 'db.repair'`.

**Test:** `packages/gateway/test/unit/db/repair.test.ts` — introduce each finding, run repair, run verify again, assert clean.

---

### 1.3 Automatic pre-migration backup

**Modify:** `packages/gateway/src/db/migrations/runner.ts`

Before executing migration N:
1. Resolve backup path: `<dataDir>/backups/pre-migration-<N>-<timestamp>.db.gz`
2. `fs.copyFile(dbPath, tmpPath)` then gzip compress to `.db.gz`
3. Write `{ migration: N, timestamp, srcSize, compressedSize }` to `_schema_migrations` row for N with status `'pending_backup_complete'`
4. If backup write fails → abort migration with error (never proceed without backup)
5. Proceed with migration; on failure → restore from backup (step 1.4), mark `'failed'`
6. On success → mark `'applied'`
7. Prune backups older than 30 days at end of successful run

**New CLI:** `nimbus db backups list` → reads `<dataDir>/backups/` and prints filename, pre-migration version, timestamp, compressed size.

---

### 1.4 Migration rollback

**Modify:** `packages/gateway/src/db/migrations/runner.ts` (same file as 1.3)

```typescript
async function applyMigration(migration: Migration, db: Database): Promise<void> {
  const backup = await writePreMigrationBackup(migration.version);
  try {
    await db.transaction(() => migration.up(db))();
    markApplied(db, migration.version);
  } catch (err) {
    await restoreFromBackup(backup);
    markFailed(db, migration.version);
    throw new MigrationRollbackError(migration.version, err);
  }
}
```

`MigrationRollbackError` carries the migration version and original error — the Gateway startup handler catches it and prints a clear, actionable message before exiting.

**Test:** `packages/gateway/test/unit/db/migration-rollback.test.ts` — inject a migration that throws mid-run; assert the pre-migration backup is restored and schema version is unchanged.

---

### 1.5 Index snapshot scheduling

**New file:** `packages/gateway/src/db/snapshot.ts`

- Manual: `nimbus db snapshot` → copies + gzips to `<dataDir>/snapshots/nimbus-<timestamp>.db.gz`
- Scheduled: `[db.snapshots]` config block:
  ```toml
  [db.snapshots]
  enabled = true
  schedule = "0 2 * * *"   # cron, default: 2am daily
  keep_last = 7
  ```
  Cron evaluated by the existing watcher cron gate infrastructure (`packages/gateway/src/watchers/cron.ts`).
- `nimbus db restore <snapshot>` — prints diff of item counts (current vs snapshot), requires confirmation.
- `nimbus db snapshots list` — table of filename / timestamp / compressed size.

---

### 1.6 Disk space monitoring

**Modify:** `packages/gateway/src/db/health.ts` (new file, also referenced by Workstream 2)

**Two complementary triggers — polling and reactive:**

**Polling** (startup + every N hours):
```typescript
interface DiskSpaceCheck {
  indexSizeBytes: number;
  snapshotsSizeBytes: number;
  availableBytes: number;
  usedPercent: number;           // (indexSize + snapshotsSize) / (used + available)
  thresholdPercent: number;      // default 80
  exceeded: boolean;
}
```

Check run at Gateway startup and every 6 hours (configurable via `[db.disk_check_interval_hours]`).

**Reactive** (`SQLITE_FULL` error path):

Polling alone has a TOCTOU gap: a snapshot or sync job can fill the disk entirely between checks, causing a mid-transaction `SQLITE_FULL` (error code 13) failure. To handle this, the Gateway's central DB write wrapper catches `SQLITE_FULL` synchronously:

```typescript
// packages/gateway/src/db/write.ts — thin wrapper used by all DB writes
export function dbRun(db: Database, sql: string, params?: unknown[]): void {
  try {
    db.run(sql, params);
  } catch (err: unknown) {
    if (isSqliteError(err, SQLITE_FULL)) {
      setDiskSpaceWarning(true);          // immediate synchronous flag set
      emitNotification('disk_full');      // fires notification bus
      throw new DiskFullError(err);       // re-throw so callers can abort cleanly
    }
    throw err;
  }
}
```

`DiskFullError` is a typed subclass so callers (snapshot writer, sync job, migration runner) can catch it explicitly and abort without leaving a partial write. The migration runner treats `DiskFullError` the same as any other mid-run failure — it triggers the rollback path from Workstream 1.4.

When `exceeded` (either trigger):
- Set `disk_space_warning = true` in the Gateway state (read by `nimbus status`)
- Emit notification via the existing notification bus (once per `false → true` transition)

**New CLI:** `nimbus db prune` — removes snapshots and index rows beyond `retentionDays`; prints a before/after size summary; requires confirmation.

---

### Workstream 1 Acceptance Criteria

- `nimbus db verify` detects a manually introduced FTS5 rowid mismatch and exits `1` with the correct finding label
- `nimbus db repair` resolves the mismatch; subsequent `verify` exits `0`
- A migration that throws mid-run restores the pre-migration backup automatically; `nimbus db backups list` shows the backup; Gateway exits with a message naming the migration version
- `nimbus db snapshot` creates a `.db.gz` in `<dataDir>/snapshots/`; `nimbus db restore` restores with confirmation
- `nimbus db verify` and `nimbus db repair` pass on Windows, macOS, and Linux CI

---

## Workstream 2 — Connector Health Model

**Why second:** `nimbus status`, `nimbus diag`, `nimbus doctor`, and the agent's degraded-state query caveats all read connector health state. This must exist before any of them can be implemented.

### 2.1 Health state enum and persistence

**Modify:** `packages/gateway/src/db/schema.ts`

Add to `sync_state` table (migration N+1):
```sql
ALTER TABLE sync_state ADD COLUMN health_state TEXT NOT NULL DEFAULT 'healthy'
  CHECK(health_state IN ('healthy','degraded','error','rate_limited','unauthenticated','paused'));
ALTER TABLE sync_state ADD COLUMN retry_after INTEGER;          -- unix ms, null unless rate_limited
ALTER TABLE sync_state ADD COLUMN backoff_until INTEGER;        -- unix ms, null unless in backoff
ALTER TABLE sync_state ADD COLUMN backoff_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN last_error TEXT;             -- last error message, truncated to 512 chars
```

**New file:** `packages/gateway/src/connectors/health.ts`

```typescript
export type ConnectorHealthState =
  | 'healthy' | 'degraded' | 'error'
  | 'rate_limited' | 'unauthenticated' | 'paused';

export interface ConnectorHealthSnapshot {
  connectorId: string;
  state: ConnectorHealthState;
  retryAfter?: Date;
  backoffUntil?: Date;
  backoffAttempt: number;
  lastError?: string;
  lastSuccessfulSync?: Date;
  lastSyncAttempt?: Date;
}

export function transitionHealth(
  db: Database,
  connectorId: string,
  event: HealthEvent
): ConnectorHealthSnapshot { ... }
```

**`HealthEvent` union:**
```typescript
type HealthEvent =
  | { type: 'sync_success' }
  | { type: 'rate_limited'; retryAfter: Date }
  | { type: 'unauthenticated' }
  | { type: 'transient_error'; error: string; attempt: number }
  | { type: 'persistent_error'; error: string }
  | { type: 'paused' }
  | { type: 'resumed' };
```

---

### 2.2 Rate-limit awareness

**Modify:** `packages/gateway/src/sync/scheduler.ts`

Before dispatching a sync job, check `health_state`:
- `rate_limited` and `Date.now() < retryAfter` → skip, log `skipped_rate_limited`
- `unauthenticated` → skip, emit notification (see 2.4)
- `paused` → skip

When a connector MCP call returns HTTP 429:
1. Parse `Retry-After` header (seconds or HTTP date)
2. Call `transitionHealth(db, connectorId, { type: 'rate_limited', retryAfter })`

**Test:** `packages/gateway/test/unit/sync/rate-limit-aware-scheduler.test.ts` — mock a connector returning 429 with `Retry-After: 60`, assert health transitions to `rate_limited`, assert scheduler skips within the window, assert retry after window passes.

---

### 2.3 Silent token expiry detection

**Modify:** `packages/gateway/src/connectors/mesh.ts` (or wherever MCP call errors are caught)

HTTP 401 or 403 from an MCP connector call:
```typescript
transitionHealth(db, connectorId, { type: 'unauthenticated' });
```

**Do not** log a generic `"Connector error"` message — the health state carries the signal. The notification (2.4) provides the user-facing message.

---

### 2.4 Notifications for auth expiry

**Modify:** `packages/gateway/src/notifications/index.ts` (create if it doesn't exist as a proper module)

When health transitions to `unauthenticated`:
```
[nimbus] GitHub connector lost authentication.
Run: nimbus connector auth github
```

Notification is emitted once per `unauthenticated` entry (not on every skipped sync). Re-emitted only after the connector successfully re-authenticates and then loses auth again.

---

### 2.5 Automatic retry with exponential backoff

**Modify:** `packages/gateway/src/sync/scheduler.ts`

**Connectivity guard (runs before any sync dispatch):**

Before dispatching any sync job, the scheduler performs a lightweight connectivity probe. If the machine is offline, all pending jobs are suspended without counting the outage as backoff attempts — a laptop sleeping through bad Wi-Fi should not push connectors into `error` state.

```typescript
// packages/gateway/src/sync/connectivity.ts
export async function isOnline(): Promise<boolean> {
  // DNS resolution probe — no TCP connection opened, no data sent
  try {
    await Bun.dns.lookup('one.one.one.one');  // resolves to 1.1.1.1; configurable probe host
    return true;
  } catch {
    return false;
  }
}
```

Scheduler dispatch loop:
```typescript
if (!(await isOnline())) {
  logger.debug('system offline — suspending all sync jobs until connectivity restored');
  scheduleConnectivityRecheck(30_000);   // recheck in 30s
  return;                                // no connectors touched, no backoff consumed
}
```

`HealthEvent` gains a new variant to record offline-induced skips (for history and diagnostics):
```typescript
| { type: 'skipped_offline' }
```

The connectivity probe host is configurable (`[sync.connectivity_probe_host]`, default: `"one.one.one.one"`) so air-gapped or custom-DNS environments can override it. `one.one.one.one` is Cloudflare's well-known resolver hostname — it works on virtually all networks out of the box and is meaningfully less likely to be blocked than `8.8.8.8` (Google) on restricted corporate networks.

**Backoff for transient errors** (only reached when online):

```
backoff_ms = min(base_ms * 2^attempt, max_backoff_ms) + jitter(0..500ms)
```

Defaults (overridable in `[sync.backoff]` config):
```toml
[sync.backoff]
base_ms = 5000
max_backoff_ms = 3600000   # 1 hour
max_attempts = 10          # after which → 'error' state
```

After `max_attempts` → `transitionHealth(..., { type: 'persistent_error', error })`.

`nimbus connector status <name>` shows:
```
State:           degraded (backoff)
Next retry:      in 4m 32s (attempt 3/10)
Last error:      connect ETIMEDOUT api.github.com:443
```

**Test:** `packages/gateway/test/unit/sync/connectivity-guard.test.ts` — mock `isOnline()` returning `false`; run the scheduler dispatch loop; assert no connector's `backoff_attempt` incremented and no `transitionHealth` was called with `transient_error`.

---

### 2.6 Health history table

**New migration:** adds `connector_health_history` table:
```sql
CREATE TABLE connector_health_history (
  id INTEGER PRIMARY KEY,
  connector_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT,
  occurred_at INTEGER NOT NULL   -- unix ms
);
CREATE INDEX idx_chh_connector_occurred ON connector_health_history(connector_id, occurred_at DESC);
```

Prune rows older than 7 days in the existing weekly `retentionDays` pruner.

**New CLI:** `nimbus connector history <name>` — prints a timeline:
```
2026-04-14 09:12  healthy      → rate_limited  (429 from api.github.com; retry after 60s)
2026-04-14 09:13  rate_limited → healthy       (sync succeeded)
2026-04-14 11:45  healthy      → unauthenticated (401 from api.github.com)
```

---

### 2.7 Degraded-state query caveats

**Modify:** `packages/gateway/src/engine/executor.ts` (or the agent's context-building step)

Before returning an agent response, check health states of all connectors whose data was consulted:

```typescript
const degraded = consultedConnectors.filter(
  id => ['degraded', 'error', 'rate_limited', 'unauthenticated'].includes(getHealth(id).state)
);
if (degraded.length > 0) {
  response.caveats = degraded.map(id => buildCaveatString(id));
}
```

Example caveat: `"GitHub connector is currently rate_limited — results may be incomplete (last synced: 3h ago)"`

---

### Workstream 2 Acceptance Criteria

- A connector receiving a 429 enters `rate_limited`; `nimbus connector list` shows the retry-after time; scheduler does not attempt another sync until that window passes
- A connector receiving a 401 transitions to `unauthenticated`; a CLI notification is printed (once); no generic error log appears
- `nimbus connector history github` shows the last 7 days of health transitions
- An agent response drawing on a `degraded` connector includes the caveat string
- All health state tests pass on all three CI platforms

---

## Workstream 3 — Self-Observability

**Depends on:** Workstream 2 (health states must exist)

### 3.1 Index metrics

**Modify:** `packages/gateway/src/db/metrics.ts` (new file)

```typescript
export interface IndexMetrics {
  itemCountByService: Record<string, number>;
  totalItems: number;
  indexSizeBytes: number;
  embeddingCoveragePercent: number;
  lastSuccessfulSyncByConnector: Record<string, Date | null>;
  queryLatencyP50Ms: number;
  queryLatencyP95Ms: number;
}
```

`itemCountByService`: `SELECT source_service, COUNT(*) FROM items GROUP BY source_service`  
`embeddingCoveragePercent`: `COUNT(*) WHERE embedding IS NOT NULL / COUNT(*) * 100`  
Query latency: read from a new `query_latency_log` table (ring buffer, last 1440 rows = 24h at 1/min).

---

### 3.2 Query latency instrumentation

**Modify:** `packages/gateway/src/db/query.ts` (wherever `searchLocalIndex` and `fetchMoreIndexResults` are implemented)

**Implementation: in-memory ring buffer with async batch flush**

Writing a DB row on every read query would force a write transaction after every read, serialising otherwise concurrent reads in WAL mode and degrading index throughput. Instead, latency samples are held in a process-local ring buffer and flushed to SQLite in the background:

```typescript
// packages/gateway/src/db/latency-ring-buffer.ts
const RING_SIZE = 1440;  // ~24h at 1 query/min; circular array, oldest entry overwritten

interface LatencySample {
  latencyMs: number;
  queryType: 'fts' | 'vector' | 'hybrid' | 'sql';
  recordedAt: number;   // unix ms
}

class LatencyRingBuffer {
  private buf: LatencySample[] = new Array(RING_SIZE);
  private head = 0;
  private count = 0;
  private dirty = false;

  push(sample: LatencySample): void {
    this.buf[this.head] = sample;
    this.head = (this.head + 1) % RING_SIZE;
    this.count = Math.min(this.count + 1, RING_SIZE);
    this.dirty = true;
  }

  drain(): LatencySample[] { /* returns ordered snapshot, resets dirty */ }
}

export const latencyBuffer = new LatencyRingBuffer();
```

Query wrapper (no DB call, zero write contention):
```typescript
const start = performance.now();
const results = await runQuery(...);
latencyBuffer.push({ latencyMs: performance.now() - start, queryType, recordedAt: Date.now() });
return results;
```

Background flusher (started once at Gateway init):
```typescript
// Flush every 30s or on Gateway shutdown signal
setInterval(() => flushLatencyBuffer(db, latencyBuffer), 30_000);
process.on('SIGTERM', () => flushLatencyBuffer(db, latencyBuffer));
```

`flushLatencyBuffer` calls `latencyBuffer.drain()` and does a single batched `INSERT` of all pending samples, then prunes rows older than 24h. If `db` is unavailable at flush time the samples are discarded silently — telemetry data loss is acceptable; query correctness is not.

**Percentile computation:** `computeLatencyPercentiles()` reads directly from the in-memory buffer when available (Gateway running), and from the DB table on cold reads (e.g., `nimbus status --verbose` after a restart).

**New migration:** `query_latency_log` table (unchanged — now a batch-write target rather than per-query write):
```sql
CREATE TABLE query_latency_log (
  id INTEGER PRIMARY KEY,
  latency_ms REAL NOT NULL,
  query_type TEXT NOT NULL,   -- 'fts' | 'vector' | 'hybrid' | 'sql'
  recorded_at INTEGER NOT NULL
);
```

**Test:** `packages/gateway/test/unit/db/latency-ring-buffer.test.ts` — push 1500 samples (> RING_SIZE), assert only the last 1440 are retained; assert `drain()` returns them in order and clears the dirty flag; assert `flushLatencyBuffer` emits exactly one batched INSERT.

---

### 3.3 Slow query log

**Modify:** same wrapper as 3.2

Threshold configured via `[db.slow_query_threshold_ms]` (default: 500).

```sql
CREATE TABLE slow_query_log (
  id INTEGER PRIMARY KEY,
  query_text TEXT,
  latency_ms REAL NOT NULL,
  query_type TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
```

**New CLI:** `nimbus diag slow-queries [--limit N] [--since <duration>]`

---

### 3.4 `nimbus status --verbose`

**Modify:** `packages/cli/src/commands/status.ts`

Without `--verbose`: existing output unchanged (Gateway running / stopped, active profile, connected connectors).

With `--verbose`, add a second section:
```
Index
  Total items:          148,432
  By service:           github=42,100  slack=38,200  gdrive=22,100  ...
  Size on disk:         284 MB
  Embedding coverage:   94.2%
  Query latency (24h):  p50=8ms  p95=34ms

Connector Health
  github        healthy     last sync: 2m ago
  slack         healthy     last sync: 11m ago
  gdrive        rate_limited retry in: 4m 12s
  jira          unauthenticated  run: nimbus connector auth jira

Storage
  Snapshots:    3 files, 812 MB
  Disk warning: no
```

---

### 3.5 `nimbus diag`

**New file:** `packages/cli/src/commands/diag.ts`

Subcommands:
- `nimbus diag` (no subcommand) — full snapshot: running connectors, health states, index stats, pending HITL queue depth, active watchers, last 10 audit log entries
- `nimbus diag slow-queries` — from 3.3
- `nimbus diag --json` — machine-readable output for all subcommands

Output format (human-readable default):
```
=== Nimbus Diagnostic Snapshot ===
Timestamp:   2026-04-14T09:32:11Z
Gateway:     running  pid=18432  uptime=14h 22m
Profile:     default

Connectors (6 total)
  github     healthy      last sync: 2m ago
  slack      healthy      last sync: 11m ago
  gdrive     rate_limited retry in: 4m 12s    (429 from googleapis.com)
  ...

Index
  Items: 148,432  |  Size: 284MB  |  Embedding: 94.2%
  Query p50: 8ms  |  Query p95: 34ms

HITL Queue
  Pending actions: 0

Active Watchers (3)
  pr-merged-notify  healthy  last fired: 1h ago
  disk-alert        healthy  never fired
  deploy-watcher    paused

Audit Log (last 10)
  ...
```

---

### 3.6 Prometheus-compatible metrics endpoint

**New file:** `packages/gateway/src/ipc/metrics-server.ts`

- Off by default; enabled via `[metrics] enabled = true` + `port = 9091` (configurable)
- Binds to `127.0.0.1` only — never `0.0.0.0`
- Serves `GET /metrics` in Prometheus text exposition format
- Serves `GET /healthz` → `200 OK` plain text (for process supervisors)

Exposed metrics (all gauges/histograms derived from the data already collected in 3.1–3.3):
```
nimbus_index_items_total{service="github"} 42100
nimbus_index_size_bytes 297795584
nimbus_embedding_coverage_ratio 0.942
nimbus_connector_health_state{connector="github",state="healthy"} 1
nimbus_query_latency_ms_bucket{le="10",...} ...
nimbus_last_sync_timestamp_seconds{connector="github"} 1713088800
```

**Test:** `packages/gateway/test/unit/ipc/metrics-server.test.ts` — start server, fetch `/metrics`, assert Prometheus text format, assert `127.0.0.1` binding, assert disabled by default.

---

### Workstream 3 Acceptance Criteria

- `nimbus status --verbose` reports per-connector health state, index item counts, and p95 query latency on all three platforms
- `nimbus diag` produces a complete snapshot with `--json` output that is valid JSON
- `nimbus diag slow-queries` shows queries that exceeded the threshold
- Prometheus endpoint off by default; when enabled, `GET /metrics` returns valid Prometheus text format and is only accessible on localhost
- Query latency is recorded for every `searchLocalIndex` and `fetchMoreIndexResults` call

---

## Workstream 4 — Configuration Management

**Depends on:** Nothing (self-contained). Can begin immediately after Workstream 1.

### 4.1 `nimbus.toml` schema versioning

**Modify:** `packages/gateway/src/config/schema.ts`

Add `schema_version` field to the config schema (required, integer). Current version: `1`.

Startup validation logic:
1. Parse `nimbus.toml`
2. If `schema_version` is missing → emit warning, assume `0`, apply migration hints
3. If `schema_version > CURRENT_SCHEMA_VERSION` → error: "Config written by a newer Nimbus version. Upgrade Nimbus or downgrade the config."
4. If `schema_version < CURRENT_SCHEMA_VERSION` → print per-version migration hints, do not start
5. Unknown fields → list them by name and exit with a clear error
6. Invalid types → report field path + expected type

---

### 4.2 `nimbus config` CLI

**New file:** `packages/cli/src/commands/config.ts`

Subcommands:

**`nimbus config get <key>`**
```
nimbus config get sync.maxConcurrentSyncs
→ 3  (source: file)
```

**`nimbus config set <key> <value>`**
- Reads existing `nimbus.toml`, updates the key, writes back preserving comments (use `@iarna/toml` or `smol-toml`)
- Validates the entire config after the edit; aborts with error if invalid

**`nimbus config list`**
```
Key                           Value    Source
sync.maxConcurrentSyncs       3        file
sync.retentionDays            90       default
db.snapshots.enabled          true     env (NIMBUS_DB_SNAPSHOTS_ENABLED)
telemetry.enabled             false    default
```

**`nimbus config validate`**
- Parses `nimbus.toml` against schema
- Reports all errors (not just the first)
- Exits `0` if valid, `1` if errors, prints actionable messages

**`nimbus config edit`**
- Opens `nimbus.toml` in `$EDITOR` (or `notepad` on Windows if `EDITOR` unset)

---

### 4.3 Environment variable overrides

**Modify:** `packages/gateway/src/config/loader.ts`

Pattern: `NIMBUS_<SECTION>_<KEY>` (uppercase, underscores). Nested keys flatten with `_`.

Examples:
```bash
NIMBUS_SYNC_MAXCONCURRENTSYNCS=5
NIMBUS_DB_SNAPSHOTS_ENABLED=true
NIMBUS_TELEMETRY_ENABLED=false
```

Override precedence (highest to lowest): env var → `nimbus.toml` → defaults.

`nimbus config list` marks env-overridden values with `env (NIMBUS_...)` in the Source column.

**Test:** `packages/gateway/test/unit/config/env-override.test.ts` — set `NIMBUS_SYNC_RETENTIONDAYS=14` in the test process env, load config, assert `retentionDays === 14`, assert source is `'env'`.

---

### 4.4 Configuration profiles

**Modify:** `packages/gateway/src/config/profiles.ts` (new file)

Profile storage: each profile is a `nimbus.<profileName>.toml` in the config directory (e.g., `~/.config/nimbus/nimbus.work.toml`). The base `nimbus.toml` is the `default` profile.

Vault key prefixing: Vault keys for a non-default profile are prefixed with the profile name (e.g., `work.google.oauth.access_token`). This is handled in `NimbusVault` — add `profilePrefix` parameter to `get`/`set`/`delete`.

**New CLI:** `packages/cli/src/commands/profile.ts`

- `nimbus profile create <name>` — copies base config as a new profile file, writes `profile_name = "<name>"` into it
- `nimbus profile list` — lists profiles; marks active profile with `*`
- `nimbus profile switch <name>` — writes `active_profile = "<name>"` to a Gateway state file; Gateway reloads config on next request
- `nimbus profile delete <name>` — requires `--yes`; warns if Vault keys exist for the profile

`--profile <name>` flag available on all commands (overrides active profile for one invocation).  
`NIMBUS_PROFILE` env var (overrides active profile, overridden by `--profile`).

`nimbus status` shows active profile name next to Gateway status.

---

### Workstream 4 Acceptance Criteria

- `nimbus config validate` reports all schema errors on a deliberately broken `nimbus.toml` and exits `1`
- `nimbus config set sync.retentionDays 60` persists correctly and `nimbus config get` reflects it
- `NIMBUS_SYNC_RETENTIONDAYS=14` overrides file config; `nimbus config list` shows the source
- `nimbus profile create work && nimbus profile switch work` starts the Gateway with the `work` profile; Vault keys for the work profile use the `work.` prefix
- Config tests pass on all three CI platforms

---

## Workstream 5 — Data Layer API & `@nimbus-dev/client`

**Depends on:** Workstream 4 (config profiles affect which index is queried).

### 5.1 `nimbus query` CLI

**New file:** `packages/cli/src/commands/query.ts`

Flags:
```
--service <name>       filter by source_service (repeatable)
--type <type>          filter by item_type (pr, issue, file, message, ...)
--since <duration>     e.g. 7d, 24h, 1w — filters on updated_at
--until <duration>     upper bound (default: now)
--limit <n>            default 50, max 1000
--sql <statement>      raw read-only SELECT; non-SELECT rejected with error
--json                 default output mode
--pretty               human-readable table output
--profile <name>       which profile's index to query
```

Examples:
```bash
nimbus query --service github --type pr --since 7d --json
nimbus query --sql "SELECT title, source_service FROM items WHERE pinned = 1" --pretty
```

SQL safety (layered — both guards must pass):
1. **Keyword blocklist:** parse statement before execution, reject if it contains `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `ATTACH`, `DETACH`, or write-variant `PRAGMA` statements (e.g. `PRAGMA journal_mode=WAL`).
2. **`PRAGMA query_only = 1`:** set on the connection before executing the statement; SQLite itself will reject any mutation attempt that slips past the parser.

Note: `SQLITE_OPEN_READONLY` is **not** used here because `nimbus query` shares the main read-write connection. The two-layer guard above is sufficient for the CLI.

**Test:** `packages/gateway/test/unit/cli/query.test.ts` — assert SQL injection via `--sql "DROP TABLE items"` is rejected at the blocklist layer; assert a crafted statement that bypasses the blocklist is rejected by `PRAGMA query_only`; assert `--since 7d` maps to the correct `updated_at` filter.

---

### 5.2 Read-only local HTTP API

**New file:** `packages/gateway/src/ipc/http-server.ts`

- Off by default; started via `nimbus serve --port 7474` (or `[http] enabled = true; port = 7474` config)
- Binds to `127.0.0.1` only
- No authentication required (localhost-only, read-only)
- Opens its own **dedicated `SQLITE_OPEN_READONLY` connection** to the database — separate from the Gateway's read-write connection. This provides an ironclad driver-level guarantee: SQLite itself will reject any mutation attempt regardless of query content, bypassing any edge-case in the keyword blocklist or `PRAGMA query_only` handling. The HTTP server never touches the main connection.

Endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/items` | Same filter params as `nimbus query`: `service`, `type`, `since`, `until`, `limit` |
| `GET` | `/v1/items/:id` | Single item by `canonical_id` |
| `GET` | `/v1/people` | List from `person` table |
| `GET` | `/v1/people/:id` | Single person by id |
| `GET` | `/v1/connectors` | Connector list with health state |
| `GET` | `/v1/audit` | Last N audit log entries (`?limit=50`) |
| `GET` | `/v1/health` | `{"status":"ok","gateway":"running"}` |

Response format: `{ data: T[], meta: { total: number, limit: number, offset: number } }` for list endpoints.

**Test:** `packages/gateway/test/unit/ipc/http-server.test.ts` — start server on a random port, assert `GET /v1/items` returns valid JSON matching `nimbus query` output for equivalent filters, assert `POST /v1/items` returns `405`, assert that attempting a raw `INSERT` via the HTTP server's internal DB connection throws a SQLite `SQLITE_READONLY` error (proving the `SQLITE_OPEN_READONLY` flag is active).

---

### 5.3 `@nimbus-dev/client` package

**New workspace package:** `packages/client/`

```
packages/client/
  package.json          name: @nimbus-dev/client, license: MIT
  src/
    index.ts            public API surface
    ipc-transport.ts    JSON-RPC 2.0 over domain socket / named pipe (mirrors cli ipc-client)
    http-transport.ts   JSON-RPC over HTTP for the local HTTP API
    mock-client.ts      MockClient for testing scripts without a running Gateway
    types.ts            NimbusItem, NimbusPerson, ConnectorStatus, AuditEntry, ...
  test/
    mock-client.test.ts
  tsconfig.json
  README.md
```

**Public API surface:**
```typescript
export class NimbusClient {
  constructor(options?: { transport?: 'ipc' | 'http'; port?: number; profile?: string });

  // Agent
  agent.invoke(prompt: string, options?: InvokeOptions): Promise<AgentResponse>;

  // Query
  query.items(filters: ItemFilters): Promise<NimbusItem[]>;
  query.item(id: string): Promise<NimbusItem | null>;
  query.people(filters?: PeopleFilters): Promise<NimbusPerson[]>;
  query.sql(statement: string): Promise<Record<string, unknown>[]>;

  // Connectors
  connectors.list(): Promise<ConnectorStatus[]>;
  connectors.health(name: string): Promise<ConnectorHealthSnapshot>;

  // Audit
  audit.list(options?: { limit?: number }): Promise<AuditEntry[]>;

  // Lifecycle
  close(): Promise<void>;
}

export class MockClient implements NimbusClient {
  // In-memory stub — seeded via constructor options
  constructor(fixtures?: MockFixtures);
}
```

**IPC transport:** reuse the existing `packages/cli/src/ipc-client/` logic — do not duplicate it; extract to a shared `packages/client/src/ipc-transport.ts` and have the CLI's `ipc-client/` re-export from it.

---

### 5.4 npm publish pipeline

**New file:** `.github/workflows/publish-client.yml`

Trigger: push of a tag matching `client-v*` (e.g. `client-v0.1.0`).

Steps:
1. `bun install`
2. `bun run typecheck` (client package only)
3. `bun test packages/client/`
4. `bun run build` (client package only — emits `dist/` as ESM + CJS + `.d.ts`)
5. `npm publish --access public` using `NODE_AUTH_TOKEN` secret
6. Create GitHub Release from the tag with auto-generated changelog

**`packages/client/package.json`** fields:
```json
{
  "name": "@nimbus-dev/client",
  "version": "0.1.0",
  "license": "MIT",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist/", "README.md"]
}
```

Build tooling: use `bun build` (already the project standard). CJS wrapper generated via `--target node --format cjs`.

---

### Workstream 5 Acceptance Criteria

- `nimbus query --service github --type pr --since 7d --json` returns a valid JSON array in under 100ms on a 50k-item dataset
- `nimbus query --sql "DROP TABLE items"` is rejected with a clear error
- `GET /v1/items` on the local HTTP API returns data matching `nimbus query` output for equivalent filters
- `MockClient` can be instantiated in a test with fixture data and all methods return typed results without a Gateway process
- `npm publish` workflow publishes `@nimbus-dev/client` on tag push; package is importable as ESM and CJS
- All tests pass on all three CI platforms

---

## Workstream 6 — Telemetry

**Depends on:** Workstream 3 (metrics surface), Workstream 4 (config management for `telemetry.*` keys).

### 6.1 Telemetry infrastructure

**New file:** `packages/gateway/src/telemetry/collector.ts`

- **Disabled by default** — `telemetry.enabled = false` in config schema default
- No data collected, buffered, or transmitted until `telemetry.enabled = true`
- First-run onboarding (Workstream 7) shows an opt-in prompt; does not auto-enable

**Collected fields** (aggregate counters/histograms only — no content, no credentials, no user identifiers):

```typescript
interface TelemetryPayload {
  session_id: string;           // random UUID, rotated every 24h, NOT tied to machine or user
  nimbus_version: string;
  platform: 'win32' | 'darwin' | 'linux';
  // Connectors — counts per type (not per account)
  connector_error_rate: Record<string, number>;
  connector_health_transitions: Record<string, number>;
  // Latency histograms
  query_latency_p50_ms: number;
  query_latency_p95_ms: number;
  query_latency_p99_ms: number;
  agent_invocation_latency_p50_ms: number;
  agent_invocation_latency_p95_ms: number;
  // Sync
  sync_duration_p50_ms: Record<string, number>;  // per connector type
  // Gateway
  cold_start_ms: number;
  // Extensions
  extension_installs_by_id: Record<string, number>;
  extension_uninstalls_by_id: Record<string, number>;
}
```

**Endpoint configuration** (user-configurable — supports self-hosting):
```toml
[telemetry]
enabled = false
endpoint = "https://telemetry.nimbus.dev/v1/ingest"   # default; override for self-hosted
flush_interval_seconds = 3600   # default: 1 hour
```

Any HTTPS URL is accepted as `endpoint`. The telemetry collector sends `POST <endpoint>` with a gzip-compressed JSON body. TLS certificate must be valid (no `rejectUnauthorized = false`).

---

### 6.2 `nimbus telemetry show`

**New file:** `packages/cli/src/commands/telemetry.ts`

`nimbus telemetry show` — prints the exact payload that would be sent on the next flush, formatted as pretty JSON. Works whether telemetry is enabled or disabled (shows what *would* be sent). Useful for inspecting before opting in.

`nimbus telemetry disable` — sets `telemetry.enabled = false`, clears the local buffer, prints confirmation.

---

### 6.3 Payload safety test

**New test:** `packages/gateway/test/unit/telemetry/payload-safety.test.ts`

- Seed the test Gateway with items containing real-looking content (file names, email subjects, PR titles)
- Seed Vault with a fake credential
- Flush a telemetry payload
- Assert: payload contains none of the seeded content strings
- Assert: payload contains none of the seeded credential substrings
- Assert: payload is valid JSON matching `TelemetryPayload` type

This test is a **non-negotiable gate** — it must pass before telemetry can ship.

---

### Workstream 6 Acceptance Criteria

- `nimbus telemetry show` displays the exact payload with no content or credential fields; payload matches `TelemetryPayload` type
- Setting `telemetry.endpoint = "https://custom.example.com/ingest"` causes the collector to POST to that URL
- Payload safety test passes — no content, no credentials in any payload field
- Telemetry is disabled by default; no network calls are made until explicitly enabled
- `nimbus telemetry disable` clears the buffer and stops transmission

---

## Workstream 7 — Onboarding

**Depends on:** Workstream 2 (connector health), Workstream 3 (diag), Workstream 4 (config).

### 7.1 `nimbus doctor`

**New file:** `packages/cli/src/commands/doctor.ts`

Checks (in order):

| # | Check | Pass condition |
|---|---|---|
| 1 | Bun version | `≥ 1.2.0` |
| 2 | Keystore availability | DPAPI/Keychain/libsecret accessible |
| 3 | IPC socket permissions | Socket/pipe exists and is writable |
| 4 | Gateway reachable | `gateway.ping` responds within 2s |
| 5 | Config valid | `nimbus config validate` exits 0 |
| 6 | Disk space | `<80%` of threshold (from Workstream 1.6) |
| 7 | Connected connectors | At least one connector in `healthy` or `paused` state |
| 8 | Connector health | No connector in `unauthenticated` or `error` state |
| 9 | Index populated | At least 1 item in the index |
| 10 | Embedding model | Model file present and version ≥ `MINIMUM_MODEL_VERSION` |

Output format:
```
nimbus doctor
  [✓] Bun version: 1.2.4
  [✓] Keystore: available (DPAPI)
  [✓] IPC socket: /tmp/nimbus.sock — writable
  [✓] Gateway: reachable (ping 4ms)
  [✓] Config: valid
  [✓] Disk: 34% used (threshold 80%)
  [⚠] Connectors: jira is unauthenticated — run: nimbus connector auth jira
  [✓] Index: 148,432 items
  [✓] Embedding model: all-MiniLM-L6-v2 v2.1 ✓

1 warning. Run the suggested commands above to resolve.
```

Exit codes: `0` = all pass, `1` = at least one warning, `2` = at least one failure.

**Test for Linux headless keystore:** `packages/gateway/test/unit/doctor/keystore.test.ts` — mock `libsecret` unavailable (e.g., `SECRET_SERVICE` env unset), assert check fails with the message: `"Keystore unavailable. On headless Linux, run: eval $(gnome-keyring-daemon --start)"`.

---

### 7.2 First-run wizard

**Modify:** `packages/gateway/src/ipc/server.ts` + `packages/cli/src/commands/start.ts`

Trigger: `nimbus start` on a fresh install (no `nimbus.toml` found, or `nimbus.toml` exists but has zero connectors configured).

Wizard steps (interactive TTY):
```
Welcome to Nimbus!

Step 1/4 — Platform check
  Running nimbus doctor...  [all checks passed]

Step 2/4 — Connect your first service
  Which service would you like to connect first?
  > GitHub (recommended)
    Google Drive
    Slack
    Jira
    (skip — I'll add connectors later)

Step 3/4 — Authenticate
  Opening browser for GitHub OAuth...
  [waiting for callback...]
  ✓ GitHub authenticated. Starting initial sync...

Step 4/4 — First query
  Your GitHub data is indexed (1,204 items).
  Try: nimbus ask "what PRs did I review this week?"

  Run 'nimbus' to open the interactive session.
```

Non-TTY / `--no-wizard` flag: skip the wizard silently (for CI, Docker, headless use).

---

### 7.3 Empty state guidance

**Modify:** `packages/gateway/src/engine/executor.ts` (agent response path)

When `nimbus ask` is invoked and the local index is empty (zero items):
```
No data indexed yet.

To get started, connect a service:
  nimbus connector auth github
  nimbus connector auth google
  nimbus connector auth slack

Then check sync status with:
  nimbus connector list
```

When the index has items but the query matches nothing (genuine empty result):
```
No results found for: "who reviewed the auth refactor"

Tips:
  - Try broader terms: "auth PR reviews"
  - Check if the relevant connector is synced: nimbus connector status github
  - Run nimbus doctor to check system health
```

---

### Workstream 7 Acceptance Criteria

- `nimbus doctor` detects a missing keystore session on Linux headless and prints the remediation step
- `nimbus doctor` exits `2` when the Gateway is unreachable, `1` when a connector is `unauthenticated`, `0` when all checks pass
- `nimbus start` on a fresh install launches the wizard in a TTY; `--no-wizard` skips it
- `nimbus ask "anything"` on a zero-item index returns the onboarding prompt instead of an empty result
- All onboarding tests pass on all three CI platforms

---

## Workstream 8 — Extension Testing Infrastructure

**Depends on:** Workstream 5 (`@nimbus-dev/client` provides `MockClient`).

### 8.1 `nimbus test` command

**New file:** `packages/cli/src/commands/test.ts`

Runs the extension's test suite inside a sandboxed environment:
1. Validate the extension's `nimbus.extension.json` manifest (same validation as Registry startup)
2. Re-verify entry-point SHA-256
3. Inject a `MockGateway` environment (from `@nimbus-dev/sdk`) into the test process
4. Execute `bun test` in the extension's directory with `NIMBUS_ENV=test` and `NIMBUS_MOCK_GATEWAY=1`
5. Stream output to the terminal; exit code propagates

The `MockGateway` provided to the test process enforces the same HITL gate as the real Gateway — write tools declared in `hitlRequired` must receive a consent token or they throw.

---

### 8.2 Connector contract tests

**Modify:** `packages/sdk/src/index.ts`

Export `runContractTests(server: MCPServer): Promise<void>` — a helper that verifies:
- `list` tool exists, accepts `{ limit?: number; offset?: number }`, returns `NimbusItem[]`
- `get` tool exists, accepts `{ id: string }`, returns `NimbusItem | null`
- `search` tool exists, accepts `{ query: string }`, returns `NimbusItem[]`
- All tools declared in `hitlRequired` exist

Failure mode: throws a `ContractViolationError` listing all violations. Compatible with `bun test` `expect` matchers.

---

### 8.3 Official CI template

**New file:** `docs/contributors/nimbus-extension-ci.yml` (referenced from the extension author walkthrough)

```yaml
name: Extension CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - run: bun install
      - run: bun run build
      - run: npx nimbus test        # or: bunx nimbus test
      - run: bun audit --audit-level high
```

Published in `docs/contributors/extension-author-walkthrough.md` (update existing file).

---

### Workstream 8 Acceptance Criteria

- A fresh extension scaffold (`nimbus scaffold extension`) passes `nimbus test` and the contract tests before any custom logic is added
- A contract violation (missing `list` tool) is reported as a `ContractViolationError` with the tool name
- `nimbus test` on a valid extension exits `0`; on a failing test exits `1`
- The CI template file is lint-clean valid YAML

---

## Workstream 9 — Documentation Site

**Depends on:** All other workstreams (documents their CLIs and APIs).

### 9.1 Workspace setup

**New workspace package:** `packages/docs/`

```
packages/docs/
  package.json          name: @nimbus-dev/docs  (private: true)
  astro.config.mjs
  src/
    content/
      docs/
        getting-started/
          index.mdx
          install.mdx
          first-connector.mdx
          first-query.mdx
        connectors/
          index.mdx
          github.mdx
          google-drive.mdx
          ...  (one page per connector)
        cli/
          index.mdx       (auto-generated from command definitions)
          query.mdx
          config.mdx
          ...
        sdk/
          index.mdx
          extension-tutorial.mdx
          mock-gateway.mdx
        client/
          index.mdx
          usage-examples.mdx
        architecture/
          overview.mdx
        faq.mdx
    assets/
  public/
  tsconfig.json
```

**Astro Starlight config (`astro.config.mjs`):**
```javascript
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import pagefind from 'astro-pagefind';   // built-in to Starlight — no extra dep

export default defineConfig({
  integrations: [
    starlight({
      title: 'Nimbus',
      social: { github: 'https://github.com/nimbus-dev/nimbus' },
      sidebar: [ /* auto-generated from content/ structure */ ],
      customCss: ['./src/assets/custom.css'],
    }),
    pagefind(),
  ],
});
```

---

### 9.2 Content plan

Each section is a distinct writing task. Priority order for solo authoring (unblocks the most with the least rework):

1. **Getting started** — install → auth one connector → first query (completable in <10 min on all 3 platforms)
2. **FAQ** — "why is my connector degraded?", "how do I reset auth?", "what does Nimbus store?", "how do I uninstall?", "what is HITL?"
3. **CLI reference** — auto-generate from command definitions via a `scripts/gen-cli-docs.ts` script that reads command metadata and emits MDX; covers all subcommands with flags, examples, exit codes
4. **Connector reference** — one page per connector (auth method, credentials, indexed types, tools, HITL tools, rate limits, known limitations)
5. **SDK reference** — `@nimbus-dev/sdk` API auto-generated from TypeScript types + JSDoc via `typedoc-plugin-markdown`
6. **`@nimbus-dev/client` reference** — same tooling as SDK reference
7. **Architecture overview** — condensed `architecture.md` for contributors

---

### 9.3 Versioning

Starlight content collections support versioned docs via subdirectory prefixes.

```
src/content/docs/
  v0.1.0/        ← frozen at release
  latest/        ← mirrors main (banner: "This is unreleased documentation")
```

CI step: before cutting a release tag, run `scripts/freeze-docs.ts` which copies `latest/` → `v<version>/` and adds a version banner component.

---

### 9.4 Deployment

**New file:** `.github/workflows/deploy-docs.yml`

Trigger: push to `main` (deploys `latest/`); push of a release tag (deploys frozen version).

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: cd packages/docs && bunx astro build
      - uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CF_PAGES_TOKEN }}
          projectName: nimbus-docs
          directory: packages/docs/dist
```

Cloudflare Pages (free tier) handles CDN, HTTPS, and preview deployments per PR.

**Link checker:** `bunx lychee --config .lychee.toml packages/docs/dist/` in CI; `.lychee.toml` excludes external URLs from broken-link checks (only internal links checked).

---

### 9.5 `nimbus docs` CLI shortcut

**New subcommand:** `nimbus docs [topic]`  
Opens `https://docs.nimbus.dev/<topic>` (or the locally configured docs URL) in the default browser.

Examples:
```bash
nimbus docs                    # opens home
nimbus docs connectors/github  # opens GitHub connector page
nimbus docs faq                # opens FAQ
```

---

### Workstream 9 Acceptance Criteria

- `bunx astro build` in `packages/docs/` completes without errors
- Link checker reports zero broken internal links
- Getting started guide is completable in under 10 minutes on a clean machine on all three platforms
- `GET /pagefind/pagefind.js` is present in the build output (search index generated)
- `v0.1.0` docs are frozen at release; `latest/` docs show the unreleased banner
- Docs deploy workflow runs on push to `main` without failures

---

## Cross-Cutting Concerns

### Testing additions per workstream

| Workstream | New test files | Coverage gate |
|---|---|---|
| 1 — Data Integrity | `db/verify.test.ts`, `db/repair.test.ts`, `db/migration-rollback.test.ts` | ≥85% `packages/gateway/src/db/` |
| 2 — Connector Health | `connectors/health.test.ts`, `sync/rate-limit-aware-scheduler.test.ts`, `sync/connectivity-guard.test.ts` | ≥85% `connectors/health.ts` |
| 3 — Observability | `db/metrics.test.ts`, `db/latency-ring-buffer.test.ts`, `ipc/metrics-server.test.ts` | ≥80% `db/metrics.ts` |
| 4 — Config | `config/env-override.test.ts`, `config/profiles.test.ts` | ≥80% `config/` |
| 5 — Data Layer | `cli/query.test.ts`, `ipc/http-server.test.ts`, `client/mock-client.test.ts` | ≥80% `packages/client/` |
| 6 — Telemetry | `telemetry/payload-safety.test.ts` | ≥85% `telemetry/` |
| 7 — Onboarding | `doctor/keystore.test.ts`, `doctor/doctor.test.ts` | ≥80% `doctor/` |
| 8 — Extensions | `sdk/contract-tests.test.ts` | ≥85% `packages/sdk/` |

All new tests must pass on the existing 3-platform CI matrix (`ubuntu-latest`, `windows-latest`, `macos-latest`).

### Migrations checklist

Every database change in this phase adds a numbered migration. Keep this list updated:

| # | Migration | Workstream |
|---|---|---|
| N+1 | Add health state columns to `sync_state` | 2 |
| N+2 | Add `connector_health_history` table | 2.6 |
| N+3 | Add `query_latency_log` table | 3.2 |
| N+4 | Add `slow_query_log` table | 3.3 |

Each migration must have a pre-migration backup (Workstream 1.3) and a rollback path (Workstream 1.4). Migrations are developed in Workstream 1 order before the workstreams that need them run.

### `nimbus.toml` new keys introduced in this phase

```toml
schema_version = 1

[db]
slow_query_threshold_ms = 500
disk_check_interval_hours = 6
disk_warning_threshold_percent = 80

[db.snapshots]
enabled = true
schedule = "0 2 * * *"
keep_last = 7

[db.backups]
keep_days = 30

[metrics]
enabled = false
port = 9091

[http]
enabled = false
port = 7474

[sync.backoff]
base_ms = 5000
max_backoff_ms = 3600000
max_attempts = 10

[telemetry]
enabled = false
endpoint = "https://telemetry.nimbus.dev/v1/ingest"
flush_interval_seconds = 3600
```

---

## Phase 3.5 Acceptance Criteria (consolidated)

All of the following must pass on **Windows, macOS, and Linux** before Phase 4 begins.  
Legend: **[x] code on `main` — [ ] not yet signed off** (verify on each OS before ticking).

- [x] `nimbus status --verbose` reports per-connector health state, index item counts, and p95 query latency *[ ] sign off three-platform*
- [x] A 429 response transitions a connector to `rate_limited`; `nimbus connector list` shows retry-after time; scheduler respects the window *[ ] sign off three-platform*
- [x] `nimbus query --service github --type pr --since 7d --json` returns valid JSON *[ ] < 100ms @ 50k items — benchmark / sign off*
- [x] `GET /v1/items` on the local HTTP API returns data matching `nimbus query` for equivalent filters *(shared `buildItemListSql`)* *[ ] sign off three-platform*
- [x] `nimbus db verify` detects a manually introduced FTS5 rowid mismatch and exits non-zero *[ ] sign off three-platform*
- [x] `nimbus db repair` resolves the mismatch; `verify` exits `0` afterward *[ ] sign off three-platform*
- [x] A failed migration restores from pre-migration backup; Gateway exits with an actionable error; no partial schema remains *[ ] sign off three-platform*
- [x] `nimbus telemetry show` displays a payload with no content or credential fields; payload safety test passes *[ ] sign off three-platform*
- [x] Setting `telemetry.endpoint` to a custom URL causes the collector to POST there *[ ] sign off three-platform*
- [x] Docs site link checker reports zero broken internal links *(Starlight production build)* *[ ] getting-started <10 min — editorial / sign off all OS*
- [x] A scaffolded extension passes `nimbus test` and contract tests before any custom logic is added *[ ] sign off from clean scaffold once per release train*
- [x] `nimbus doctor` detects a missing Linux headless keystore and prints the remediation step *[ ] sign off Linux CI + headless smoke*
- [x] `@nimbus-dev/client` publish workflow on tag `client-v*`; `MockClient` works without a Gateway process; dual **ESM + CJS** `dist/` build *[ ] first npm publish done (manual)*
- [x] Telemetry coverage gate in CI (`bun run test:coverage:telemetry`) *[ ] full cross-cutting coverage table vs `_test-suite.yml` — reconcile intentionally*
- [ ] `bun audit --audit-level high` clean across all Phase 3.5 packages

