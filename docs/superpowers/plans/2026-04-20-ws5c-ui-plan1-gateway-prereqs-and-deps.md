# WS5-C UI — Plan 1: Gateway Prerequisites + UI Dependencies

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the five Gateway-side additions the WS5-C Settings UI depends on (§2.4) and install the four UI dependencies (§7 commit 2) so every later plan can ship pure UI code with no Gateway or dependency edits.

**Architecture:** Additive only. New schema migration V21 persists `depth` per connector; existing IPC handlers extend their param/return shapes backward-compatibly; a new `connector.configChanged` notification is emitted on every mutation; `data.import` rejects incompatible archives before any destructive work via a typed error; UI gets four new dependencies (`zxcvbn`, `react-window`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-clipboard-manager`) plus Tauri capability entries.

**Tech Stack:** Bun v1.2+ · TypeScript 6.x strict · `bun:test` for Gateway · Vitest for UI · Biome. No new runtime dependency is added on the Gateway side. Four new UI dependencies; no changes to existing UI dep versions.

**Parent spec:** [`docs/superpowers/specs/2026-04-19-ws5c-settings-design.md`](../specs/2026-04-19-ws5c-settings-design.md) — §2.4 (Gateway additions) + §7 commits 1–2.

**Branching strategy:** One feature branch `dev/asafgolombek/ws5c-ui` off `dev/asafgolombek/phase_4_ws5`. All five WS5-C UI plans (this one + four to follow) commit to this branch; a single PR targets the umbrella branch when the stack is complete.

---

## Pre-flight (do once before Task 1)

- [ ] **Step A — Create feature branch**

```bash
git checkout dev/asafgolombek/phase_4_ws5
git pull
git checkout -b dev/asafgolombek/ws5c-ui
```

- [ ] **Step B — Confirm baseline green**

```bash
bun install
bun run typecheck
bun test --bail
cd packages/ui && bunx vitest run && cd ../..
```

Expected: all existing tests pass. If anything is red on `dev/asafgolombek/phase_4_ws5`, stop and fix the pre-existing failure before continuing.

- [ ] **Step C — Read the relevant patterns once**

Open each of these files and skim the indicated sections; every task below will mirror the shape:

- `packages/gateway/src/index/connector-health-v13-sql.ts` — how a migration SQL file is structured (single exported `const ... = \`...\``).
- `packages/gateway/src/index/migrations/runner.ts` around lines 290–350 — how a new migration step is registered (function + `INDEXED_SCHEMA_STEPS` entry + `BACKFILL_LABELS` entry).
- `packages/gateway/src/index/migrations/runner-v20.test.ts` — `bun:test` pattern for a migration test (`:memory:` DB, run migrations, assert table shape).
- `packages/gateway/src/ipc/connector-rpc-handlers.ts` lines 88–110 — `ConnectorRpcHandlerContext` type; lines 210–236 — `handleConnectorSetConfig` current shape.
- `packages/gateway/src/ipc/data-rpc.ts` lines 17–25 — `DataRpcContext.notify` callback signature; lines 75–95 — `handleDataImport`.
- `packages/gateway/src/ipc/profile-rpc.ts` line 42 — `ctx.notify?.("profile.switched", ...)` — the notification emit shape WS5-C follows.
- `packages/gateway/src/commands/data-import.ts` — `runDataImport` structure; the schemaVersion check lands right after manifest parse, before any vault writes.
- `packages/gateway/src/db/backup-manifest.ts` — `BackupManifest` type; we bump `version: 1` → `version: 2` and add `schema_version: number`.

---

## Phase 1 — Schema migration V21 (sync_state.depth)

Adds a persistent per-connector `depth` column so `connector.setConfig` can store it and `connector.listStatus` can return it.

### Task 1: V21 migration SQL module

**Files:**
- Create: `packages/gateway/src/index/connector-depth-v21-sql.ts`

- [ ] **Step 1: Create the SQL module**

Write this exact file:

```ts
/**
 * Phase 4 Workstream 5-C — Persistent per-connector `depth` (user_version 21).
 *
 * Adds a `depth` column to `sync_state` so the Connectors panel can read and
 * write a connector's default reindex depth. Existing rows default to 'summary'
 * (the historical implicit default at reindex time).
 *
 * `depth` is consumed by UI-triggered reindex calls as the default when no
 * explicit depth parameter is supplied; routine scheduler sync is unaffected.
 */

export const CONNECTOR_DEPTH_V21_SQL = `
ALTER TABLE sync_state ADD COLUMN depth TEXT NOT NULL DEFAULT 'summary'
  CHECK(depth IN ('metadata_only','summary','full'));
`;
```

### Task 2: Wire V21 into the migration runner

**Files:**
- Modify: `packages/gateway/src/index/migrations/runner.ts`
- Modify: `packages/gateway/src/index/local-index.ts` (SCHEMA_VERSION bump)

- [ ] **Step 1: Add the import for V21 SQL**

In `packages/gateway/src/index/migrations/runner.ts`, insert (alphabetically, near the existing `LAN_PEERS_V19_SQL` import around line 30):

```ts
import { CONNECTOR_DEPTH_V21_SQL } from "../connector-depth-v21-sql.ts";
```

- [ ] **Step 2: Add the migration function**

Below `migrateIndexedV19ToV20` (around line 304), insert:

```ts
function migrateIndexedV20ToV21(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(CONNECTOR_DEPTH_V21_SQL);
    db.exec("PRAGMA user_version = 21");
    recordMigration(db, 21, "sync_state.depth (per-connector reindex depth)", now);
  })();
}
```

- [ ] **Step 3: Register the step in `INDEXED_SCHEMA_STEPS`**

Append to the `INDEXED_SCHEMA_STEPS` array (around line 327):

```ts
  { fromVersion: 20, toVersion: 21, apply: migrateIndexedV20ToV21 },
```

- [ ] **Step 4: Add the backfill label**

Append to the `BACKFILL_LABELS` array (around line 350):

```ts
  "sync_state.depth (per-connector reindex depth) (backfilled)",
```

- [ ] **Step 5: Bump `SCHEMA_VERSION`**

In `packages/gateway/src/index/local-index.ts` line 266, change:

```ts
static readonly SCHEMA_VERSION = 20;
```

to:

```ts
static readonly SCHEMA_VERSION = 21;
```

### Task 3: V21 migration test

**Files:**
- Create: `packages/gateway/src/index/migrations/runner-v21.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runIndexedSchemaMigrations } from "./runner.ts";

describe("V21 migration — sync_state.depth", () => {
  test("adds depth column with default 'summary'", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    const cols = db.query(`PRAGMA table_info(sync_state)`).all() as Array<{
      name: string;
      dflt_value: string | null;
      notnull: number;
    }>;
    const depth = cols.find((c) => c.name === "depth");
    expect(depth).toBeDefined();
    expect(depth?.notnull).toBe(1);
    expect(depth?.dflt_value).toBe("'summary'");
  });

  test("inserts row respects the default", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    db.run(
      `INSERT INTO sync_state (connector_id, last_sync_at, next_sync_token) VALUES (?, ?, ?)`,
      ["github", null, null],
    );
    const row = db.query(`SELECT depth FROM sync_state WHERE connector_id = ?`).get("github") as
      | { depth: string }
      | undefined;
    expect(row?.depth).toBe("summary");
  });

  test("CHECK constraint rejects unknown depth values", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    db.run(
      `INSERT INTO sync_state (connector_id, last_sync_at, next_sync_token) VALUES (?, ?, ?)`,
      ["gh", null, null],
    );
    expect(() =>
      db.run(`UPDATE sync_state SET depth = 'bogus' WHERE connector_id = 'gh'`),
    ).toThrow(/CHECK/);
  });

  test("is idempotent", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    runIndexedSchemaMigrations(db, 21);
    const cols = db.query(`PRAGMA table_info(sync_state)`).all() as Array<{ name: string }>;
    expect(cols.filter((c) => c.name === "depth")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test, expect PASS**

```bash
bun test packages/gateway/src/index/migrations/runner-v21.test.ts
```

Expected: 4 passing tests. If any fail, check the SQL/runner wiring from Task 2.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/index/connector-depth-v21-sql.ts \
        packages/gateway/src/index/migrations/runner.ts \
        packages/gateway/src/index/migrations/runner-v21.test.ts \
        packages/gateway/src/index/local-index.ts
git commit -m "feat(index): V21 migration adds sync_state.depth column"
```

---

## Phase 2 — `LocalIndex.setConnectorDepth` + `getConnectorDepth`

### Task 4: Add the failing test first

**Files:**
- Test: `packages/gateway/src/index/local-index-depth.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LocalIndex } from "./local-index.ts";

function makeIndex(): LocalIndex {
  const db = new Database(":memory:");
  const idx = LocalIndex.fromDatabase(db);
  idx.registerConnector("github", { label: "GitHub" });
  return idx;
}

describe("LocalIndex.setConnectorDepth / getConnectorDepth", () => {
  test("default depth on a freshly registered connector is 'summary'", () => {
    const idx = makeIndex();
    expect(idx.getConnectorDepth("github")).toBe("summary");
  });

  test("setConnectorDepth persists a new depth value", () => {
    const idx = makeIndex();
    idx.setConnectorDepth("github", "full", Date.now());
    expect(idx.getConnectorDepth("github")).toBe("full");
  });

  test("setConnectorDepth is idempotent for the same value", () => {
    const idx = makeIndex();
    const now = Date.now();
    idx.setConnectorDepth("github", "metadata_only", now);
    idx.setConnectorDepth("github", "metadata_only", now + 1);
    expect(idx.getConnectorDepth("github")).toBe("metadata_only");
  });

  test("getConnectorDepth for an unknown connector throws", () => {
    const idx = makeIndex();
    expect(() => idx.getConnectorDepth("notexist")).toThrow(/unknown|not registered/i);
  });
});
```

- [ ] **Step 2: Run and expect FAIL**

```bash
bun test packages/gateway/src/index/local-index-depth.test.ts
```

Expected: every test fails with `TypeError: idx.setConnectorDepth is not a function` (or equivalent).

### Task 5: Implement `setConnectorDepth` + `getConnectorDepth`

**Files:**
- Modify: `packages/gateway/src/index/local-index.ts`

- [ ] **Step 1: Locate the insertion point**

Open `packages/gateway/src/index/local-index.ts` and find the existing `setConnectorSyncIntervalMs` method (around line 406). The new methods sit immediately after it — same file, same indent, same pattern.

- [ ] **Step 2: Add the two methods**

Insert directly after `setConnectorSyncIntervalMs`:

```ts
/**
 * Persist the default reindex depth for a connector.
 *
 * `depth` is consumed by UI-triggered reindex calls as the default when no
 * explicit depth parameter is supplied. Routine scheduler sync is unaffected.
 * Throws if `serviceId` is not a registered connector.
 */
setConnectorDepth(serviceId: string, depth: "metadata_only" | "summary" | "full", now: number): void {
  const rows = this.db
    .query(`UPDATE sync_state SET depth = ?, last_sync_at = last_sync_at WHERE connector_id = ?`)
    .run(depth, serviceId);
  if (rows.changes === 0) {
    // Row doesn't exist yet — insert with this depth.
    this.db.run(
      `INSERT INTO sync_state (connector_id, last_sync_at, next_sync_token, depth) VALUES (?, NULL, NULL, ?)`,
      [serviceId, depth],
    );
  }
  // Touch-only: `now` is reserved for future audit integration; unused today.
  void now;
}

/**
 * Read the persisted depth for a connector. Returns the column value, which
 * defaults to 'summary' for rows that existed before V21.
 * Throws if `serviceId` is not a registered connector.
 */
getConnectorDepth(serviceId: string): "metadata_only" | "summary" | "full" {
  const row = this.db
    .query(`SELECT depth FROM sync_state WHERE connector_id = ?`)
    .get(serviceId) as { depth: string } | undefined;
  if (row === undefined) {
    throw new Error(`unknown connector: ${serviceId}`);
  }
  return row.depth as "metadata_only" | "summary" | "full";
}
```

- [ ] **Step 3: Run the test, expect PASS**

```bash
bun test packages/gateway/src/index/local-index-depth.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/index/local-index.ts \
        packages/gateway/src/index/local-index-depth.test.ts
git commit -m "feat(index): LocalIndex.setConnectorDepth + getConnectorDepth (V21)"
```

---

## Phase 3 — Extend `SyncStatus` with `depth` + `enabled`

Makes `connector.listStatus` return the two fields the Connectors panel needs so it can populate the depth selector and enable toggle with current values.

### Task 6: Extend the `SyncStatus` interface

**Files:**
- Modify: `packages/gateway/src/sync/types.ts`

- [ ] **Step 1: Add the two fields**

In `packages/gateway/src/sync/types.ts` line 107–120, replace the `SyncStatus` interface with:

```ts
export interface SyncStatus {
  serviceId: string;
  status: "ok" | "syncing" | "paused" | "backoff" | "error";
  lastSyncAt: number | null;
  nextSyncAt: number | null;
  intervalMs: number;
  itemCount: number;
  lastError: string | null;
  consecutiveFailures: number;
  /** Phase 3.5 — `sync_state.health_state` (connector health). */
  healthState?: string;
  /** Epoch ms for `sync_state.retry_after` when rate-limited; otherwise `null`. */
  healthRetryAfterMs?: number | null;
  /** Phase 4 WS5-C — per-connector default reindex depth (V21). */
  depth: "metadata_only" | "summary" | "full";
  /** Phase 4 WS5-C — true when the connector is NOT paused. */
  enabled: boolean;
}
```

### Task 7: Update `SyncScheduler.rowToStatus` to populate `depth` + `enabled`

**Files:**
- Modify: `packages/gateway/src/sync/scheduler.ts`
- Test: `packages/gateway/src/sync/scheduler-status-shape.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LocalIndex } from "../index/local-index.ts";
import { SyncScheduler } from "./scheduler.ts";

function setup(): { idx: LocalIndex; sched: SyncScheduler } {
  const db = new Database(":memory:");
  const idx = LocalIndex.fromDatabase(db);
  idx.registerConnector("github", { label: "GitHub" });
  const sched = new SyncScheduler({ index: idx });
  return { idx, sched };
}

describe("SyncScheduler.getStatus — depth + enabled shape (V21)", () => {
  test("returns depth='summary' and enabled=true for a fresh connector", () => {
    const { sched } = setup();
    const statuses = sched.getStatus();
    const gh = statuses.find((s) => s.serviceId === "github");
    expect(gh?.depth).toBe("summary");
    expect(gh?.enabled).toBe(true);
  });

  test("reflects persisted depth after setConnectorDepth", () => {
    const { idx, sched } = setup();
    idx.setConnectorDepth("github", "full", Date.now());
    const gh = sched.getStatus().find((s) => s.serviceId === "github");
    expect(gh?.depth).toBe("full");
  });

  test("enabled=false after pause", () => {
    const { sched } = setup();
    sched.pause("github");
    const gh = sched.getStatus().find((s) => s.serviceId === "github");
    expect(gh?.enabled).toBe(false);
    expect(gh?.status).toBe("paused");
  });
});
```

- [ ] **Step 2: Run and expect FAIL**

```bash
bun test packages/gateway/src/sync/scheduler-status-shape.test.ts
```

Expected: `depth` and `enabled` are `undefined` on the returned rows.

- [ ] **Step 3: Update `rowToStatus` in `scheduler.ts`**

Open `packages/gateway/src/sync/scheduler.ts` and locate `rowToStatus` around line 316. Add the two fields to the returned object. The final shape:

```ts
private rowToStatus(serviceId: string, row: SchedulerStateRow, itemCount: number): SyncStatus {
  let status: SyncStatus["status"];
  if (row.paused === 1) {
    status = "paused";
  } else if (this.inFlight.has(serviceId)) {
    status = "syncing";
  } else if (row.status === "error") {
    status = "error";
  } else if (row.status === "backoff") {
    status = "backoff";
  } else {
    status = "ok";
  }
  const health = getConnectorHealth(this.deps.index.getDatabase(), serviceId);
  const depth = this.deps.index.getConnectorDepth(serviceId);
  return {
    serviceId,
    status,
    lastSyncAt: row.last_sync_at,
    nextSyncAt: row.next_sync_at,
    intervalMs: row.interval_ms,
    itemCount,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    ...(health.healthState !== undefined ? { healthState: health.healthState } : {}),
    healthRetryAfterMs:
      health.retryAfter === undefined ? null : health.retryAfter.getTime(),
    depth,
    enabled: status !== "paused",
  };
}
```

- [ ] **Step 4: Run the test, expect PASS**

```bash
bun test packages/gateway/src/sync/scheduler-status-shape.test.ts
```

Expected: all 3 tests pass.

### Task 8: Update `LocalIndex.rowToPersistedSyncStatus` to populate `depth` + `enabled`

**Files:**
- Modify: `packages/gateway/src/index/local-index.ts`
- Test: `packages/gateway/src/index/local-index-status-shape.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LocalIndex } from "./local-index.ts";

describe("LocalIndex.persistedConnectorStatuses — depth + enabled shape (V21)", () => {
  test("returns depth='summary' and enabled=true for a fresh connector", () => {
    const db = new Database(":memory:");
    const idx = LocalIndex.fromDatabase(db);
    idx.registerConnector("github", { label: "GitHub" });
    const rows = idx.persistedConnectorStatuses();
    const gh = rows.find((r) => r.serviceId === "github");
    expect(gh?.depth).toBe("summary");
    expect(gh?.enabled).toBe(true);
  });

  test("enabled=false after pauseConnectorSync", () => {
    const db = new Database(":memory:");
    const idx = LocalIndex.fromDatabase(db);
    idx.registerConnector("github", { label: "GitHub" });
    idx.pauseConnectorSync("github");
    const gh = idx.persistedConnectorStatuses().find((r) => r.serviceId === "github");
    expect(gh?.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run and expect FAIL**

```bash
bun test packages/gateway/src/index/local-index-status-shape.test.ts
```

- [ ] **Step 3: Update `rowToPersistedSyncStatus`**

Open `packages/gateway/src/index/local-index.ts` and locate `rowToPersistedSyncStatus` (around line 307). Replace the returned object to include the two fields. Final shape:

```ts
private rowToPersistedSyncStatus(db: Database, row: PersistedSyncRow): SyncStatus {
  let status: SyncStatus["status"];
  if (row.paused === 1) {
    status = "paused";
  } else if (row.status === "error") {
    status = "error";
  } else if (row.status === "backoff") {
    status = "backoff";
  } else {
    status = "ok";
  }
  const health = getConnectorHealth(db, row.connector_id);
  const depth = (row.depth ?? "summary") as "metadata_only" | "summary" | "full";
  return {
    serviceId: row.connector_id,
    status,
    lastSyncAt: row.last_sync_at,
    nextSyncAt: row.next_sync_at,
    intervalMs: row.interval_ms,
    itemCount: row.item_count,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    ...(health.healthState !== undefined ? { healthState: health.healthState } : {}),
    healthRetryAfterMs:
      health.retryAfter === undefined ? null : health.retryAfter.getTime(),
    depth,
    enabled: status !== "paused",
  };
}
```

You will also need to extend `PersistedSyncRow` (the same file, search for that type) with `depth?: string | null` so the SELECT can carry the column through. Extend the SELECT in `persistedConnectorStatuses` (around line 334) to include `depth`.

- [ ] **Step 4: Run the test, expect PASS**

```bash
bun test packages/gateway/src/index/local-index-status-shape.test.ts
```

- [ ] **Step 5: Run the full index + sync test suites to check for regressions**

```bash
bun test packages/gateway/src/index packages/gateway/src/sync
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/sync/types.ts \
        packages/gateway/src/sync/scheduler.ts \
        packages/gateway/src/sync/scheduler-status-shape.test.ts \
        packages/gateway/src/index/local-index.ts \
        packages/gateway/src/index/local-index-status-shape.test.ts
git commit -m "feat(sync): SyncStatus exposes depth + enabled from V21"
```

---

## Phase 4 — `connector.setConfig` accepts `depth` + enforces 60 s minimum

### Task 9: Write failing handler tests

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc-handlers.test.ts` (find existing test file and append; create if none exists)

First check whether the test file exists:

```bash
ls packages/gateway/src/ipc/connector-rpc*.test.ts
```

If a matching test file exists, append the new `describe` block. Otherwise, create `packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts` with the same import patterns as existing handler tests.

- [ ] **Step 1: Write the failing tests**

Append (or create) with this block:

```ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LocalIndex } from "../index/local-index.ts";
import { SyncScheduler } from "../sync/scheduler.ts";
import { ConnectorRpcError, handleConnectorSetConfig } from "./connector-rpc-handlers.ts";

function setup(): { idx: LocalIndex; sched: SyncScheduler } {
  const db = new Database(":memory:");
  const idx = LocalIndex.fromDatabase(db);
  idx.registerConnector("github", { label: "GitHub" });
  const sched = new SyncScheduler({ index: idx });
  return { idx, sched };
}

describe("handleConnectorSetConfig — depth + 60s minimum", () => {
  test("persists depth and returns it in the response", () => {
    const { idx, sched } = setup();
    const notifications: Array<{ method: string; params: unknown }> = [];
    const result = handleConnectorSetConfig({
      rec: { service: "github", depth: "full" },
      localIndex: idx,
      syncScheduler: sched,
      notify: (m, p) => notifications.push({ method: m, params: p }),
    });
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      const v = result.value as { service: string; depth: string };
      expect(v.service).toBe("github");
      expect(v.depth).toBe("full");
    }
    expect(idx.getConnectorDepth("github")).toBe("full");
  });

  test("rejects an unknown depth value with -32602", () => {
    const { idx, sched } = setup();
    expect(() =>
      handleConnectorSetConfig({
        rec: { service: "github", depth: "bogus" },
        localIndex: idx,
        syncScheduler: sched,
        notify: () => {},
      }),
    ).toThrow(ConnectorRpcError);
  });

  test("rejects intervalMs < 60000 with message naming 60 seconds", () => {
    const { idx, sched } = setup();
    let thrown: ConnectorRpcError | null = null;
    try {
      handleConnectorSetConfig({
        rec: { service: "github", intervalMs: 30_000 },
        localIndex: idx,
        syncScheduler: sched,
        notify: () => {},
      });
    } catch (err) {
      thrown = err as ConnectorRpcError;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.code).toBe(-32602);
    expect(thrown?.message).toMatch(/60.*seconds|60000/);
  });

  test("accepts intervalMs === 60000 exactly", () => {
    const { idx, sched } = setup();
    const result = handleConnectorSetConfig({
      rec: { service: "github", intervalMs: 60_000 },
      localIndex: idx,
      syncScheduler: sched,
      notify: () => {},
    });
    expect(result.kind).toBe("hit");
  });
});
```

- [ ] **Step 2: Run and expect FAIL on all four tests**

```bash
bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
```

### Task 10: Update the handler

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc-handlers.ts`

- [ ] **Step 1: Extend `ConnectorRpcHandlerContext` with a `notify` callback**

Around line 88, add the `notify` field. Final shape:

```ts
export type ConnectorRpcHandlerContext = {
  rec: Record<string, unknown>;
  localIndex: LocalIndex;
  syncScheduler?: SyncScheduler;
  notify?: (method: string, params: Record<string, unknown>) => void;
};
```

Update any dispatcher call sites that construct this context (check `packages/gateway/src/ipc/connector-rpc.ts` and the main `server.ts` dispatch switch) to pass `notify` through. If existing call sites omit `notify`, that's fine — the field is optional.

- [ ] **Step 2: Replace the `handleConnectorSetConfig` body**

Around line 210, replace the entire function with:

```ts
const MIN_SYNC_INTERVAL_MS = 60_000;
const VALID_DEPTHS = ["metadata_only", "summary", "full"] as const;

export function handleConnectorSetConfig(ctx: ConnectorRpcHandlerContext): ConnectorRpcHit {
  const { rec, localIndex, syncScheduler, notify } = ctx;
  const id = requireRegisteredSchedulerServiceId(rec, localIndex);
  const intervalMs = rec?.["intervalMs"];
  const depth = rec?.["depth"];
  const enabled = rec?.["enabled"];

  if (typeof intervalMs === "number") {
    if (!Number.isFinite(intervalMs)) {
      throw new ConnectorRpcError(-32602, "Invalid intervalMs");
    }
    const ms = Math.floor(intervalMs);
    if (ms < MIN_SYNC_INTERVAL_MS) {
      throw new ConnectorRpcError(
        -32602,
        `intervalMs must be >= ${MIN_SYNC_INTERVAL_MS} (60 seconds)`,
      );
    }
    localIndex.setConnectorSyncIntervalMs(id, ms, Date.now());
    if (syncScheduler !== undefined) {
      syncScheduler.setInterval(id, ms);
    }
  }

  if (typeof depth === "string") {
    if (!VALID_DEPTHS.includes(depth as (typeof VALID_DEPTHS)[number])) {
      throw new ConnectorRpcError(
        -32602,
        `Invalid depth: must be ${VALID_DEPTHS.join("|")}`,
      );
    }
    localIndex.setConnectorDepth(
      id,
      depth as "metadata_only" | "summary" | "full",
      Date.now(),
    );
  }

  if (typeof enabled === "boolean") {
    applyEnabledChange(enabled, id, syncScheduler, localIndex);
  }

  // Notification wiring lands in Phase 5 Task 12 — not yet emitted here.

  return {
    kind: "hit",
    value: {
      service: id,
      intervalMs: typeof intervalMs === "number" ? Math.floor(intervalMs) : null,
      depth: typeof depth === "string" ? depth : null,
      enabled: typeof enabled === "boolean" ? enabled : null,
    },
  };
}
```

- [ ] **Step 3: Run the failing tests, expect PASS**

```bash
bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
```

Expected: all 4 pass.

- [ ] **Step 4: Run the full connector test suite, expect no regressions**

```bash
bun test packages/gateway/src/ipc/connector-rpc
```

Expected: passing.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/ipc/connector-rpc-handlers.ts \
        packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
git commit -m "feat(ipc): connector.setConfig accepts depth + enforces 60s min intervalMs"
```

---

## Phase 5 — `connector.configChanged` notification

### Task 11: Write failing notification test

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
describe("handleConnectorSetConfig — connector.configChanged notification", () => {
  test("emits connector.configChanged with the full snapshot after mutations", () => {
    const { idx, sched } = setup();
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    handleConnectorSetConfig({
      rec: { service: "github", intervalMs: 120_000, depth: "full", enabled: false },
      localIndex: idx,
      syncScheduler: sched,
      notify: (m, p) => notifications.push({ method: m, params: p }),
    });
    const fired = notifications.find((n) => n.method === "connector.configChanged");
    expect(fired).toBeDefined();
    expect(fired?.params).toEqual({
      service: "github",
      intervalMs: 120_000,
      depth: "full",
      enabled: false,
    });
  });

  test("emits exactly once per call, regardless of how many fields change", () => {
    const { idx, sched } = setup();
    const notifications: Array<{ method: string; params: unknown }> = [];
    handleConnectorSetConfig({
      rec: { service: "github", intervalMs: 90_000 },
      localIndex: idx,
      syncScheduler: sched,
      notify: (m, p) => notifications.push({ method: m, params: p as Record<string, unknown> }),
    });
    expect(
      notifications.filter((n) => n.method === "connector.configChanged"),
    ).toHaveLength(1);
  });

  test("payload reflects current persisted state, not just the changed field", () => {
    const { idx, sched } = setup();
    // Pre-set depth; now mutate intervalMs only.
    idx.setConnectorDepth("github", "full", Date.now());
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    handleConnectorSetConfig({
      rec: { service: "github", intervalMs: 180_000 },
      localIndex: idx,
      syncScheduler: sched,
      notify: (m, p) => notifications.push({ method: m, params: p }),
    });
    const fired = notifications.find((n) => n.method === "connector.configChanged");
    expect(fired?.params.depth).toBe("full");
    expect(fired?.params.intervalMs).toBe(180_000);
    expect(fired?.params.enabled).toBe(true); // not paused
  });
});
```

- [ ] **Step 2: Run and expect FAIL (no notification yet)**

```bash
bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
```

### Task 12: Emit `connector.configChanged` from the handler

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc-handlers.ts`

- [ ] **Step 1: Replace the "Notification wiring lands in Phase 5" comment with the emit**

In `handleConnectorSetConfig`, just before the `return` statement, replace the placeholder comment with:

```ts
if (notify !== undefined) {
  // Read back the full snapshot so downstream observers see the post-mutation truth,
  // not just the fields that changed in this call.
  const statuses = localIndex.persistedConnectorStatuses(id);
  const current = statuses[0];
  notify("connector.configChanged", {
    service: id,
    intervalMs: current?.intervalMs ?? (typeof intervalMs === "number" ? Math.floor(intervalMs) : 0),
    depth: current?.depth ?? (typeof depth === "string" ? depth : "summary"),
    enabled: current?.enabled ?? (typeof enabled === "boolean" ? enabled : true),
  });
}
```

- [ ] **Step 2: Run the failing tests, expect PASS**

```bash
bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
```

Expected: all 7 tests pass (4 from Task 10 + 3 from Task 11).

### Task 13: Emit `connector.configChanged` from `pause` / `resume` / `setInterval` too

Spec §2.4 #3 says the event fires after *any* mutation path, not only `setConfig`.

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc-handlers.ts`
- Test: append to `packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the existing test file:

```ts
import { handleConnectorPause, handleConnectorResume, handleConnectorSetInterval } from "./connector-rpc-handlers.ts";

describe("connector.configChanged — emitted from pause/resume/setInterval as well", () => {
  test("handleConnectorPause emits configChanged with enabled:false", () => {
    const { idx, sched } = setup();
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    handleConnectorPause({
      rec: { service: "github" },
      localIndex: idx,
      syncScheduler: sched,
      notify: (m, p) => notifications.push({ method: m, params: p }),
    });
    const fired = notifications.find((n) => n.method === "connector.configChanged");
    expect(fired?.params.enabled).toBe(false);
  });

  test("handleConnectorResume emits configChanged with enabled:true", () => {
    const { idx, sched } = setup();
    sched.pause("github");
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    handleConnectorResume({
      rec: { service: "github" },
      localIndex: idx,
      syncScheduler: sched,
      notify: (m, p) => notifications.push({ method: m, params: p }),
    });
    const fired = notifications.find((n) => n.method === "connector.configChanged");
    expect(fired?.params.enabled).toBe(true);
  });

  test("handleConnectorSetInterval emits configChanged with new intervalMs", () => {
    const { idx, sched } = setup();
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    handleConnectorSetInterval({
      rec: { service: "github", intervalMs: 120_000 },
      localIndex: idx,
      syncScheduler: sched,
      notify: (m, p) => notifications.push({ method: m, params: p }),
    });
    const fired = notifications.find((n) => n.method === "connector.configChanged");
    expect(fired?.params.intervalMs).toBe(120_000);
  });
});
```

- [ ] **Step 2: Run and expect FAIL**

```bash
bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
```

- [ ] **Step 3: Extract a shared helper and use it in all four handlers**

In `packages/gateway/src/ipc/connector-rpc-handlers.ts`, add this helper near `applyEnabledChange`:

```ts
function emitConfigChanged(
  notify: ((method: string, params: Record<string, unknown>) => void) | undefined,
  localIndex: LocalIndex,
  serviceId: string,
): void {
  if (notify === undefined) return;
  const statuses = localIndex.persistedConnectorStatuses(serviceId);
  const current = statuses[0];
  if (current === undefined) return;
  notify("connector.configChanged", {
    service: serviceId,
    intervalMs: current.intervalMs,
    depth: current.depth,
    enabled: current.enabled,
  });
}
```

Then:

- Replace the inline emit in `handleConnectorSetConfig` with `emitConfigChanged(notify, localIndex, id)`.
- Add `emitConfigChanged(notify, localIndex, id)` as the last statement before `return` in `handleConnectorPause`, `handleConnectorResume`, and `handleConnectorSetInterval`.

- [ ] **Step 4: Run the tests, expect PASS**

```bash
bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
```

- [ ] **Step 5: Run the full connector test suite + dispatcher tests**

```bash
bun test packages/gateway/src/ipc/connector-rpc
```

Expected: passing.

### Task 14: Thread `notify` through the connector dispatcher

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc.ts`
- Modify: `packages/gateway/src/ipc/server.ts` (if the connector dispatcher is invoked from there with a narrower context)

- [ ] **Step 1: Inspect the current dispatcher**

```bash
head -40 packages/gateway/src/ipc/connector-rpc.ts
```

Look at how the context is built before calling into `handleConnectorSetConfig` and friends.

- [ ] **Step 2: Thread `notify` through**

If the dispatcher already receives a `notify` parameter (check the function signature — look for `notify: (method: string, params: ...) => void`), pass it into every handler-context object literal.

If it does not, add `notify` as a parameter and have `server.ts` pass the same socket-write function it uses for other notifications. Follow the pattern already present in `packages/gateway/src/ipc/data-rpc.ts` lines 17–25 and `packages/gateway/src/ipc/profile-rpc.ts` line 14.

Specific targets (the call sites that construct `ConnectorRpcHandlerContext` inside the dispatcher): every `return handleConnector*(...)` or equivalent should have `notify` present in its context object.

- [ ] **Step 3: Run the full connector and server IPC test suites**

```bash
bun test packages/gateway/src/ipc
```

Expected: all passing. Any regression likely indicates a call site where `notify` was not threaded through — the tests don't fail, but the dispatcher-level test for `connector.configChanged` would.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/ipc/connector-rpc-handlers.ts \
        packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts \
        packages/gateway/src/ipc/connector-rpc.ts \
        packages/gateway/src/ipc/server.ts
git commit -m "feat(ipc): emit connector.configChanged on every mutation path"
```

---

## Phase 6 — `data.import` schemaVersion compatibility check

### Task 15: Extend `BackupManifest` with `schema_version`

**Files:**
- Modify: `packages/gateway/src/db/backup-manifest.ts`
- Modify: `packages/gateway/src/db/backup-manifest.test.ts` (append — file exists)
- Modify: `packages/gateway/src/commands/data-export.ts` (thread `schemaVersion` through)
- Modify: `packages/gateway/src/ipc/data-rpc.ts` (pass `schemaVersion`)

- [ ] **Step 1: Append the failing tests to the existing `backup-manifest.test.ts`**

File exists already and uses `bun:test`. Append (inside the existing `describe("backup manifest", ...)` block or in a new sibling `describe`):

```ts
  test("buildManifest populates version=2 and schema_version when supplied", async () => {
    const dir = tmp();
    const p = join(dir, "test.bin");
    writeFileSync(p, "hello");
    const m = await buildManifest({
      bundleDir: dir,
      nimbusVersion: "0.1.0",
      schemaVersion: 21,
      platform: "linux",
      contents: {
        index_rows: 0,
        vault_entries: 1,
        watchers: 0,
        workflows: 0,
        extensions: 0,
        profiles: 1,
      },
      files: { "test.bin": p },
      indexIncluded: false,
    });
    expect(m.version).toBe(2);
    expect(m.schema_version).toBe(21);
  });

  test("verifyManifest accepts both version=1 (legacy) and version=2 (current) shapes", async () => {
    const dir = tmp();
    const p = join(dir, "x.bin");
    writeFileSync(p, "hello");
    const m1 = {
      version: 1 as const,
      nimbus_version: "0.0.9",
      created_at: "2026-01-01T00:00:00Z",
      platform: "linux" as const,
      contents: {
        index_rows: 0,
        index_included: false,
        vault_entries: 0,
        watchers: 0,
        workflows: 0,
        extensions: 0,
        profiles: 0,
      },
      hashes: { "x.bin": await blake3HashFile(p) },
    };
    const r1 = await verifyManifest(m1, { "x.bin": p });
    expect(r1.ok).toBe(true);
  });
```

- [ ] **Step 2: Run and expect FAIL (the new `schemaVersion` and `version=2` assertions fail)**

```bash
bun test packages/gateway/src/db/backup-manifest.test.ts
```

- [ ] **Step 3: Implement**

Update `packages/gateway/src/db/backup-manifest.ts`. Full replacement shape:

```ts
import { readFile } from "node:fs/promises";
import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";

export type BackupManifest = {
  version: 2;
  nimbus_version: string;
  schema_version: number;
  created_at: string;
  platform: "win32" | "darwin" | "linux";
  contents: {
    index_rows: number;
    index_included: boolean;
    vault_entries: number;
    watchers: number;
    workflows: number;
    extensions: number;
    profiles: number;
  };
  hashes: Record<string, string>;
};

/** Legacy shape for archives produced before the V21 schema-version bump. */
export type LegacyBackupManifestV1 = Omit<BackupManifest, "version" | "schema_version"> & {
  version: 1;
};

export async function blake3HashFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return bytesToHex(blake3(new Uint8Array(buf)));
}

export async function buildManifest(input: {
  bundleDir: string;
  nimbusVersion: string;
  schemaVersion: number;
  platform: "win32" | "darwin" | "linux";
  contents: Omit<BackupManifest["contents"], "index_included">;
  files: Record<string, string>;
  indexIncluded: boolean;
}): Promise<BackupManifest> {
  const hashes: Record<string, string> = {};
  for (const [name, absPath] of Object.entries(input.files)) {
    hashes[name] = await blake3HashFile(absPath);
  }
  return {
    version: 2,
    nimbus_version: input.nimbusVersion,
    schema_version: input.schemaVersion,
    created_at: new Date().toISOString(),
    platform: input.platform,
    contents: { ...input.contents, index_included: input.indexIncluded },
    hashes,
  };
}

export type ManifestVerifyResult = { ok: boolean; firstMismatch?: string };

export async function verifyManifest(
  manifest: BackupManifest | LegacyBackupManifestV1,
  files: Record<string, string>,
): Promise<ManifestVerifyResult> {
  for (const [name, expected] of Object.entries(manifest.hashes)) {
    const actualPath = files[name];
    if (actualPath === undefined) return { ok: false, firstMismatch: name };
    const actual = await blake3HashFile(actualPath);
    if (actual !== expected) return { ok: false, firstMismatch: name };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Extend `runDataExport` to accept + thread `schemaVersion`**

Open `packages/gateway/src/commands/data-export.ts`:

1. Extend `RunDataExportInput` (around line 19) with a required field:

```ts
  schemaVersion: number;
```

2. In the `runDataExport` body, find the `buildManifest` call (around line 79) and add:

```ts
    schemaVersion: input.schemaVersion,
```

to the object passed to `buildManifest`.

- [ ] **Step 5: Update the IPC caller**

Open `packages/gateway/src/ipc/data-rpc.ts`. The `DataRpcContext` around line 15 already has `nimbusVersion: string`. Add:

```ts
  schemaVersion: number;
```

Then in the `handleDataExport` call to `runDataExport` (around line 58), add:

```ts
    schemaVersion: ctx.schemaVersion,
```

Finally, the `DataRpcContext` is constructed in `packages/gateway/src/ipc/server.ts`. Find the construction site:

```bash
grep -n "nimbusVersion:" packages/gateway/src/ipc/server.ts
```

Add `schemaVersion: LocalIndex.SCHEMA_VERSION` next to `nimbusVersion:` (import `LocalIndex` from `../index/local-index.ts` if not already imported).

- [ ] **Step 6: Update `data-export.test.ts` and `data-import.test.ts`**

Every `runDataExport({ ... })` in these two test files currently passes `nimbusVersion: "0.1.0"`. Add `schemaVersion: 21` next to each (21 is the current `LocalIndex.SCHEMA_VERSION` after Phase 1).

```bash
grep -n "nimbusVersion" packages/gateway/src/commands/data-export.test.ts packages/gateway/src/commands/data-import.test.ts
```

For each hit, add a `schemaVersion: 21,` line immediately after.

- [ ] **Step 7: Run the test, expect PASS**

```bash
bun test packages/gateway/src/db/backup-manifest.test.ts packages/gateway/src/commands/data-export.test.ts
```

Expected: all passing. Existing `data-import.test.ts` will still pass because its bundles now contain `schema_version: 21` and import will not yet check it (the check lands in Task 17).

### Task 16: `runDataImport` rejects on schemaVersion mismatch

**Files:**
- Modify: `packages/gateway/src/commands/data-import.ts` (typed error + check)
- Modify: `packages/gateway/src/commands/data-import.test.ts` (append tests)

- [ ] **Step 1: Append the failing tests**

The test file already imports `memVault` / `newIndex` / `runDataExport` / `runDataImport`. Append this `describe` block at the end of the file:

```ts
import { DataImportVersionError } from "./data-import.ts";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";

async function stageBundle(schemaVersion: number): Promise<string> {
  const sourceVault = memVault();
  await sourceVault.set("github.pat", "secret_value");
  const outPath = join(mkdtempSync(join(tmpdir(), `nimbus-sv${schemaVersion}-`)), "b.tar.gz");
  await runDataExport({
    output: outPath,
    includeIndex: false,
    passphrase: "pw",
    vault: sourceVault,
    index: newIndex(),
    platform: "linux",
    nimbusVersion: "0.1.0",
    schemaVersion, // controls the manifest.schema_version in the bundle
    kdfParams: { t: 1, m: 1024, p: 1 } as const,
  });
  return outPath;
}

describe("runDataImport — schemaVersion compatibility check", () => {
  test("rejects a bundle with schema_version > current as archive_newer", async () => {
    const bundle = await stageBundle(99);
    const err = await runDataImport({
      bundlePath: bundle,
      passphrase: "pw",
      vault: memVault(),
      index: newIndex(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DataImportVersionError);
    expect((err as DataImportVersionError).archiveSchemaVersion).toBe(99);
    expect((err as DataImportVersionError).relation).toBe("archive_newer");
  });

  test("rejects a bundle with schema_version < current as archive_older_unsupported", async () => {
    const bundle = await stageBundle(10);
    const err = await runDataImport({
      bundlePath: bundle,
      passphrase: "pw",
      vault: memVault(),
      index: newIndex(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DataImportVersionError);
    expect((err as DataImportVersionError).archiveSchemaVersion).toBe(10);
    expect((err as DataImportVersionError).relation).toBe("archive_older_unsupported");
  });

  test("rejects a legacy v1 manifest as archive_older_unsupported (archiveSchemaVersion=0)", async () => {
    // Build a real bundle, then manually rewrite manifest.json to legacy v1 shape.
    const bundle = await stageBundle(21);
    const stage = mkdtempSync(join(tmpdir(), "nimbus-legacy-stage-"));
    execSync(`tar -xzf ${bundle} -C ${stage}`);
    const manifestPath = join(stage, "manifest.json");
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    const legacy = { ...parsed, version: 1 };
    delete legacy.schema_version;
    writeFileSync(manifestPath, JSON.stringify(legacy, null, 2));
    const legacyBundle = join(stage, "legacy.tar.gz");
    execSync(`tar -czf ${legacyBundle} -C ${stage} .`);

    const err = await runDataImport({
      bundlePath: legacyBundle,
      passphrase: "pw",
      vault: memVault(),
      index: newIndex(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DataImportVersionError);
    expect((err as DataImportVersionError).archiveSchemaVersion).toBe(0);
    expect((err as DataImportVersionError).relation).toBe("archive_older_unsupported");
  });

  test("no vault writes occur when schema_version is incompatible", async () => {
    const bundle = await stageBundle(99);
    const targetVault = memVault();
    await runDataImport({
      bundlePath: bundle,
      passphrase: "pw",
      vault: targetVault,
      index: newIndex(),
    }).catch(() => {});
    expect(await targetVault.get("github.pat")).toBeNull();
  });

  test("happy path — matching schema_version restores credentials", async () => {
    const bundle = await stageBundle(21); // matches LocalIndex.SCHEMA_VERSION after Phase 1
    const targetVault = memVault();
    const result = await runDataImport({
      bundlePath: bundle,
      passphrase: "pw",
      vault: targetVault,
      index: newIndex(),
    });
    expect(result.credentialsRestored).toBe(1);
    expect(await targetVault.get("github.pat")).toBe("secret_value");
  });
});
```

- [ ] **Step 2: Run and expect FAIL on all five new tests**

```bash
bun test packages/gateway/src/commands/data-import.test.ts
```

Expected: the five new tests fail because `DataImportVersionError` is not exported yet and `runDataImport` does not perform the version check. The three pre-existing tests in the file continue to pass (they use matching schema_version).

### Task 17: Implement the schemaVersion check and export the typed error

**Files:**
- Modify: `packages/gateway/src/commands/data-import.ts`
- Modify: `packages/gateway/src/ipc/data-rpc.ts` (maps typed error → JSON-RPC -32010)

- [ ] **Step 1: Add the typed error + version check**

Open `packages/gateway/src/commands/data-import.ts` and edit:

Just after the imports (before line 10), add:

```ts
import { LocalIndex } from "../index/local-index.ts";

export class DataImportVersionError extends Error {
  readonly archiveSchemaVersion: number;
  readonly currentSchemaVersion: number;
  readonly relation: "archive_newer" | "archive_older_unsupported";
  constructor(
    archiveSchemaVersion: number,
    currentSchemaVersion: number,
    relation: "archive_newer" | "archive_older_unsupported",
  ) {
    super(
      `Data archive is from an incompatible Nimbus schema version ` +
      `(archive=${archiveSchemaVersion}, current=${currentSchemaVersion}, ${relation})`,
    );
    this.name = "DataImportVersionError";
    this.archiveSchemaVersion = archiveSchemaVersion;
    this.currentSchemaVersion = currentSchemaVersion;
    this.relation = relation;
  }
}

function checkSchemaVersion(manifest: { version: number; schema_version?: number }): void {
  const current = LocalIndex.SCHEMA_VERSION;
  const archive = manifest.version === 2 && typeof manifest.schema_version === "number"
    ? manifest.schema_version
    : 0; // legacy v1 archives report 0, always rejected as archive_older_unsupported.
  if (archive === current) return;
  const relation: "archive_newer" | "archive_older_unsupported" =
    archive > current ? "archive_newer" : "archive_older_unsupported";
  throw new DataImportVersionError(archive, current, relation);
}
```

- [ ] **Step 2: Insert the check into `runDataImport`**

Directly after the manifest is parsed and verified (around the existing `verifyManifest` call), add:

```ts
  checkSchemaVersion(manifest as unknown as { version: number; schema_version?: number });
```

This must run **before** any vault write, before `decryptVaultManifest`, before anything that mutates state. Place it immediately after the `if (!verify.ok) { throw ... }` block.

- [ ] **Step 3a: Extend `DataRpcError` and `RpcMethodError` to carry structured `data`**

The JSON-RPC framer in `packages/gateway/src/ipc/jsonrpc.ts:111` already accepts an optional `data?: unknown` argument to `errorResponse`. But `DataRpcError` (line 24–31 of `data-rpc.ts`) and `RpcMethodError` (line 49–56 of `server.ts`) don't carry it. Extend both.

In `packages/gateway/src/ipc/data-rpc.ts`, replace the class:

```ts
export class DataRpcError extends Error {
  readonly rpcCode: number;
  readonly rpcData?: Record<string, unknown>;
  constructor(rpcCode: number, message: string, rpcData?: Record<string, unknown>) {
    super(message);
    this.name = "DataRpcError";
    this.rpcCode = rpcCode;
    if (rpcData !== undefined) {
      this.rpcData = rpcData;
    }
  }
}
```

In `packages/gateway/src/ipc/server.ts` line 49–56, replace `RpcMethodError`:

```ts
class RpcMethodError extends Error {
  readonly rpcCode: number;
  readonly rpcData?: Record<string, unknown>;
  constructor(rpcCode: number, message: string, rpcData?: Record<string, unknown>) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "RpcMethodError";
    if (rpcData !== undefined) {
      this.rpcData = rpcData;
    }
  }
}
```

Update the `errorResponse` call at line 269 to pass `rpcData`:

```ts
        session.writeOutbound(errorResponse(id, e.rpcCode, e.message, e.rpcData));
```

Update the `DataRpcError` catch at line 453:

```ts
      if (e instanceof DataRpcError) throw new RpcMethodError(e.rpcCode, e.message, e.rpcData);
```

- [ ] **Step 3b: Map the typed error in the data dispatcher**

Open `packages/gateway/src/ipc/data-rpc.ts`. At the top, add:

```ts
import { DataImportVersionError } from "../commands/data-import.ts";
```

Replace the body of `handleDataImport` (around line 75–95) with:

```ts
async function handleDataImport(
  rec: Record<string, unknown>,
  ctx: DataRpcContext,
): Promise<unknown> {
  const { index, vault } = requireDeps(ctx);
  const bundlePath = rec["bundlePath"];
  const passphrase = rec["passphrase"];
  const recoverySeed = rec["recoverySeed"];
  if (typeof bundlePath !== "string" || bundlePath === "")
    throw new DataRpcError(-32602, "Missing param: bundlePath");
  ctx.notify?.("data.importProgress", { stage: "unpacking", bytesRead: 0, totalBytes: 0 });
  try {
    const result = await runDataImport({
      bundlePath,
      ...(typeof passphrase === "string" ? { passphrase } : {}),
      ...(typeof recoverySeed === "string" ? { recoverySeed } : {}),
      vault,
      index,
    });
    ctx.notify?.("data.importCompleted", { credentialsRestored: result.credentialsRestored });
    return result;
  } catch (err) {
    if (err instanceof DataImportVersionError) {
      throw new DataRpcError(-32010, err.message, {
        kind: "version_incompatible",
        archiveSchemaVersion: err.archiveSchemaVersion,
        currentSchemaVersion: err.currentSchemaVersion,
        relation: err.relation,
      });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run the tests, expect PASS**

```bash
bun test packages/gateway/src/commands/data-import.test.ts packages/gateway/src/ipc/data-rpc
```

Expected: all passing. If any pre-existing `data-rpc` tests break because the error response shape changed, update them to match the new `-32010` + `data.kind` contract.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/backup-manifest.ts \
        packages/gateway/src/db/backup-manifest.test.ts \
        packages/gateway/src/commands/data-import.ts \
        packages/gateway/src/commands/data-import.test.ts \
        packages/gateway/src/commands/data-export.ts \
        packages/gateway/src/ipc/data-rpc.ts
git commit -m "feat(data): schema_version in backup manifest + import rejects incompatible archives"
```

---

## Phase 7 — UI dependency install

### Task 18: Install zxcvbn + react-window

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `bun.lock` (auto-updated)

- [ ] **Step 1: Install runtime deps**

```bash
cd packages/ui
bun add zxcvbn@^4.4.2 react-window@^1.8.10
bun add --dev @types/zxcvbn @types/react-window
cd ../..
```

- [ ] **Step 2: Verify the package.json diff**

```bash
git diff packages/ui/package.json
```

Expect new `"zxcvbn"` and `"react-window"` entries under `dependencies`, and `@types/*` entries under `devDependencies`.

### Task 19: Install Tauri JS plugins for dialog + clipboard

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src-tauri/Cargo.toml`
- Modify: `packages/ui/src-tauri/capabilities/default.json`

- [ ] **Step 1: Install the JS sides**

```bash
cd packages/ui
bun add @tauri-apps/plugin-dialog@^2 @tauri-apps/plugin-clipboard-manager@^2
cd ../..
```

- [ ] **Step 2: Add the Rust sides to Cargo.toml**

In `packages/ui/src-tauri/Cargo.toml`, append to `[dependencies]`:

```toml
tauri-plugin-dialog = "2"
tauri-plugin-clipboard-manager = "2"
```

- [ ] **Step 3: Register the plugins in `lib.rs`**

In `packages/ui/src-tauri/src/lib.rs`, find the `tauri::Builder::default()` chain around line 26. Immediately after `.plugin(tauri_plugin_shell::init())` (or wherever shell is registered), add:

```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
```

- [ ] **Step 4: Extend the capability file**

In `packages/ui/src-tauri/capabilities/default.json`, add these permission strings to the existing `"permissions"` array (keep alphabetical if that's the existing convention):

```json
  "clipboard-manager:allow-write-text",
  "clipboard-manager:allow-clear",
  "dialog:allow-save",
  "dialog:allow-open",
```

- [ ] **Step 5: Verify the Tauri app still builds**

```bash
cd packages/ui/src-tauri
cargo check
cd ../../..
```

Expected: `Checking ...` output with no errors. First run will download the new plugins and will take ~1–2 minutes.

- [ ] **Step 6: Verify TypeScript and UI tests still pass**

```bash
cd packages/ui
bunx tsc --noEmit
bunx vitest run
cd ../..
```

Expected: type-check clean, existing tests pass (we haven't used the new deps yet — no test regressions expected).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/package.json \
        bun.lock \
        packages/ui/src-tauri/Cargo.toml \
        packages/ui/src-tauri/Cargo.lock \
        packages/ui/src-tauri/src/lib.rs \
        packages/ui/src-tauri/capabilities/default.json
git commit -m "chore(ui): add zxcvbn, react-window, tauri-plugin-dialog, tauri-plugin-clipboard-manager"
```

---

## Wrap-up

### Task 20: Run the full test suite once

- [ ] **Step 1: Run everything**

```bash
bun run typecheck
bun test
cd packages/ui && bunx vitest run && cd ../..
```

Expected: all passing. Any failure is a regression — fix it before handing off.

- [ ] **Step 2: Confirm the commit chain is clean**

```bash
git log --oneline dev/asafgolombek/phase_4_ws5..HEAD
```

Expected output (order may vary but the set should match):

```
xxxxxxx chore(ui): add zxcvbn, react-window, tauri-plugin-dialog, tauri-plugin-clipboard-manager
xxxxxxx feat(data): schema_version in backup manifest + import rejects incompatible archives
xxxxxxx feat(ipc): emit connector.configChanged on every mutation path
xxxxxxx feat(ipc): connector.setConfig accepts depth + enforces 60s min intervalMs
xxxxxxx feat(sync): SyncStatus exposes depth + enabled from V21
xxxxxxx feat(index): LocalIndex.setConnectorDepth + getConnectorDepth (V21)
xxxxxxx feat(index): V21 migration adds sync_state.depth column
```

- [ ] **Step 3: Push the branch**

```bash
git push -u origin dev/asafgolombek/ws5c-ui
```

(Do NOT open the PR yet. Plans 2–5 add more commits to the same branch. The PR opens after Plan 5 lands.)

---

## Completion criteria

Plan 1 is complete when every checkbox above is ticked **and**:

- [ ] `bun run typecheck` passes at the repo root.
- [ ] `bun test` passes at the repo root.
- [ ] `bunx vitest run` passes in `packages/ui/`.
- [ ] `cargo check` passes in `packages/ui/src-tauri/`.
- [ ] Seven commits listed under "Wrap-up Step 2" are all present.
- [ ] The branch `dev/asafgolombek/ws5c-ui` is pushed to origin.

After completion, proceed to **Plan 2: Shell + Rust bridge + Profiles + Telemetry** (not yet written).
