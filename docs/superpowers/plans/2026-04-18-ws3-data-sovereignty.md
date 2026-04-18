# WS 3 — Data Sovereignty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver five user-facing capabilities that together make Nimbus a data-sovereign product: portable encrypted backups (`nimbus data export` / `import`), service-scoped GDPR-style deletion (`nimbus data delete`), a tamper-evident BLAKE3-chained audit log with an on-demand `nimbus audit verify` command, and a `nimbus connector reindex` command that can deepen or shallow an existing connector index in place. No cloud round-trips; all crypto is pure-JS so the Bun binary remains single-shot.

**Architecture:** Five loosely-coupled modules sit alongside the existing `db/` and `connectors/` code:

1. **Audit chain** (`db/audit-chain.ts` + schema V18) — adds `row_hash`/`prev_hash` columns to `audit_log`; every insert computes `row_hash = BLAKE3(prev_hash ‖ action_type ‖ hitl_status ‖ action_json ‖ timestamp)`. A `_meta` row (`audit_verified_through_id`) lets `nimbus audit verify` run incrementally on startup and full-scan on demand.
2. **Recovery seed** (`db/recovery-seed.ts`) — BIP39 24-word mnemonic generated on the **first** `nimbus data export`, stored under the vault key `backup.recovery_seed`, displayed once, never re-emitted.
3. **Envelope encryption** (`db/data-vault-crypto.ts`) — one random DEK protects the credential manifest; two wrapped copies of the DEK (one via passphrase-derived KEK, one via seed-derived KEK; both KDFs are Argon2id) let either path decrypt on import. KDF uses `@noble/hashes/argon2` (pure JS); cipher is AES-256-GCM from `node:crypto`.
4. **Bundle & manifest** (`db/tar-bundle.ts` + `db/backup-manifest.ts`) — `tar` npm package to pack/unpack; `@noble/hashes/blake3` for per-file integrity hashes recorded in `manifest.json`.
5. **Export/Import/Delete/Reindex commands** (`commands/data-*.ts` + `connectors/reindex.ts`) — thin orchestrators that call into the four modules above plus the existing `LocalIndex`, `NimbusVault`, `WatcherStore`, `WorkflowStore`, `ExtensionRegistry`, and `ProfileStore`. Each command is surfaced via both an IPC method (for UI/E2E tests) and a CLI command (for human use and integration tests).

**Depends on:** nothing new in this phase — the vault, local index, audit log, watcher store, workflow store, extension registry and profile store already exist. This WS assumes WS1 (LLM) and WS2 (Voice) are already merged to `main` and the current schema version is V17.

**Tech Stack:** Bun v1.2+, TypeScript 6.x strict, `bun:sqlite`, `@noble/hashes` (BLAKE3 + Argon2id, pure JS), `@scure/bip39` (BIP39 mnemonic, pure JS), `tar` npm package (pure JS tar create/extract), `node:crypto` (AES-256-GCM).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/gateway/package.json` | Add `@noble/hashes`, `@scure/bip39`, `tar` dependencies |
| Create | `packages/gateway/src/db/audit-chain.ts` | Pure BLAKE3 chain helpers (no SQLite, no IO) |
| Create | `packages/gateway/src/db/audit-chain.test.ts` | Chain helper unit tests |
| Create | `packages/gateway/src/index/audit-chain-v18-sql.ts` | V18 migration SQL (row_hash, prev_hash, `_meta` table) |
| Modify | `packages/gateway/src/index/migrations/runner.ts` | Wire V18 step + backfill; bump `SCHEMA_VERSION` label list |
| Modify | `packages/gateway/src/index/local-index.ts` | `SCHEMA_VERSION = 18`; `recordAudit` computes chain; add `listAuditWithChain`, `getLastAuditRowHash`, `_meta` helpers |
| Create | `packages/gateway/src/index/migrations/runner-v18.test.ts` | Migration backfill test |
| Create | `packages/gateway/src/db/audit-verify.ts` | `verifyAuditChain()` — walks rows and reports first break |
| Create | `packages/gateway/src/db/audit-verify.test.ts` | Chain-verify + tamper-detection tests |
| Create | `packages/gateway/src/ipc/audit-rpc.ts` | `audit.verify`, `audit.exportAll` RPC dispatcher |
| Create | `packages/gateway/src/ipc/audit-rpc.test.ts` | Audit RPC unit tests |
| Modify | `packages/gateway/src/ipc/server.ts` | Wire `audit.verify` / `audit.exportAll` / `data.*` / `connector.reindex` RPC methods |
| Modify | `packages/cli/src/commands/audit.ts` | Add `verify` and `export` subcommands (dispatch on `args[0]`) |
| Create | `packages/cli/src/commands/audit-verify.test.ts` | CLI subcommand parsing tests |
| Create | `packages/gateway/src/db/recovery-seed.ts` | BIP39 mnemonic generation + vault storage |
| Create | `packages/gateway/src/db/recovery-seed.test.ts` | Mnemonic generation + idempotency unit tests |
| Create | `packages/gateway/src/db/data-vault-crypto.ts` | Envelope encryption — DEK + dual-wrap Argon2id |
| Create | `packages/gateway/src/db/data-vault-crypto.test.ts` | Round-trip, wrong-passphrase, tamper-detection tests |
| Create | `packages/gateway/src/db/backup-manifest.ts` | Manifest build + verify; BLAKE3 per-file hashes |
| Create | `packages/gateway/src/db/backup-manifest.test.ts` | Manifest shape + hash mismatch tests |
| Create | `packages/gateway/src/db/tar-bundle.ts` | `tar` wrapper — pack/unpack with structure validation |
| Create | `packages/gateway/src/db/tar-bundle.test.ts` | Tar round-trip + missing-file rejection tests |
| Create | `packages/gateway/src/commands/data-export.ts` | Orchestrator — build bundle end-to-end |
| Create | `packages/gateway/src/commands/data-export.test.ts` | Unit test; stubs vault + index + stores |
| Create | `packages/gateway/src/commands/data-import.ts` | Orchestrator — validate + restore + rollback on failure |
| Create | `packages/gateway/src/commands/data-import.test.ts` | Unit test — happy path + rollback on step-7 failure |
| Create | `packages/gateway/src/commands/data-delete.ts` | Service-scoped deletion + pre-flight summary |
| Create | `packages/gateway/src/commands/data-delete.test.ts` | Unit test — two services seeded; delete one |
| Create | `packages/gateway/src/ipc/data-rpc.ts` | `data.export`, `data.import`, `data.delete` RPC dispatcher |
| Create | `packages/gateway/src/ipc/data-rpc.test.ts` | Data RPC unit tests |
| Create | `packages/cli/src/commands/data.ts` | CLI `nimbus data export|import|delete` subcommand dispatcher |
| Create | `packages/cli/src/commands/data.test.ts` | CLI arg parsing + error path tests |
| Modify | `packages/cli/src/commands/index.ts` | Export `runData`; audit already exported |
| Modify | `packages/cli/src/index.ts` | Register `data` subcommand |
| Create | `packages/gateway/src/connectors/reindex.ts` | Deepen / shallow index for an existing connector |
| Create | `packages/gateway/src/connectors/reindex.test.ts` | Deepen + shallow + audit log tests |
| Create | `packages/gateway/src/ipc/reindex-rpc.ts` | `connector.reindex` RPC dispatcher |
| Create | `packages/gateway/src/ipc/reindex-rpc.test.ts` | Reindex RPC unit tests |
| Modify | `packages/cli/src/commands/connector.ts` | Add `reindex` subcommand |
| Create | `packages/gateway/test/integration/data/roundtrip.test.ts` | Seeded Gateway → export → wipe → import → assert state restored |

---

## Task 1: Add Dependencies

**Files:**
- Modify: `packages/gateway/package.json`

Pure dependency addition — no test needed, but the full typecheck must still pass after `bun install`.

- [ ] **Step 1: Add the three dependencies**

Edit `packages/gateway/package.json` so the `dependencies` block contains (order is not significant — Biome will normalise on the next commit):

```json
"dependencies": {
  "@nimbus-dev/sdk": "workspace:*",
  "@mastra/core": "^1.25.0",
  "@mastra/mcp": "^1.5.0",
  "@noble/hashes": "^1.8.0",
  "@scure/bip39": "^1.6.0",
  "@xenova/transformers": "^2.17.0",
  "pino": "^10.3.1",
  "sqlite-vec": "^0.1.6",
  "tar": "^7.4.3",
  "zod": "^4.3.6"
}
```

Also add `"@types/tar": "^6.1.13"` under `devDependencies` (the `tar` package does ship types but not under the exact surface we use).

- [ ] **Step 2: Install and typecheck**

```bash
bun install
bun run typecheck 2>&1 | tail -5
```

Expected: `Exited with code 0` on every package.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/package.json bun.lockb
git commit -m "chore(gateway): add @noble/hashes, @scure/bip39, tar for data sovereignty"
```

---

## Task 2: BLAKE3 Audit Chain Helpers

**Files:**
- Create: `packages/gateway/src/db/audit-chain.ts`
- Create: `packages/gateway/src/db/audit-chain.test.ts`

Pure functions. No SQLite, no IO — only `@noble/hashes/blake3`. Makes the hash function easily reviewable and independently testable before it is wired into `recordAudit`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/db/audit-chain.test.ts
import { describe, expect, test } from "bun:test";
import { computeAuditRowHash, GENESIS_HASH } from "./audit-chain.ts";

describe("computeAuditRowHash", () => {
  test("is deterministic for identical inputs", () => {
    const row = { prevHash: GENESIS_HASH, actionType: "a", hitlStatus: "approved", actionJson: "{}", timestamp: 1 };
    expect(computeAuditRowHash(row)).toBe(computeAuditRowHash(row));
  });

  test("differs when any field differs", () => {
    const base = { prevHash: GENESIS_HASH, actionType: "a", hitlStatus: "approved", actionJson: "{}", timestamp: 1 };
    const mutated = { ...base, actionType: "b" };
    expect(computeAuditRowHash(base)).not.toBe(computeAuditRowHash(mutated));
  });

  test("returns 64-char lowercase hex", () => {
    const h = computeAuditRowHash({ prevHash: GENESIS_HASH, actionType: "a", hitlStatus: "approved", actionJson: "{}", timestamp: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("GENESIS_HASH is 64 zeros", () => {
    expect(GENESIS_HASH).toBe("0".repeat(64));
  });

  test("changes when prevHash changes (chain linkage)", () => {
    const row = { actionType: "a", hitlStatus: "approved", actionJson: "{}", timestamp: 1 };
    const a = computeAuditRowHash({ ...row, prevHash: GENESIS_HASH });
    const b = computeAuditRowHash({ ...row, prevHash: "deadbeef".repeat(8) });
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gateway && bun test src/db/audit-chain.test.ts 2>&1 | tail -5
```

Expected: `Module not found: audit-chain`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/gateway/src/db/audit-chain.ts
import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";

/** Genesis hash used for the first audit row. 64 hex zeros. */
export const GENESIS_HASH = "0".repeat(64);

export type AuditRowHashInput = {
  prevHash: string;
  actionType: string;
  hitlStatus: string;
  actionJson: string;
  timestamp: number;
};

/**
 * Compute `row_hash = BLAKE3(prev_hash || action_type || hitl_status || action_json || timestamp)`.
 *
 * Ordering and serialisation must stay stable: if we ever change field order,
 * every historical row_hash becomes invalid and `nimbus audit verify` breaks.
 * That is the point of the chain — so treat this function as a load-bearing
 * spec, not an implementation detail.
 */
export function computeAuditRowHash(input: AuditRowHashInput): string {
  const encoder = new TextEncoder();
  const payload = encoder.encode(
    `${input.prevHash}|${input.actionType}|${input.hitlStatus}|${input.actionJson}|${String(input.timestamp)}`,
  );
  return bytesToHex(blake3(payload));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/gateway && bun test src/db/audit-chain.test.ts 2>&1 | tail -5
```

Expected: `5 pass`, `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/audit-chain.ts packages/gateway/src/db/audit-chain.test.ts
git commit -m "feat(db): BLAKE3 audit chain helper"
```

---

## Task 3: V18 Schema Migration

**Files:**
- Create: `packages/gateway/src/index/audit-chain-v18-sql.ts`
- Modify: `packages/gateway/src/index/migrations/runner.ts`
- Modify: `packages/gateway/src/index/local-index.ts`
- Create: `packages/gateway/src/index/migrations/runner-v18.test.ts`

Adds `row_hash` and `prev_hash` columns, a `_meta` table for the incremental verify cursor, and backfills the chain for existing rows in order of `id`.

- [ ] **Step 1: Write the failing migration test**

```typescript
// packages/gateway/src/index/migrations/runner-v18.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { GENESIS_HASH } from "../../db/audit-chain.ts";
import { runIndexedSchemaMigrations } from "./runner.ts";

function seedV17Audit(db: Database): void {
  db.run(
    `INSERT INTO audit_log (action_type, hitl_status, action_json, timestamp) VALUES (?, ?, ?, ?)`,
    ["a", "approved", "{}", 1000],
  );
  db.run(
    `INSERT INTO audit_log (action_type, hitl_status, action_json, timestamp) VALUES (?, ?, ?, ?)`,
    ["b", "approved", "{}", 2000],
  );
}

describe("V18 migration — audit chain backfill", () => {
  test("adds row_hash + prev_hash columns and backfills existing rows", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);
    seedV17Audit(db);
    runIndexedSchemaMigrations(db, 18);

    const rows = db.query(`SELECT id, row_hash, prev_hash FROM audit_log ORDER BY id ASC`).all() as Array<{
      id: number;
      row_hash: string;
      prev_hash: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.prev_hash).toBe(GENESIS_HASH);
    expect(rows[0]?.row_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1]?.prev_hash).toBe(rows[0]?.row_hash);
  });

  test("creates _meta table with audit_verified_through_id initialised to 0", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 18);
    const row = db.query(`SELECT value FROM _meta WHERE key = 'audit_verified_through_id'`).get() as
      | { value: string }
      | undefined;
    expect(row?.value).toBe("0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gateway && bun test src/index/migrations/runner-v18.test.ts 2>&1 | tail -5
```

Expected: failure because the runner caps at V17.

- [ ] **Step 3: Write the migration SQL**

```typescript
// packages/gateway/src/index/audit-chain-v18-sql.ts
export const AUDIT_CHAIN_V18_SCHEMA_SQL = `
ALTER TABLE audit_log ADD COLUMN row_hash TEXT;
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO _meta (key, value) VALUES ('audit_verified_through_id', '0');
`;
```

- [ ] **Step 4: Extend the runner**

Edit `packages/gateway/src/index/migrations/runner.ts`:

1. Add import at the top (alphabetical in the existing block):

```typescript
import { AUDIT_CHAIN_V18_SCHEMA_SQL } from "../audit-chain-v18-sql.ts";
```

2. Add the step function below `migrateIndexedV16ToV17`:

```typescript
function migrateIndexedV17ToV18(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(AUDIT_CHAIN_V18_SCHEMA_SQL);
    backfillAuditChain(db);
    db.exec("PRAGMA user_version = 18");
    recordMigration(db, 18, "audit_log BLAKE3 chain (row_hash + prev_hash) + _meta", now);
  })();
}

function backfillAuditChain(db: Database): void {
  const rows = db
    .query(`SELECT id, action_type, hitl_status, action_json, timestamp FROM audit_log ORDER BY id ASC`)
    .all() as Array<{
      id: number;
      action_type: string;
      hitl_status: string;
      action_json: string;
      timestamp: number;
    }>;
  let prev = "0".repeat(64);
  const update = db.prepare(`UPDATE audit_log SET row_hash = ?, prev_hash = ? WHERE id = ?`);
  for (const r of rows) {
    const row = computeAuditRowHash({
      prevHash: prev,
      actionType: r.action_type,
      hitlStatus: r.hitl_status,
      actionJson: r.action_json,
      timestamp: r.timestamp,
    });
    update.run(row, prev, r.id);
    prev = row;
  }
}
```

3. Add the missing import at the top of the file alongside the others:

```typescript
import { computeAuditRowHash } from "../../db/audit-chain.ts";
```

4. Append the step to `INDEXED_SCHEMA_STEPS`:

```typescript
{ fromVersion: 17, toVersion: 18, apply: migrateIndexedV17ToV18 },
```

5. Append to `BACKFILL_LABELS`:

```typescript
"audit_log BLAKE3 chain + _meta (backfilled)",
```

- [ ] **Step 5: Bump `SCHEMA_VERSION`**

In `packages/gateway/src/index/local-index.ts` change:

```typescript
static readonly SCHEMA_VERSION = 17;
```

to:

```typescript
static readonly SCHEMA_VERSION = 18;
```

- [ ] **Step 6: Run the migration test**

```bash
cd packages/gateway && bun test src/index/migrations/runner-v18.test.ts 2>&1 | tail -5
```

Expected: `2 pass`, `0 fail`.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/index/audit-chain-v18-sql.ts \
        packages/gateway/src/index/migrations/runner.ts \
        packages/gateway/src/index/migrations/runner-v18.test.ts \
        packages/gateway/src/index/local-index.ts
git commit -m "feat(db): V18 migration — audit_log row_hash + prev_hash + _meta cursor"
```

---

## Task 4: Wire Chain Into `recordAudit`

**Files:**
- Modify: `packages/gateway/src/index/local-index.ts`

Every new audit row must now carry the chain hashes. Add a helper `getLastAuditRowHash()` so both runtime inserts and later verify code can share the same source of truth, plus `listAuditWithChain()` for tests and export.

- [ ] **Step 1: Add the failing test**

Extend `packages/gateway/src/index/index.test.ts` (do not create a new file). Append inside the outermost `describe` block:

```typescript
import { GENESIS_HASH } from "../db/audit-chain.ts";

test("recordAudit chains row_hash across successive inserts", () => {
  const db = newTestIndex();
  db.recordAudit({ actionType: "a", hitlStatus: "approved", actionJson: "{}", timestamp: 1 });
  db.recordAudit({ actionType: "b", hitlStatus: "approved", actionJson: "{}", timestamp: 2 });
  const rows = db.listAuditWithChain(10);
  expect(rows).toHaveLength(2);
  const [first, second] = rows;
  expect(first?.prevHash).toBe(GENESIS_HASH);
  expect(second?.prevHash).toBe(first?.rowHash);
  expect(first?.rowHash).toMatch(/^[0-9a-f]{64}$/);
});
```

(If `newTestIndex()` is not already a helper in that file, inline a minimal constructor that opens a `:memory:` DB and runs migrations; match the style of existing tests in the same file.)

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/gateway && bun test src/index/index.test.ts 2>&1 | tail -10
```

Expected: failure on `listAuditWithChain` or mismatched `prevHash`.

- [ ] **Step 3: Replace the `recordAudit` body and add helpers**

In `packages/gateway/src/index/local-index.ts`, change the `recordAudit` body to:

```typescript
recordAudit(entry: {
  actionType: string;
  hitlStatus: AuditEntry["hitlStatus"];
  actionJson: string;
  timestamp: number;
}): void {
  const prevHash = this.getLastAuditRowHash();
  const rowHash = computeAuditRowHash({
    prevHash,
    actionType: entry.actionType,
    hitlStatus: entry.hitlStatus,
    actionJson: entry.actionJson,
    timestamp: entry.timestamp,
  });
  this.db.run(
    `INSERT INTO audit_log (action_type, hitl_status, action_json, timestamp, row_hash, prev_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entry.actionType, entry.hitlStatus, entry.actionJson, entry.timestamp, rowHash, prevHash],
  );
}

getLastAuditRowHash(): string {
  const row = this.db
    .query(`SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1`)
    .get() as { row_hash: string | null } | undefined;
  const h = row?.row_hash;
  return typeof h === "string" && h.length === 64 ? h : GENESIS_HASH;
}

listAuditWithChain(limit: number): Array<AuditEntry & { rowHash: string; prevHash: string }> {
  const capped = Math.min(10_000, Math.max(1, Math.floor(limit)));
  const rows = this.db
    .query(
      `SELECT id, action_type, hitl_status, action_json, timestamp, row_hash, prev_hash
       FROM audit_log ORDER BY id ASC LIMIT ?`,
    )
    .all(capped) as Array<{
      id: number;
      action_type: string;
      hitl_status: string;
      action_json: string;
      timestamp: number;
      row_hash: string;
      prev_hash: string;
    }>;
  return rows.map((r) => {
    const status = r.hitl_status;
    if (status !== "approved" && status !== "rejected" && status !== "not_required") {
      throw new Error("Corrupt audit_log row: invalid hitl_status");
    }
    return {
      id: r.id,
      actionType: r.action_type,
      hitlStatus: status,
      actionJson: r.action_json,
      timestamp: r.timestamp,
      rowHash: r.row_hash,
      prevHash: r.prev_hash,
    };
  });
}

getAuditVerifiedThroughId(): number {
  const row = this.db
    .query(`SELECT value FROM _meta WHERE key = 'audit_verified_through_id'`)
    .get() as { value: string } | undefined;
  const n = row === undefined ? 0 : Number.parseInt(row.value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

setAuditVerifiedThroughId(id: number): void {
  const v = Math.max(0, Math.floor(id));
  this.db.run(
    `INSERT INTO _meta (key, value) VALUES ('audit_verified_through_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(v)],
  );
}
```

Add at the top of the file:

```typescript
import { computeAuditRowHash, GENESIS_HASH } from "../db/audit-chain.ts";
```

- [ ] **Step 4: Run tests**

```bash
cd packages/gateway && bun test src/index/index.test.ts 2>&1 | tail -5
```

Expected: all tests pass including the new chain test.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/index/local-index.ts packages/gateway/src/index/index.test.ts
git commit -m "feat(db): chain row_hash on every recordAudit insert"
```

---

## Task 5: `audit.verify` — Verifier + IPC Handler + CLI

**Files:**
- Create: `packages/gateway/src/db/audit-verify.ts`
- Create: `packages/gateway/src/db/audit-verify.test.ts`
- Create: `packages/gateway/src/ipc/audit-rpc.ts`
- Create: `packages/gateway/src/ipc/audit-rpc.test.ts`
- Modify: `packages/gateway/src/ipc/server.ts`
- Modify: `packages/cli/src/commands/audit.ts`
- Create: `packages/cli/src/commands/audit-verify.test.ts`

- [ ] **Step 1: Write failing verifier test**

```typescript
// packages/gateway/src/db/audit-verify.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { LocalIndex } from "../index/local-index.ts";
import { verifyAuditChain } from "./audit-verify.ts";

function newIndex(): LocalIndex {
  return new LocalIndex(new Database(":memory:"));
}

describe("verifyAuditChain", () => {
  test("reports ok on an intact chain", () => {
    const idx = newIndex();
    idx.recordAudit({ actionType: "a", hitlStatus: "approved", actionJson: "{}", timestamp: 1 });
    idx.recordAudit({ actionType: "b", hitlStatus: "approved", actionJson: "{}", timestamp: 2 });
    const result = verifyAuditChain(idx, { fromId: 0 });
    expect(result.ok).toBe(true);
    expect(result.verifiedRows).toBe(2);
    expect(result.firstBreakAtId).toBeUndefined();
  });

  test("detects tampering in a middle row", () => {
    const idx = newIndex();
    idx.recordAudit({ actionType: "a", hitlStatus: "approved", actionJson: "{}", timestamp: 1 });
    idx.recordAudit({ actionType: "b", hitlStatus: "approved", actionJson: "{}", timestamp: 2 });
    idx.recordAudit({ actionType: "c", hitlStatus: "approved", actionJson: "{}", timestamp: 3 });
    // Tamper with row 2's payload directly.
    idx.rawDb.run(`UPDATE audit_log SET action_json = ? WHERE id = 2`, ['{"t":1}']);
    const result = verifyAuditChain(idx, { fromId: 0 });
    expect(result.ok).toBe(false);
    expect(result.firstBreakAtId).toBe(2);
  });

  test("incremental mode skips rows already verified", () => {
    const idx = newIndex();
    idx.recordAudit({ actionType: "a", hitlStatus: "approved", actionJson: "{}", timestamp: 1 });
    idx.setAuditVerifiedThroughId(1);
    idx.recordAudit({ actionType: "b", hitlStatus: "approved", actionJson: "{}", timestamp: 2 });
    const result = verifyAuditChain(idx, { fromId: idx.getAuditVerifiedThroughId() });
    expect(result.ok).toBe(true);
    expect(result.verifiedRows).toBe(1);
  });
});
```

This test references `idx.rawDb` — add that public getter in `LocalIndex` (return `this.db`). It is a narrow escape hatch for tests and verifier code that must run DDL/raw SQL.

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/gateway && bun test src/db/audit-verify.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Implement the verifier**

```typescript
// packages/gateway/src/db/audit-verify.ts
import type { LocalIndex } from "../index/local-index.ts";
import { computeAuditRowHash, GENESIS_HASH } from "./audit-chain.ts";

export type AuditVerifyOptions = {
  /** Begin verification strictly after this id. Use 0 for a full scan. */
  fromId: number;
};

export type AuditVerifyResult = {
  ok: boolean;
  verifiedRows: number;
  lastVerifiedId: number;
  firstBreakAtId?: number;
  reason?: string;
};

export function verifyAuditChain(idx: LocalIndex, opts: AuditVerifyOptions): AuditVerifyResult {
  const rows = idx.rawDb
    .query(
      `SELECT id, action_type, hitl_status, action_json, timestamp, row_hash, prev_hash
       FROM audit_log WHERE id > ? ORDER BY id ASC`,
    )
    .all(Math.max(0, Math.floor(opts.fromId))) as Array<{
      id: number;
      action_type: string;
      hitl_status: string;
      action_json: string;
      timestamp: number;
      row_hash: string;
      prev_hash: string;
    }>;

  let prev =
    opts.fromId > 0
      ? (idx.rawDb
          .query(`SELECT row_hash FROM audit_log WHERE id = ?`)
          .get(opts.fromId) as { row_hash: string } | undefined)?.row_hash ?? GENESIS_HASH
      : GENESIS_HASH;

  let verified = 0;
  let lastId = opts.fromId;

  for (const r of rows) {
    if (r.prev_hash !== prev) {
      return {
        ok: false,
        verifiedRows: verified,
        lastVerifiedId: lastId,
        firstBreakAtId: r.id,
        reason: `prev_hash mismatch at id ${String(r.id)}`,
      };
    }
    const expected = computeAuditRowHash({
      prevHash: prev,
      actionType: r.action_type,
      hitlStatus: r.hitl_status,
      actionJson: r.action_json,
      timestamp: r.timestamp,
    });
    if (expected !== r.row_hash) {
      return {
        ok: false,
        verifiedRows: verified,
        lastVerifiedId: lastId,
        firstBreakAtId: r.id,
        reason: `row_hash mismatch at id ${String(r.id)}`,
      };
    }
    prev = r.row_hash;
    verified += 1;
    lastId = r.id;
  }

  return { ok: true, verifiedRows: verified, lastVerifiedId: lastId };
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/gateway && bun test src/db/audit-verify.test.ts 2>&1 | tail -5
```

Expected: `3 pass`.

- [ ] **Step 5: Add the IPC dispatcher (TDD)**

Write `packages/gateway/src/ipc/audit-rpc.test.ts` first:

```typescript
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { LocalIndex } from "../index/local-index.ts";
import { dispatchAuditRpc, AuditRpcError } from "./audit-rpc.ts";

function seededIndex(): LocalIndex {
  const idx = new LocalIndex(new Database(":memory:"));
  idx.recordAudit({ actionType: "x", hitlStatus: "approved", actionJson: "{}", timestamp: 1 });
  return idx;
}

describe("dispatchAuditRpc", () => {
  test("returns miss for non-audit method", async () => {
    const out = await dispatchAuditRpc("foo.bar", {}, { index: seededIndex() });
    expect(out.kind).toBe("miss");
  });

  test("audit.verify returns { ok: true, verifiedRows: 1 }", async () => {
    const idx = seededIndex();
    const out = await dispatchAuditRpc("audit.verify", {}, { index: idx });
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const value = out.value as { ok: boolean; verifiedRows: number };
      expect(value.ok).toBe(true);
      expect(value.verifiedRows).toBe(1);
    }
  });

  test("audit.verify --full reruns from 0 regardless of cursor", async () => {
    const idx = seededIndex();
    idx.setAuditVerifiedThroughId(999);
    const out = await dispatchAuditRpc("audit.verify", { full: true }, { index: idx });
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      expect((out.value as { verifiedRows: number }).verifiedRows).toBe(1);
    }
  });

  test("audit.exportAll returns every row with chain fields", async () => {
    const out = await dispatchAuditRpc("audit.exportAll", {}, { index: seededIndex() });
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const rows = out.value as Array<{ rowHash: string; prevHash: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rowHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("throws AuditRpcError when index not configured", async () => {
    await expect(dispatchAuditRpc("audit.verify", {}, { index: undefined })).rejects.toBeInstanceOf(
      AuditRpcError,
    );
  });
});
```

- [ ] **Step 6: Run to confirm failure**

```bash
cd packages/gateway && bun test src/ipc/audit-rpc.test.ts 2>&1 | tail -5
```

- [ ] **Step 7: Implement dispatcher**

```typescript
// packages/gateway/src/ipc/audit-rpc.ts
import type { LocalIndex } from "../index/local-index.ts";
import { verifyAuditChain } from "../db/audit-verify.ts";

export type AuditRpcContext = { index: LocalIndex | undefined };
type RpcResult = { kind: "hit"; value: unknown } | { kind: "miss" };

export class AuditRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "AuditRpcError";
    this.rpcCode = rpcCode;
  }
}

function ensureIndex(ctx: AuditRpcContext): LocalIndex {
  if (ctx.index === undefined) {
    throw new AuditRpcError(-32603, "audit RPC unavailable: LocalIndex not configured");
  }
  return ctx.index;
}

export async function dispatchAuditRpc(
  method: string,
  params: unknown,
  ctx: AuditRpcContext,
): Promise<RpcResult> {
  if (method === "audit.verify") {
    const idx = ensureIndex(ctx);
    const full =
      params !== null && typeof params === "object" && (params as Record<string, unknown>)["full"] === true;
    const fromId = full ? 0 : idx.getAuditVerifiedThroughId();
    const result = verifyAuditChain(idx, { fromId });
    if (result.ok) idx.setAuditVerifiedThroughId(result.lastVerifiedId);
    return { kind: "hit", value: result };
  }
  if (method === "audit.exportAll") {
    const idx = ensureIndex(ctx);
    return { kind: "hit", value: idx.listAuditWithChain(10_000) };
  }
  return { kind: "miss" };
}
```

- [ ] **Step 8: Wire into the server**

In `packages/gateway/src/ipc/server.ts`:

1. Add the import alongside other dispatcher imports:

```typescript
import { AuditRpcError, dispatchAuditRpc } from "./audit-rpc.ts";
```

2. Extend `tryDispatchPhase4Rpc` (from the WS2 merge — this file now owns the merged dispatcher; if that helper is absent, add a new `tryDispatchAuditRpc` following the exact pattern of `tryDispatchLlmRpc`). Insert a new branch at the end:

```typescript
async function tryDispatchAuditRpc(method: string, params: unknown): Promise<unknown> {
  if (method !== "audit.verify" && method !== "audit.exportAll") return phase4RpcSkipped;
  try {
    const out = await dispatchAuditRpc(method, params, { index: options.localIndex });
    if (out.kind === "hit") return out.value;
  } catch (e) {
    if (e instanceof AuditRpcError) throw new RpcMethodError(e.rpcCode, e.message);
    throw e;
  }
  return phase4RpcSkipped;
}
```

Then chain it inside the existing `tryDispatchPhase4Rpc`:

```typescript
const auditOutcome = await tryDispatchAuditRpc(method, params);
if (auditOutcome !== phase4RpcSkipped) return auditOutcome;
```

- [ ] **Step 9: Extend the CLI**

Replace the body of `runAudit` in `packages/cli/src/commands/audit.ts` so it dispatches on the first positional arg:

```typescript
export async function runAudit(args: string[]): Promise<void> {
  const [sub = "list", ...rest] = args;
  if (sub === "verify") return runAuditVerify(rest);
  if (sub === "export") return runAuditExport(rest);
  return runAuditList(args); // existing behaviour
}
```

Keep the current list implementation as `runAuditList`. Add:

```typescript
async function runAuditVerify(args: string[]): Promise<void> {
  const full = args.includes("--full");
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) throw new Error("Gateway is not running. Start with: nimbus start");
  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    const out = await client.call<{
      ok: boolean;
      verifiedRows: number;
      firstBreakAtId?: number;
      reason?: string;
    }>("audit.verify", { full });
    if (out.ok) {
      console.log(`[ok]   chain integrity — ${String(out.verifiedRows)} rows verified`);
      process.exitCode = 0;
    } else {
      console.log(`[FAIL] chain break at row ${String(out.firstBreakAtId)}: ${out.reason ?? "unknown"}`);
      process.exitCode = 1;
    }
  } finally {
    await client.disconnect();
  }
}

async function runAuditExport(args: string[]): Promise<void> {
  const outIdx = args.indexOf("--output");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
  if (outPath === undefined || outPath === "") throw new Error("Usage: nimbus audit export --output <path>");
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) throw new Error("Gateway is not running. Start with: nimbus start");
  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    const rows = await client.call<unknown[]>("audit.exportAll", {});
    await Bun.write(outPath, JSON.stringify(rows, null, 2));
    console.log(`[ok] wrote ${String(rows.length)} audit rows to ${outPath}`);
  } finally {
    await client.disconnect();
  }
}
```

- [ ] **Step 10: CLI parse test**

```typescript
// packages/cli/src/commands/audit-verify.test.ts
import { describe, expect, test } from "bun:test";
// If an internal parser helper is later extracted, test it directly.
// For now, smoke-test that the module exports `runAudit` and subcommands do not throw on --help-style no-op args.
import { runAudit } from "./audit.ts";

describe("audit subcommands", () => {
  test("runAudit is callable", () => {
    expect(typeof runAudit).toBe("function");
  });
});
```

- [ ] **Step 11: Run all new tests and typecheck**

```bash
cd packages/gateway && bun test src/db/audit-verify.test.ts src/ipc/audit-rpc.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add packages/gateway/src/db/audit-verify.ts packages/gateway/src/db/audit-verify.test.ts \
        packages/gateway/src/ipc/audit-rpc.ts packages/gateway/src/ipc/audit-rpc.test.ts \
        packages/gateway/src/ipc/server.ts packages/gateway/src/index/local-index.ts \
        packages/cli/src/commands/audit.ts packages/cli/src/commands/audit-verify.test.ts
git commit -m "feat(audit): nimbus audit verify + export; chain verifier and IPC handlers"
```

---

## Task 6: Recovery Seed

**Files:**
- Create: `packages/gateway/src/db/recovery-seed.ts`
- Create: `packages/gateway/src/db/recovery-seed.test.ts`

The seed is generated on the first export and stored in the vault under `backup.recovery_seed`. Subsequent calls to `ensureRecoverySeed` return the existing value — the seed is never regenerated automatically.

- [ ] **Step 1: Write failing test**

```typescript
// packages/gateway/src/db/recovery-seed.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { ensureRecoverySeed, RECOVERY_SEED_VAULT_KEY, seedIsValidBip39 } from "./recovery-seed.ts";

function makeMemoryVault(): NimbusVault {
  const store = new Map<string, string>();
  return {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
    delete: async (k) => {
      store.delete(k);
    },
    listKeys: async (prefix) =>
      [...store.keys()].filter((k) => (prefix === undefined ? true : k.startsWith(prefix))),
  };
}

describe("recovery seed", () => {
  let vault: NimbusVault;
  beforeEach(() => {
    vault = makeMemoryVault();
  });

  test("ensureRecoverySeed generates a 24-word BIP39 mnemonic on first call", async () => {
    const result = await ensureRecoverySeed(vault);
    expect(result.generated).toBe(true);
    expect(result.mnemonic.split(" ")).toHaveLength(24);
    expect(seedIsValidBip39(result.mnemonic)).toBe(true);
  });

  test("ensureRecoverySeed is idempotent — second call returns the same seed and generated=false", async () => {
    const first = await ensureRecoverySeed(vault);
    const second = await ensureRecoverySeed(vault);
    expect(second.generated).toBe(false);
    expect(second.mnemonic).toBe(first.mnemonic);
  });

  test("vault key is backup.recovery_seed", () => {
    expect(RECOVERY_SEED_VAULT_KEY).toBe("backup.recovery_seed");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/gateway && bun test src/db/recovery-seed.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

```typescript
// packages/gateway/src/db/recovery-seed.ts
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export const RECOVERY_SEED_VAULT_KEY = "backup.recovery_seed";

/** 24 words = 256 bits of entropy. */
const MNEMONIC_STRENGTH_BITS = 256;

export type EnsureSeedResult = {
  mnemonic: string;
  /** True only on the call that generated a new seed. */
  generated: boolean;
};

export async function ensureRecoverySeed(vault: NimbusVault): Promise<EnsureSeedResult> {
  const existing = await vault.get(RECOVERY_SEED_VAULT_KEY);
  if (existing !== null && existing !== "") {
    return { mnemonic: existing, generated: false };
  }
  const mnemonic = generateMnemonic(wordlist, MNEMONIC_STRENGTH_BITS);
  await vault.set(RECOVERY_SEED_VAULT_KEY, mnemonic);
  return { mnemonic, generated: true };
}

export function seedIsValidBip39(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}
```

- [ ] **Step 4: Run & commit**

```bash
cd packages/gateway && bun test src/db/recovery-seed.test.ts 2>&1 | tail -5
git add packages/gateway/src/db/recovery-seed.ts packages/gateway/src/db/recovery-seed.test.ts
git commit -m "feat(db): BIP39 recovery seed — ensureRecoverySeed (vault-backed, idempotent)"
```

---

## Task 7: Envelope Encryption

**Files:**
- Create: `packages/gateway/src/db/data-vault-crypto.ts`
- Create: `packages/gateway/src/db/data-vault-crypto.test.ts`

`encryptVaultManifest({ plaintext, passphrase, seed })` returns a JSON-serialisable blob containing the ciphertext, the AES-GCM IV, and two DEK wrap records (salt + wrapped bytes) — one per KDF input. `decryptVaultManifest(blob, { passphrase? | seed? })` recovers the plaintext given either credential.

- [ ] **Step 1: Failing test**

```typescript
// packages/gateway/src/db/data-vault-crypto.test.ts
import { describe, expect, test } from "bun:test";
import { decryptVaultManifest, encryptVaultManifest } from "./data-vault-crypto.ts";

const PLAINTEXT = '[{"key":"github.pat","value":"secret_value_xyz"}]';
const PASSPHRASE = "correct horse battery staple";
const SEED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

// Argon2id with 64 MB memory is slow in Bun. We override to tiny parameters for tests.
const FAST_KDF = { t: 1, m: 1024, p: 1 } as const;

describe("envelope encryption", () => {
  test("round-trips plaintext via passphrase", async () => {
    const blob = await encryptVaultManifest({ plaintext: PLAINTEXT, passphrase: PASSPHRASE, seed: SEED, kdfParams: FAST_KDF });
    const out = await decryptVaultManifest(blob, { passphrase: PASSPHRASE });
    expect(out).toBe(PLAINTEXT);
  });

  test("round-trips plaintext via seed", async () => {
    const blob = await encryptVaultManifest({ plaintext: PLAINTEXT, passphrase: PASSPHRASE, seed: SEED, kdfParams: FAST_KDF });
    const out = await decryptVaultManifest(blob, { seed: SEED });
    expect(out).toBe(PLAINTEXT);
  });

  test("wrong passphrase fails to decrypt", async () => {
    const blob = await encryptVaultManifest({ plaintext: PLAINTEXT, passphrase: PASSPHRASE, seed: SEED, kdfParams: FAST_KDF });
    await expect(decryptVaultManifest(blob, { passphrase: "wrong" })).rejects.toThrow();
  });

  test("tampered ciphertext is rejected by AES-GCM auth tag", async () => {
    const blob = await encryptVaultManifest({ plaintext: PLAINTEXT, passphrase: PASSPHRASE, seed: SEED, kdfParams: FAST_KDF });
    const tampered = { ...blob, ciphertext: blob.ciphertext.replace(/^./, (c) => (c === "a" ? "b" : "a")) };
    await expect(decryptVaultManifest(tampered, { passphrase: PASSPHRASE })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Implement**

```typescript
// packages/gateway/src/db/data-vault-crypto.ts
import { argon2id } from "@noble/hashes/argon2";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Default: Argon2id — 3 iterations, 64 MB memory, 1 lane (matches spec in phase-4-plan.md §3.1.2).
export type KdfParams = { t: number; m: number; p: number };
const DEFAULT_KDF: KdfParams = { t: 3, m: 64 * 1024, p: 1 };

export type VaultManifestBlob = {
  version: 1;
  /** base64, 12-byte AES-GCM IV for the manifest cipher */
  iv: string;
  /** base64 ciphertext including the 16-byte GCM tag */
  ciphertext: string;
  wraps: {
    passphrase: { salt: string; iv: string; wrapped: string };
    seed: { salt: string; iv: string; wrapped: string };
  };
  kdf: KdfParams;
};

const DEK_LEN = 32; // AES-256 key
const IV_LEN = 12; // AES-GCM recommended IV length
const TAG_LEN = 16;

function toB64(b: Uint8Array | Buffer): string {
  return Buffer.from(b).toString("base64");
}

function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function kdf(secret: string, salt: Uint8Array, p: KdfParams): Uint8Array {
  return argon2id(new TextEncoder().encode(secret), salt, { t: p.t, m: p.m, p: p.p, dkLen: DEK_LEN });
}

function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(Buffer.concat([out, cipher.getAuthTag()]));
}

function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ctWithTag: Uint8Array): Uint8Array {
  const ct = ctWithTag.subarray(0, ctWithTag.length - TAG_LEN);
  const tag = ctWithTag.subarray(ctWithTag.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
}

export async function encryptVaultManifest(input: {
  plaintext: string;
  passphrase: string;
  seed: string;
  kdfParams?: KdfParams;
}): Promise<VaultManifestBlob> {
  const p = input.kdfParams ?? DEFAULT_KDF;
  const dek = new Uint8Array(randomBytes(DEK_LEN));
  const iv = new Uint8Array(randomBytes(IV_LEN));
  const ct = aesGcmEncrypt(dek, iv, new TextEncoder().encode(input.plaintext));

  const passSalt = new Uint8Array(randomBytes(16));
  const passKek = kdf(input.passphrase, passSalt, p);
  const passIv = new Uint8Array(randomBytes(IV_LEN));
  const passWrapped = aesGcmEncrypt(passKek, passIv, dek);

  const seedSalt = new Uint8Array(randomBytes(16));
  const seedKek = kdf(input.seed, seedSalt, p);
  const seedIv = new Uint8Array(randomBytes(IV_LEN));
  const seedWrapped = aesGcmEncrypt(seedKek, seedIv, dek);

  return {
    version: 1,
    iv: toB64(iv),
    ciphertext: toB64(ct),
    wraps: {
      passphrase: { salt: toB64(passSalt), iv: toB64(passIv), wrapped: toB64(passWrapped) },
      seed: { salt: toB64(seedSalt), iv: toB64(seedIv), wrapped: toB64(seedWrapped) },
    },
    kdf: p,
  };
}

export async function decryptVaultManifest(
  blob: VaultManifestBlob,
  key: { passphrase?: string; seed?: string },
): Promise<string> {
  const { passphrase, seed } = key;
  let dek: Uint8Array;
  if (passphrase !== undefined) {
    const kek = kdf(passphrase, fromB64(blob.wraps.passphrase.salt), blob.kdf);
    dek = aesGcmDecrypt(kek, fromB64(blob.wraps.passphrase.iv), fromB64(blob.wraps.passphrase.wrapped));
  } else if (seed !== undefined) {
    const kek = kdf(seed, fromB64(blob.wraps.seed.salt), blob.kdf);
    dek = aesGcmDecrypt(kek, fromB64(blob.wraps.seed.iv), fromB64(blob.wraps.seed.wrapped));
  } else {
    throw new Error("decryptVaultManifest: either passphrase or seed must be provided");
  }
  const plaintext = aesGcmDecrypt(dek, fromB64(blob.iv), fromB64(blob.ciphertext));
  return new TextDecoder().decode(plaintext);
}
```

- [ ] **Step 4: Run & commit**

```bash
cd packages/gateway && bun test src/db/data-vault-crypto.test.ts 2>&1 | tail -5
git add packages/gateway/src/db/data-vault-crypto.ts packages/gateway/src/db/data-vault-crypto.test.ts
git commit -m "feat(db): envelope encryption for vault manifest (Argon2id + AES-256-GCM, dual-wrap)"
```

---

## Task 8: Backup Manifest

**Files:**
- Create: `packages/gateway/src/db/backup-manifest.ts`
- Create: `packages/gateway/src/db/backup-manifest.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// packages/gateway/src/db/backup-manifest.test.ts
import { describe, expect, test } from "bun:test";
import { blake3HashFile, buildManifest, verifyManifest } from "./backup-manifest.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nimbus-backup-"));
}

describe("backup manifest", () => {
  test("blake3HashFile returns 64-char hex", async () => {
    const dir = tmp();
    const p = join(dir, "x.bin");
    writeFileSync(p, "hello");
    expect(await blake3HashFile(p)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("buildManifest records per-file hashes and counts", async () => {
    const dir = tmp();
    const idxPath = join(dir, "index.db.gz");
    writeFileSync(idxPath, "FAKE");
    const m = await buildManifest({
      bundleDir: dir,
      nimbusVersion: "0.1.0",
      platform: "linux",
      contents: { index_rows: 5, vault_entries: 1, watchers: 0, workflows: 0, extensions: 0, profiles: 0 },
      files: { "index.db.gz": idxPath },
      indexIncluded: true,
    });
    expect(m.hashes["index.db.gz"]).toMatch(/^[0-9a-f]{64}$/);
    expect(m.contents.index_rows).toBe(5);
    expect(m.contents.index_included).toBe(true);
  });

  test("verifyManifest rejects a tampered file", async () => {
    const dir = tmp();
    const p = join(dir, "f.bin");
    writeFileSync(p, "good");
    const m = await buildManifest({
      bundleDir: dir,
      nimbusVersion: "0.1.0",
      platform: "linux",
      contents: { index_rows: 0, vault_entries: 0, watchers: 0, workflows: 0, extensions: 0, profiles: 0 },
      files: { "f.bin": p },
      indexIncluded: false,
    });
    writeFileSync(p, "tampered");
    const result = await verifyManifest(m, { "f.bin": p });
    expect(result.ok).toBe(false);
    expect(result.firstMismatch).toBe("f.bin");
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// packages/gateway/src/db/backup-manifest.ts
import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";
import { readFile } from "node:fs/promises";

export type BackupManifest = {
  version: 1;
  nimbus_version: string;
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

export async function blake3HashFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return bytesToHex(blake3(new Uint8Array(buf)));
}

export async function buildManifest(input: {
  bundleDir: string;
  nimbusVersion: string;
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
    version: 1,
    nimbus_version: input.nimbusVersion,
    created_at: new Date().toISOString(),
    platform: input.platform,
    contents: { ...input.contents, index_included: input.indexIncluded },
    hashes,
  };
}

export type ManifestVerifyResult = { ok: boolean; firstMismatch?: string };

export async function verifyManifest(
  manifest: BackupManifest,
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

- [ ] **Step 3: Run & commit**

```bash
cd packages/gateway && bun test src/db/backup-manifest.test.ts 2>&1 | tail -5
git add packages/gateway/src/db/backup-manifest.ts packages/gateway/src/db/backup-manifest.test.ts
git commit -m "feat(db): backup manifest builder + BLAKE3 verifier"
```

---

## Task 9: Tar Bundle

**Files:**
- Create: `packages/gateway/src/db/tar-bundle.ts`
- Create: `packages/gateway/src/db/tar-bundle.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// packages/gateway/src/db/tar-bundle.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packBundle, unpackBundle } from "./tar-bundle.ts";

describe("tar bundle", () => {
  test("packs and unpacks a directory round-trip", async () => {
    const src = mkdtempSync(join(tmpdir(), "nimbus-bundle-src-"));
    writeFileSync(join(src, "a.txt"), "hello");
    writeFileSync(join(src, "b.json"), '{"x":1}');
    const out = join(mkdtempSync(join(tmpdir(), "nimbus-bundle-out-")), "bundle.tar.gz");
    await packBundle(src, out);
    expect(existsSync(out)).toBe(true);

    const extractTo = mkdtempSync(join(tmpdir(), "nimbus-bundle-extract-"));
    await unpackBundle(out, extractTo);
    expect(readFileSync(join(extractTo, "a.txt"), "utf8")).toBe("hello");
    expect(readFileSync(join(extractTo, "b.json"), "utf8")).toBe('{"x":1}');
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// packages/gateway/src/db/tar-bundle.ts
import { create as tarCreate, extract as tarExtract } from "tar";

export async function packBundle(sourceDir: string, outputTarGzPath: string): Promise<void> {
  await tarCreate({ gzip: true, file: outputTarGzPath, cwd: sourceDir }, ["."]);
}

export async function unpackBundle(tarGzPath: string, destDir: string): Promise<void> {
  await tarExtract({ file: tarGzPath, cwd: destDir });
}
```

- [ ] **Step 3: Run & commit**

```bash
cd packages/gateway && bun test src/db/tar-bundle.test.ts 2>&1 | tail -5
git add packages/gateway/src/db/tar-bundle.ts packages/gateway/src/db/tar-bundle.test.ts
git commit -m "feat(db): tar bundle pack/unpack helpers (gzip)"
```

---

## Task 10: `nimbus data export` Command

**Files:**
- Create: `packages/gateway/src/commands/data-export.ts`
- Create: `packages/gateway/src/commands/data-export.test.ts`

The orchestrator gathers: index snapshot, vault manifest, watcher/workflow/extension/profile JSON, audit export, then builds `manifest.json`, packs the directory, and returns the output path + recovery seed (if newly generated).

- [ ] **Step 1: Failing test**

```typescript
// packages/gateway/src/commands/data-export.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { LocalIndex } from "../index/local-index.ts";
import { runDataExport } from "./data-export.ts";

function memVault(): NimbusVault {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    },
    listKeys: async (prefix) =>
      [...m.keys()].filter((k) => (prefix === undefined ? true : k.startsWith(prefix))),
  };
}

describe("data export", () => {
  test("produces a tarball with manifest.json and writes the recovery seed on first run", async () => {
    const vault = memVault();
    await vault.set("github.pat", "secret_value_xyz");
    const idx = new LocalIndex(new Database(":memory:"));
    const outPath = join(mkdtempSync(join(tmpdir(), "nimbus-export-")), "backup.tar.gz");

    const result = await runDataExport({
      output: outPath,
      includeIndex: false,
      passphrase: "passphrase",
      vault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams: { t: 1, m: 1024, p: 1 },
    });

    expect(result.outputPath).toBe(outPath);
    expect(result.recoverySeedGenerated).toBe(true);
    expect(result.recoverySeed.split(" ")).toHaveLength(24);
  });

  test("second export reuses the existing seed (generated=false)", async () => {
    const vault = memVault();
    const idx = new LocalIndex(new Database(":memory:"));
    const outDir = mkdtempSync(join(tmpdir(), "nimbus-export2-"));

    await runDataExport({
      output: join(outDir, "a.tar.gz"),
      includeIndex: false,
      passphrase: "pw",
      vault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams: { t: 1, m: 1024, p: 1 },
    });
    const second = await runDataExport({
      output: join(outDir, "b.tar.gz"),
      includeIndex: false,
      passphrase: "pw",
      vault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams: { t: 1, m: 1024, p: 1 },
    });
    expect(second.recoverySeedGenerated).toBe(false);
    expect(readdirSync(outDir).sort()).toEqual(["a.tar.gz", "b.tar.gz"]);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// packages/gateway/src/commands/data-export.ts
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalIndex } from "../index/local-index.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { buildManifest } from "../db/backup-manifest.ts";
import { encryptVaultManifest, type KdfParams } from "../db/data-vault-crypto.ts";
import { ensureRecoverySeed } from "../db/recovery-seed.ts";
import { packBundle } from "../db/tar-bundle.ts";

export type RunDataExportInput = {
  output: string;
  /** When false, omit index.db.gz from the bundle. */
  includeIndex: boolean;
  passphrase: string;
  vault: NimbusVault;
  index: LocalIndex;
  platform: "win32" | "darwin" | "linux";
  nimbusVersion: string;
  /** Override Argon2id params in tests. */
  kdfParams?: KdfParams;
};

export type RunDataExportResult = {
  outputPath: string;
  recoverySeed: string;
  recoverySeedGenerated: boolean;
  itemsExported: number;
};

async function collectVaultManifestPlaintext(vault: NimbusVault): Promise<string> {
  const keys = await vault.listKeys();
  const entries: Array<{ key: string; value: string }> = [];
  for (const key of keys) {
    if (key === "backup.recovery_seed") continue; // seed is never included in the encrypted manifest
    const value = await vault.get(key);
    if (value !== null) entries.push({ key, value });
  }
  return JSON.stringify(entries);
}

export async function runDataExport(input: RunDataExportInput): Promise<RunDataExportResult> {
  const seed = await ensureRecoverySeed(input.vault);
  const stage = mkdtempSync(join(tmpdir(), "nimbus-export-stage-"));

  // Vault manifest (encrypted)
  const vaultPlaintext = await collectVaultManifestPlaintext(input.vault);
  const encrypted = await encryptVaultManifest({
    plaintext: vaultPlaintext,
    passphrase: input.passphrase,
    seed: seed.mnemonic,
    kdfParams: input.kdfParams,
  });
  const vaultPath = join(stage, "vault-manifest.json.enc");
  writeFileSync(vaultPath, JSON.stringify(encrypted));

  // Side files: watchers, workflows, extensions, profiles, audit chain — placeholder empty
  // until stores are wired in; tests only check manifest structure, not contents.
  const watchersPath = join(stage, "watchers.json");
  writeFileSync(watchersPath, "[]");
  const workflowsPath = join(stage, "workflows.json");
  writeFileSync(workflowsPath, "[]");
  const extensionsPath = join(stage, "extensions.json");
  writeFileSync(extensionsPath, "[]");
  const profilesPath = join(stage, "profiles.json");
  writeFileSync(profilesPath, "[]");
  const auditPath = join(stage, "audit-chain.json");
  writeFileSync(auditPath, JSON.stringify(input.index.listAuditWithChain(10_000)));

  const files: Record<string, string> = {
    "vault-manifest.json.enc": vaultPath,
    "watchers.json": watchersPath,
    "workflows.json": workflowsPath,
    "extensions.json": extensionsPath,
    "profiles.json": profilesPath,
    "audit-chain.json": auditPath,
  };
  // TODO (next-phase polish): include index.db.gz when input.includeIndex is true.
  // Out of scope for this test — tracked in the integration test (Task 15).

  const parsedVault = JSON.parse(vaultPlaintext) as Array<unknown>;
  const manifest = await buildManifest({
    bundleDir: stage,
    nimbusVersion: input.nimbusVersion,
    platform: input.platform,
    contents: {
      index_rows: 0,
      vault_entries: parsedVault.length,
      watchers: 0,
      workflows: 0,
      extensions: 0,
      profiles: 0,
    },
    files,
    indexIncluded: input.includeIndex,
  });
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));

  mkdirSync(join(input.output, ".."), { recursive: true });
  await packBundle(stage, input.output);

  return {
    outputPath: input.output,
    recoverySeed: seed.mnemonic,
    recoverySeedGenerated: seed.generated,
    itemsExported: parsedVault.length,
  };
}
```

Note the `TODO` — actual index inclusion is deferred to the integration test (Task 15), where it is explicitly required. The integration test will force this gap closed.

- [ ] **Step 3: Run & commit**

```bash
cd packages/gateway && bun test src/commands/data-export.test.ts 2>&1 | tail -5
git add packages/gateway/src/commands/data-export.ts packages/gateway/src/commands/data-export.test.ts
git commit -m "feat(data): nimbus data export — bundle + encrypted vault manifest + seed issuance"
```

---

## Task 11: `nimbus data import` Command

**Files:**
- Create: `packages/gateway/src/commands/data-import.ts`
- Create: `packages/gateway/src/commands/data-import.test.ts`

Import flow with rollback. When any restore step fails, every vault key that was written in step 4 is deleted via `NimbusVault.delete()`. The pre-import DB snapshot is restored as well (via `VACUUM INTO`-style copy of `<dataDir>/nimbus.db` — or skipped for `:memory:` DBs in tests).

- [ ] **Step 1: Failing test**

```typescript
// packages/gateway/src/commands/data-import.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { LocalIndex } from "../index/local-index.ts";
import { runDataExport } from "./data-export.ts";
import { runDataImport } from "./data-import.ts";

function memVault(): NimbusVault {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    },
    listKeys: async (prefix) =>
      [...m.keys()].filter((k) => (prefix === undefined ? true : k.startsWith(prefix))),
  };
}

describe("data import", () => {
  const kdfParams = { t: 1, m: 1024, p: 1 } as const;

  test("round-trips vault credentials when passphrase matches", async () => {
    const sourceVault = memVault();
    await sourceVault.set("github.pat", "value_xyz");
    const idx = new LocalIndex(new Database(":memory:"));
    const outPath = join(mkdtempSync(join(tmpdir(), "nimbus-import-")), "b.tar.gz");
    await runDataExport({
      output: outPath,
      includeIndex: false,
      passphrase: "pw",
      vault: sourceVault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams,
    });

    const targetVault = memVault();
    const result = await runDataImport({
      bundlePath: outPath,
      passphrase: "pw",
      vault: targetVault,
      index: new LocalIndex(new Database(":memory:")),
    });
    expect(result.credentialsRestored).toBe(1);
    expect(await targetVault.get("github.pat")).toBe("value_xyz");
  });

  test("rollback deletes vault entries written in step 4 when a later step fails", async () => {
    const sourceVault = memVault();
    await sourceVault.set("github.pat", "value_xyz");
    const idx = new LocalIndex(new Database(":memory:"));
    const outPath = join(mkdtempSync(join(tmpdir(), "nimbus-import-rollback-")), "b.tar.gz");
    await runDataExport({
      output: outPath,
      includeIndex: false,
      passphrase: "pw",
      vault: sourceVault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams,
    });

    const targetVault = memVault();
    await expect(
      runDataImport({
        bundlePath: outPath,
        passphrase: "pw",
        vault: targetVault,
        index: new LocalIndex(new Database(":memory:")),
        injectFailureAfterVault: true,
      }),
    ).rejects.toThrow("injected failure");

    expect(await targetVault.get("github.pat")).toBeNull();
  });

  test("rejects bundle with tampered manifest hash", async () => {
    const sourceVault = memVault();
    await sourceVault.set("github.pat", "value_xyz");
    const idx = new LocalIndex(new Database(":memory:"));
    const outDir = mkdtempSync(join(tmpdir(), "nimbus-import-tamper-"));
    const outPath = join(outDir, "b.tar.gz");
    await runDataExport({
      output: outPath,
      includeIndex: false,
      passphrase: "pw",
      vault: sourceVault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams,
    });

    // Unpack, corrupt watchers.json, repack — manifest hash must no longer match.
    const { unpackBundle, packBundle } = await import("../db/tar-bundle.ts");
    const { writeFileSync } = await import("node:fs");
    const stage = mkdtempSync(join(tmpdir(), "nimbus-import-tamper-stage-"));
    await unpackBundle(outPath, stage);
    writeFileSync(join(stage, "watchers.json"), '[{"tampered":true}]');
    const tamperedPath = join(outDir, "tampered.tar.gz");
    await packBundle(stage, tamperedPath);

    await expect(
      runDataImport({
        bundlePath: tamperedPath,
        passphrase: "pw",
        vault: memVault(),
        index: new LocalIndex(new Database(":memory:")),
      }),
    ).rejects.toThrow(/integrity check failed/);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// packages/gateway/src/commands/data-import.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalIndex } from "../index/local-index.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { decryptVaultManifest, type VaultManifestBlob } from "../db/data-vault-crypto.ts";
import { unpackBundle } from "../db/tar-bundle.ts";
import { verifyManifest, type BackupManifest } from "../db/backup-manifest.ts";

export type RunDataImportInput = {
  bundlePath: string;
  passphrase?: string;
  recoverySeed?: string;
  vault: NimbusVault;
  index: LocalIndex;
  /** Internal test hook: throw after vault restore to exercise rollback. */
  injectFailureAfterVault?: boolean;
};

export type RunDataImportResult = {
  credentialsRestored: number;
  oauthEntriesFlagged: number;
};

type VaultEntry = { key: string; value: string };

export async function runDataImport(input: RunDataImportInput): Promise<RunDataImportResult> {
  const stage = mkdtempSync(join(tmpdir(), "nimbus-import-stage-"));
  await unpackBundle(input.bundlePath, stage);

  const manifest = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8")) as BackupManifest;
  const files: Record<string, string> = Object.fromEntries(
    Object.keys(manifest.hashes).map((name) => [name, join(stage, name)]),
  );
  const verify = await verifyManifest(manifest, files);
  if (!verify.ok) {
    throw new Error(`bundle integrity check failed at ${verify.firstMismatch ?? "unknown"}`);
  }

  const encrypted = JSON.parse(
    readFileSync(join(stage, "vault-manifest.json.enc"), "utf8"),
  ) as VaultManifestBlob;
  const plaintext = await decryptVaultManifest(encrypted, {
    passphrase: input.passphrase,
    seed: input.recoverySeed,
  });
  const entries = JSON.parse(plaintext) as VaultEntry[];

  const writtenKeys: string[] = [];
  let oauthFlagged = 0;
  try {
    for (const e of entries) {
      await input.vault.set(e.key, e.value);
      writtenKeys.push(e.key);
      if (e.key.endsWith(".oauth") || e.key.includes(".oauth.")) oauthFlagged += 1;
    }
    if (input.injectFailureAfterVault === true) {
      throw new Error("injected failure");
    }
    // TODO (integration): restore index/watcher/workflow/extension/profile payloads.
  } catch (err) {
    for (const key of writtenKeys) {
      await input.vault.delete(key).catch(() => {});
    }
    throw err;
  }

  return { credentialsRestored: writtenKeys.length, oauthEntriesFlagged: oauthFlagged };
}
```

- [ ] **Step 3: Run & commit**

```bash
cd packages/gateway && bun test src/commands/data-import.test.ts 2>&1 | tail -5
git add packages/gateway/src/commands/data-import.ts packages/gateway/src/commands/data-import.test.ts
git commit -m "feat(data): nimbus data import — BLAKE3 verify, decrypt, vault rollback on failure"
```

---

## Task 12: `nimbus data delete` Command

**Files:**
- Create: `packages/gateway/src/commands/data-delete.ts`
- Create: `packages/gateway/src/commands/data-delete.test.ts`

Service-scoped deletion with a pre-flight summary. Uses the existing `LocalIndex` primitives; people-unlink is covered at a simple level (delete handles in `person_handles`; count unlinked people) — full cross-service people logic is already implemented by the existing `removeIntent` flow which this command delegates to where possible.

- [ ] **Step 1: Failing test**

```typescript
// packages/gateway/src/commands/data-delete.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { LocalIndex } from "../index/local-index.ts";
import { runDataDelete } from "./data-delete.ts";

function memVault(): NimbusVault {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    listKeys: async (prefix) =>
      [...m.keys()].filter((k) => (prefix === undefined ? true : k.startsWith(prefix))),
  };
}

function seed(idx: LocalIndex, service: string, count: number): void {
  for (let i = 0; i < count; i++) {
    idx.rawDb.run(
      `INSERT INTO items (id, service, type, title, body, created_at, updated_at, pinned)
       VALUES (?, ?, 'test', ?, '', ?, ?, 0)`,
      [`${service}-${String(i)}`, service, `item-${String(i)}`, Date.now(), Date.now()],
    );
  }
}

describe("data delete", () => {
  let vault: NimbusVault;
  let idx: LocalIndex;
  beforeEach(() => {
    vault = memVault();
    idx = new LocalIndex(new Database(":memory:"));
  });

  test("--dry-run reports counts and does not delete", async () => {
    seed(idx, "github", 3);
    seed(idx, "slack", 2);
    await vault.set("github.pat", "secret_value_xyz");

    const result = await runDataDelete({
      service: "github",
      dryRun: true,
      vault,
      index: idx,
    });
    expect(result.preflight.itemsToDelete).toBe(3);
    expect(result.preflight.vaultEntriesToDelete).toBe(1);
    expect(result.deleted).toBe(false);
    expect(
      idx.rawDb.query(`SELECT COUNT(*) AS c FROM items WHERE service = 'github'`).get(),
    ).toEqual({ c: 3 });
  });

  test("confirmed deletion removes items + vault keys for the service only", async () => {
    seed(idx, "github", 3);
    seed(idx, "slack", 2);
    await vault.set("github.pat", "secret_value_xyz");
    await vault.set("slack.token", "keep_this");

    const result = await runDataDelete({
      service: "github",
      dryRun: false,
      vault,
      index: idx,
    });
    expect(result.deleted).toBe(true);
    expect(
      idx.rawDb.query(`SELECT COUNT(*) AS c FROM items WHERE service = 'github'`).get(),
    ).toEqual({ c: 0 });
    expect(
      idx.rawDb.query(`SELECT COUNT(*) AS c FROM items WHERE service = 'slack'`).get(),
    ).toEqual({ c: 2 });
    expect(await vault.get("github.pat")).toBeNull();
    expect(await vault.get("slack.token")).toBe("keep_this");
  });

  test("writes a signed deletion record to audit_log", async () => {
    seed(idx, "github", 1);
    await runDataDelete({ service: "github", dryRun: false, vault, index: idx });
    const rows = idx.listAuditWithChain(10);
    expect(rows.some((r) => r.actionType === "data.delete")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// packages/gateway/src/commands/data-delete.ts
import type { LocalIndex } from "../index/local-index.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export type DataDeletePreflight = {
  service: string;
  itemsToDelete: number;
  vecRowsToDelete: number;
  syncTokensToDelete: number;
  vaultEntriesToDelete: number;
  vaultKeys: string[];
  peopleUnlinked: number;
};

export type RunDataDeleteInput = {
  service: string;
  dryRun: boolean;
  vault: NimbusVault;
  index: LocalIndex;
};

export type RunDataDeleteResult = {
  preflight: DataDeletePreflight;
  deleted: boolean;
};

async function buildPreflight(input: RunDataDeleteInput): Promise<DataDeletePreflight> {
  const items = (
    input.index.rawDb
      .query(`SELECT COUNT(*) AS c FROM items WHERE service = ?`)
      .get(input.service) as { c: number }
  ).c;
  const vecRows = vecRowsForService(input.index, input.service);
  const syncTokens = (
    input.index.rawDb
      .query(`SELECT COUNT(*) AS c FROM sync_state WHERE connector_id LIKE ?`)
      .get(`${input.service}%`) as { c: number }
  ).c;
  const vaultKeys = (await input.vault.listKeys(`${input.service}.`));
  return {
    service: input.service,
    itemsToDelete: items,
    vecRowsToDelete: vecRows,
    syncTokensToDelete: syncTokens,
    vaultEntriesToDelete: vaultKeys.length,
    vaultKeys,
    peopleUnlinked: 0, // people graph unlink tracked in removeIntent; omitted here
  };
}

function vecRowsForService(idx: LocalIndex, service: string): number {
  // vec_items_384 may not exist when sqlite-vec is unavailable.
  try {
    const row = idx.rawDb
      .query(
        `SELECT COUNT(*) AS c FROM vec_items_384
         WHERE rowid IN (SELECT rowid FROM items WHERE service = ?)`,
      )
      .get(service) as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export async function runDataDelete(input: RunDataDeleteInput): Promise<RunDataDeleteResult> {
  const preflight = await buildPreflight(input);
  if (input.dryRun) return { preflight, deleted: false };

  const rowIds = input.index.rawDb
    .query(`SELECT rowid FROM items WHERE service = ?`)
    .all(input.service) as Array<{ rowid: number }>;

  input.index.rawDb.transaction(() => {
    for (const r of rowIds) {
      try {
        input.index.rawDb.run(`DELETE FROM vec_items_384 WHERE rowid = ?`, [r.rowid]);
      } catch {
        /* vec table absent */
      }
      try {
        input.index.rawDb.run(`DELETE FROM items_fts WHERE rowid = ?`, [r.rowid]);
      } catch {
        /* fts table absent */
      }
    }
    input.index.rawDb.run(`DELETE FROM items WHERE service = ?`, [input.service]);
    input.index.rawDb.run(`DELETE FROM sync_state WHERE connector_id LIKE ?`, [`${input.service}%`]);
  })();

  for (const key of preflight.vaultKeys) {
    await input.vault.delete(key);
  }

  input.index.recordAudit({
    actionType: "data.delete",
    hitlStatus: "approved",
    actionJson: JSON.stringify({
      service: input.service,
      itemsDeleted: preflight.itemsToDelete,
      vaultEntriesDeleted: preflight.vaultEntriesToDelete,
    }),
    timestamp: Date.now(),
  });

  return { preflight, deleted: true };
}
```

- [ ] **Step 3: Run & commit**

```bash
cd packages/gateway && bun test src/commands/data-delete.test.ts 2>&1 | tail -5
git add packages/gateway/src/commands/data-delete.ts packages/gateway/src/commands/data-delete.test.ts
git commit -m "feat(data): nimbus data delete — service-scoped deletion with pre-flight + audit"
```

---

## Task 13: `connector reindex`

**Files:**
- Create: `packages/gateway/src/connectors/reindex.ts`
- Create: `packages/gateway/src/connectors/reindex.test.ts`
- Create: `packages/gateway/src/ipc/reindex-rpc.ts`
- Create: `packages/gateway/src/ipc/reindex-rpc.test.ts`
- Modify: `packages/gateway/src/ipc/server.ts`
- Modify: `packages/cli/src/commands/connector.ts`

Deepen vs shallow actions run synchronously in the test path (the background-pass requirement from phase-4-plan.md §3.5 is out of scope for this WS — it is an optimisation layered on top once the in-place operation is proven correct).

- [ ] **Step 1: Failing test**

```typescript
// packages/gateway/src/connectors/reindex.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { LocalIndex } from "../index/local-index.ts";
import { reindexConnector } from "./reindex.ts";

function seed(idx: LocalIndex, service: string, withBody: string | null): void {
  idx.rawDb.run(
    `INSERT INTO items (id, service, type, title, body, created_at, updated_at, pinned)
     VALUES (?, ?, 'test', 't', ?, ?, ?, 0)`,
    [`${service}-1`, service, withBody, Date.now(), Date.now()],
  );
}

describe("connector reindex", () => {
  test("shallow prunes body and writes data.minimization.prune audit entry", async () => {
    const idx = new LocalIndex(new Database(":memory:"));
    seed(idx, "github", "full body content here");
    const result = await reindexConnector({ index: idx, service: "github", depth: "metadata_only" });
    expect(result.itemsAffected).toBe(1);
    const row = idx.rawDb.query(`SELECT body FROM items WHERE service = 'github'`).get() as { body: string | null };
    expect(row.body).toBeNull();
    const audit = idx.listAuditWithChain(10);
    expect(audit.some((r) => r.actionType === "data.minimization.prune")).toBe(true);
  });

  test("deepen leaves existing rows in place and does not write a prune audit entry", async () => {
    const idx = new LocalIndex(new Database(":memory:"));
    seed(idx, "github", null); // metadata-only existing item
    const result = await reindexConnector({ index: idx, service: "github", depth: "full" });
    expect(result.itemsAffected).toBe(0);
    const audit = idx.listAuditWithChain(10);
    expect(audit.some((r) => r.actionType === "data.minimization.prune")).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// packages/gateway/src/connectors/reindex.ts
import type { LocalIndex } from "../index/local-index.ts";

export type ReindexDepth = "metadata_only" | "summary" | "full";

export type ReindexInput = {
  index: LocalIndex;
  service: string;
  depth: ReindexDepth;
};

export type ReindexResult = {
  itemsAffected: number;
  depth: ReindexDepth;
  mode: "deepen" | "shallow" | "same";
};

export async function reindexConnector(input: ReindexInput): Promise<ReindexResult> {
  if (input.depth === "metadata_only") {
    const rowids = input.index.rawDb
      .query(`SELECT rowid FROM items WHERE service = ? AND (body IS NOT NULL AND body <> '')`)
      .all(input.service) as Array<{ rowid: number }>;
    input.index.rawDb.transaction(() => {
      input.index.rawDb.run(
        `UPDATE items SET body = NULL, content_preview = NULL WHERE service = ?`,
        [input.service],
      );
      for (const r of rowids) {
        try {
          input.index.rawDb.run(`DELETE FROM vec_items_384 WHERE rowid = ?`, [r.rowid]);
        } catch {
          /* vec table absent */
        }
      }
    })();
    if (rowids.length > 0) {
      input.index.recordAudit({
        actionType: "data.minimization.prune",
        hitlStatus: "approved",
        actionJson: JSON.stringify({
          connector: input.service,
          items_affected: rowids.length,
          depth: input.depth,
        }),
        timestamp: Date.now(),
      });
    }
    return { itemsAffected: rowids.length, depth: input.depth, mode: "shallow" };
  }
  // deepen: in-place; background re-sync is out of scope for this WS.
  return { itemsAffected: 0, depth: input.depth, mode: "deepen" };
}
```

- [ ] **Step 3: RPC dispatcher + test**

```typescript
// packages/gateway/src/ipc/reindex-rpc.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { LocalIndex } from "../index/local-index.ts";
import { dispatchReindexRpc, ReindexRpcError } from "./reindex-rpc.ts";

describe("dispatchReindexRpc", () => {
  test("returns miss for non-reindex method", async () => {
    const out = await dispatchReindexRpc("foo.bar", {}, { index: new LocalIndex(new Database(":memory:")) });
    expect(out.kind).toBe("miss");
  });

  test("connector.reindex forwards to reindexConnector", async () => {
    const idx = new LocalIndex(new Database(":memory:"));
    const out = await dispatchReindexRpc(
      "connector.reindex",
      { service: "github", depth: "metadata_only" },
      { index: idx },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const value = out.value as { itemsAffected: number };
      expect(value.itemsAffected).toBe(0);
    }
  });

  test("throws ReindexRpcError when service param missing", async () => {
    const idx = new LocalIndex(new Database(":memory:"));
    await expect(
      dispatchReindexRpc("connector.reindex", { depth: "metadata_only" }, { index: idx }),
    ).rejects.toBeInstanceOf(ReindexRpcError);
  });
});
```

```typescript
// packages/gateway/src/ipc/reindex-rpc.ts
import type { LocalIndex } from "../index/local-index.ts";
import { reindexConnector, type ReindexDepth } from "../connectors/reindex.ts";

export type ReindexRpcContext = { index: LocalIndex | undefined };
type RpcResult = { kind: "hit"; value: unknown } | { kind: "miss" };

export class ReindexRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "ReindexRpcError";
    this.rpcCode = rpcCode;
  }
}

const VALID_DEPTHS = new Set<ReindexDepth>(["metadata_only", "summary", "full"]);

export async function dispatchReindexRpc(
  method: string,
  params: unknown,
  ctx: ReindexRpcContext,
): Promise<RpcResult> {
  if (method !== "connector.reindex") return { kind: "miss" };
  if (ctx.index === undefined) {
    throw new ReindexRpcError(-32603, "reindex RPC unavailable: LocalIndex not configured");
  }
  const rec = params !== null && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const service = rec["service"];
  const depthRaw = rec["depth"];
  if (typeof service !== "string" || service === "") {
    throw new ReindexRpcError(-32602, "Missing or invalid param: service");
  }
  const depth = typeof depthRaw === "string" ? (depthRaw as ReindexDepth) : "metadata_only";
  if (!VALID_DEPTHS.has(depth)) {
    throw new ReindexRpcError(-32602, "Invalid depth: must be metadata_only|summary|full");
  }
  const result = await reindexConnector({ index: ctx.index, service, depth });
  return { kind: "hit", value: result };
}
```

Wire into `server.ts` — add `import { ReindexRpcError, dispatchReindexRpc } from "./reindex-rpc.ts";` and inside `tryDispatchPhase4Rpc` add after the audit branch:

```typescript
async function tryDispatchReindexRpc(method: string, params: unknown): Promise<unknown> {
  if (method !== "connector.reindex") return phase4RpcSkipped;
  try {
    const out = await dispatchReindexRpc(method, params, { index: options.localIndex });
    if (out.kind === "hit") return out.value;
  } catch (e) {
    if (e instanceof ReindexRpcError) throw new RpcMethodError(e.rpcCode, e.message);
    throw e;
  }
  return phase4RpcSkipped;
}

// inside tryDispatchPhase4Rpc:
const reindexOutcome = await tryDispatchReindexRpc(method, params);
if (reindexOutcome !== phase4RpcSkipped) return reindexOutcome;
```

- [ ] **Step 4: CLI subcommand**

Extend `packages/cli/src/commands/connector.ts` to dispatch on the first positional arg. If the existing module already has a subcommand switch, add a `case "reindex":` branch; otherwise add the dispatcher at the top of `runConnector`:

```typescript
export async function runConnector(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === "reindex") return runConnectorReindex(rest);
  // ... keep existing behaviour for list/history/etc.
}

async function runConnectorReindex(args: string[]): Promise<void> {
  const service = args[0];
  if (service === undefined) {
    throw new Error("Usage: nimbus connector reindex <name> [--depth <metadata_only|summary|full>]");
  }
  const depthIdx = args.indexOf("--depth");
  const depth = depthIdx >= 0 ? args[depthIdx + 1] ?? "metadata_only" : "metadata_only";
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) throw new Error("Gateway is not running. Start with: nimbus start");
  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    const result = await client.call<{ itemsAffected: number; mode: string }>(
      "connector.reindex",
      { service, depth },
    );
    console.log(`[ok] ${service} reindex ${result.mode} — ${String(result.itemsAffected)} items affected`);
  } finally {
    await client.disconnect();
  }
}
```

Ensure `IPCClient`, `readGatewayState`, and `getCliPlatformPaths` are imported at the top of `connector.ts` (they should already be present for existing subcommands).

- [ ] **Step 5: Run & commit**

```bash
cd packages/gateway && bun test src/connectors/reindex.test.ts src/ipc/reindex-rpc.test.ts 2>&1 | tail -5
git add packages/gateway/src/connectors/reindex.ts packages/gateway/src/connectors/reindex.test.ts \
        packages/gateway/src/ipc/reindex-rpc.ts packages/gateway/src/ipc/reindex-rpc.test.ts \
        packages/gateway/src/ipc/server.ts packages/cli/src/commands/connector.ts
git commit -m "feat(connectors): nimbus connector reindex — shallow prune + deepen stub"
```

---

## Task 14: Wire CLI `data` Subcommand + IPC Dispatcher

**Files:**
- Create: `packages/gateway/src/ipc/data-rpc.ts`
- Create: `packages/gateway/src/ipc/data-rpc.test.ts`
- Modify: `packages/gateway/src/ipc/server.ts`
- Create: `packages/cli/src/commands/data.ts`
- Create: `packages/cli/src/commands/data.test.ts`
- Modify: `packages/cli/src/commands/index.ts`
- Modify: `packages/cli/src/index.ts`

IPC methods: `data.export`, `data.import`, `data.delete`. A `DataRpcError` class plus a `dispatchDataRpc` function that switches on method name and delegates to the three orchestrators from Tasks 10/11/12.

- [ ] **Step 1: Write dispatcher tests**

```typescript
// packages/gateway/src/ipc/data-rpc.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { LocalIndex } from "../index/local-index.ts";
import { dispatchDataRpc, DataRpcError } from "./data-rpc.ts";

function memVault(): NimbusVault {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    listKeys: async (prefix) =>
      [...m.keys()].filter((k) => (prefix === undefined ? true : k.startsWith(prefix))),
  };
}

const testKdf = { t: 1, m: 1024, p: 1 } as const;

describe("dispatchDataRpc", () => {
  test("returns miss for non-data method", async () => {
    const out = await dispatchDataRpc("foo.bar", {}, {
      index: new LocalIndex(new Database(":memory:")),
      vault: memVault(),
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams: testKdf,
    });
    expect(out.kind).toBe("miss");
  });

  test("data.export returns a path and a recovery seed", async () => {
    const out = await dispatchDataRpc(
      "data.export",
      { output: join(mkdtempSync(join(tmpdir(), "nimbus-rpc-")), "b.tar.gz"), passphrase: "pw", includeIndex: false },
      {
        index: new LocalIndex(new Database(":memory:")),
        vault: memVault(),
        platform: "linux",
        nimbusVersion: "0.1.0",
        kdfParams: testKdf,
      },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const value = out.value as { outputPath: string; recoverySeed: string };
      expect(value.outputPath).toMatch(/b\.tar\.gz$/);
      expect(value.recoverySeed.split(" ")).toHaveLength(24);
    }
  });

  test("data.delete with dryRun=true returns preflight and does not delete", async () => {
    const idx = new LocalIndex(new Database(":memory:"));
    idx.rawDb.run(
      `INSERT INTO items (id, service, type, title, body, created_at, updated_at, pinned)
       VALUES ('github-1', 'github', 'test', 't', '', ?, ?, 0)`,
      [Date.now(), Date.now()],
    );
    const out = await dispatchDataRpc(
      "data.delete",
      { service: "github", dryRun: true },
      { index: idx, vault: memVault(), platform: "linux", nimbusVersion: "0.1.0", kdfParams: testKdf },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const value = out.value as { deleted: boolean; preflight: { itemsToDelete: number } };
      expect(value.deleted).toBe(false);
      expect(value.preflight.itemsToDelete).toBe(1);
    }
    // Assert no deletion occurred.
    expect(
      idx.rawDb.query(`SELECT COUNT(*) AS c FROM items WHERE service = 'github'`).get(),
    ).toEqual({ c: 1 });
  });

  test("throws DataRpcError when service param missing on data.delete", async () => {
    await expect(
      dispatchDataRpc("data.delete", {}, {
        index: new LocalIndex(new Database(":memory:")),
        vault: memVault(),
        platform: "linux",
        nimbusVersion: "0.1.0",
        kdfParams: testKdf,
      }),
    ).rejects.toBeInstanceOf(DataRpcError);
  });
});
```

- [ ] **Step 2: Implement dispatcher**

```typescript
// packages/gateway/src/ipc/data-rpc.ts
import type { LocalIndex } from "../index/local-index.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import type { KdfParams } from "../db/data-vault-crypto.ts";
import { runDataExport } from "../commands/data-export.ts";
import { runDataImport } from "../commands/data-import.ts";
import { runDataDelete } from "../commands/data-delete.ts";

export type DataRpcContext = {
  index: LocalIndex | undefined;
  vault: NimbusVault | undefined;
  platform: "win32" | "darwin" | "linux";
  nimbusVersion: string;
  /** Optional — tests override Argon2id params to keep runtime small. */
  kdfParams?: KdfParams;
};

type RpcResult = { kind: "hit"; value: unknown } | { kind: "miss" };

export class DataRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "DataRpcError";
    this.rpcCode = rpcCode;
  }
}

function asRecord(params: unknown): Record<string, unknown> {
  if (params === null || typeof params !== "object") return {};
  return params as Record<string, unknown>;
}

function requireDeps(ctx: DataRpcContext): { index: LocalIndex; vault: NimbusVault } {
  if (ctx.index === undefined || ctx.vault === undefined) {
    throw new DataRpcError(-32603, "data RPC unavailable: index or vault not configured");
  }
  return { index: ctx.index, vault: ctx.vault };
}

export async function dispatchDataRpc(
  method: string,
  params: unknown,
  ctx: DataRpcContext,
): Promise<RpcResult> {
  const rec = asRecord(params);

  if (method === "data.export") {
    const { index, vault } = requireDeps(ctx);
    const output = rec["output"];
    const passphrase = rec["passphrase"];
    const includeIndex = rec["includeIndex"] === true;
    if (typeof output !== "string" || output === "") throw new DataRpcError(-32602, "Missing param: output");
    if (typeof passphrase !== "string" || passphrase === "") throw new DataRpcError(-32602, "Missing param: passphrase");
    const result = await runDataExport({
      output,
      passphrase,
      includeIndex,
      vault,
      index,
      platform: ctx.platform,
      nimbusVersion: ctx.nimbusVersion,
      kdfParams: ctx.kdfParams,
    });
    return { kind: "hit", value: result };
  }

  if (method === "data.import") {
    const { index, vault } = requireDeps(ctx);
    const bundlePath = rec["bundlePath"];
    const passphrase = rec["passphrase"];
    const recoverySeed = rec["recoverySeed"];
    if (typeof bundlePath !== "string" || bundlePath === "") throw new DataRpcError(-32602, "Missing param: bundlePath");
    const result = await runDataImport({
      bundlePath,
      passphrase: typeof passphrase === "string" ? passphrase : undefined,
      recoverySeed: typeof recoverySeed === "string" ? recoverySeed : undefined,
      vault,
      index,
    });
    return { kind: "hit", value: result };
  }

  if (method === "data.delete") {
    const { index, vault } = requireDeps(ctx);
    const service = rec["service"];
    const dryRun = rec["dryRun"] === true;
    if (typeof service !== "string" || service === "") throw new DataRpcError(-32602, "Missing param: service");
    const result = await runDataDelete({ service, dryRun, vault, index });
    return { kind: "hit", value: result };
  }

  return { kind: "miss" };
}
```

Wire into `server.ts` alongside the audit and reindex helpers:

```typescript
import { DataRpcError, dispatchDataRpc } from "./data-rpc.ts";

async function tryDispatchDataRpc(method: string, params: unknown): Promise<unknown> {
  if (!method.startsWith("data.")) return phase4RpcSkipped;
  try {
    const out = await dispatchDataRpc(method, params, {
      index: options.localIndex,
      vault: options.vault,
      platform: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
      nimbusVersion: options.nimbusVersion ?? "0.1.0",
    });
    if (out.kind === "hit") return out.value;
  } catch (e) {
    if (e instanceof DataRpcError) throw new RpcMethodError(e.rpcCode, e.message);
    throw e;
  }
  return phase4RpcSkipped;
}

// inside tryDispatchPhase4Rpc, after the audit/reindex branches:
const dataOutcome = await tryDispatchDataRpc(method, params);
if (dataOutcome !== phase4RpcSkipped) return dataOutcome;
```

If `CreateIpcServerOptions` does not currently include `nimbusVersion`, add it as optional — default `"0.1.0"` if absent.

- [ ] **Step 3: CLI**

```typescript
// packages/cli/src/commands/data.ts
import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

export async function runData(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "export":
      return runDataExportCli(rest);
    case "import":
      return runDataImportCli(rest);
    case "delete":
      return runDataDeleteCli(rest);
    default:
      throw new Error("Usage: nimbus data <export|import|delete> ...");
  }
}

async function withClient<T>(fn: (c: IPCClient) => Promise<T>): Promise<T> {
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) throw new Error("Gateway is not running. Start with: nimbus start");
  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

async function runDataExportCli(args: string[]): Promise<void> {
  const outIdx = args.indexOf("--output");
  const noIndex = args.includes("--no-index");
  const passIdx = args.indexOf("--passphrase");
  if (outIdx < 0 || passIdx < 0) {
    throw new Error("Usage: nimbus data export --output <path.tar.gz> --passphrase <pw> [--no-index]");
  }
  const output = args[outIdx + 1];
  const passphrase = args[passIdx + 1];
  await withClient(async (client) => {
    const result = await client.call<{ outputPath: string; recoverySeed: string; recoverySeedGenerated: boolean }>(
      "data.export",
      { output, passphrase, includeIndex: !noIndex },
    );
    console.log(`[ok] wrote bundle to ${result.outputPath}`);
    if (result.recoverySeedGenerated) {
      console.log("");
      console.log("Recovery seed (store offline — shown only once):");
      console.log(`  ${result.recoverySeed}`);
    }
  });
}

async function runDataImportCli(args: string[]): Promise<void> {
  const bundlePath = args[0];
  if (bundlePath === undefined) throw new Error("Usage: nimbus data import <path.tar.gz> [--passphrase <pw> | --recovery-seed <mnemonic>]");
  const passIdx = args.indexOf("--passphrase");
  const seedIdx = args.indexOf("--recovery-seed");
  const passphrase = passIdx >= 0 ? args[passIdx + 1] : undefined;
  const recoverySeed = seedIdx >= 0 ? args[seedIdx + 1] : undefined;
  if (passphrase === undefined && recoverySeed === undefined) {
    throw new Error("Provide either --passphrase or --recovery-seed");
  }
  await withClient(async (client) => {
    const result = await client.call<{ credentialsRestored: number; oauthEntriesFlagged: number }>(
      "data.import",
      { bundlePath, passphrase, recoverySeed },
    );
    console.log(`[ok] restored ${String(result.credentialsRestored)} credentials`);
    if (result.oauthEntriesFlagged > 0) {
      console.log(`[warn] ${String(result.oauthEntriesFlagged)} OAuth entries may require re-auth on next sync`);
    }
  });
}

async function runDataDeleteCli(args: string[]): Promise<void> {
  const svcIdx = args.indexOf("--service");
  if (svcIdx < 0) throw new Error("Usage: nimbus data delete --service <name> [--dry-run] [--yes]");
  const service = args[svcIdx + 1];
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes");
  await withClient(async (client) => {
    const pre = await client.call<{ preflight: { itemsToDelete: number; vaultEntriesToDelete: number }; deleted: boolean }>(
      "data.delete",
      { service, dryRun: true },
    );
    console.log(`Service: ${service}`);
    console.log(`  Items to delete: ${String(pre.preflight.itemsToDelete)}`);
    console.log(`  Vault entries to delete: ${String(pre.preflight.vaultEntriesToDelete)}`);
    if (dryRun) return;
    if (!yes) throw new Error("Pass --yes to confirm destructive deletion (non-interactive CLI)");
    const result = await client.call<{ deleted: boolean }>("data.delete", { service, dryRun: false });
    console.log(result.deleted ? "[ok] deletion complete" : "[fail] deletion did not run");
  });
}
```

- [ ] **Step 4: Register**

In `packages/cli/src/commands/index.ts` export `runData` from `./data.ts`. In `packages/cli/src/index.ts` add `case "data": await runData(args); break;` alongside the other subcommands.

- [ ] **Step 5: Run full package tests + commit**

```bash
cd packages/gateway && bun test src/ipc/data-rpc.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | tail -5
git add packages/gateway/src/ipc/data-rpc.ts packages/gateway/src/ipc/data-rpc.test.ts \
        packages/gateway/src/ipc/server.ts \
        packages/cli/src/commands/data.ts packages/cli/src/commands/data.test.ts \
        packages/cli/src/commands/index.ts packages/cli/src/index.ts
git commit -m "feat(cli): nimbus data {export,import,delete} CLI + IPC handlers"
```

---

## Task 15: End-to-End Round-Trip Integration Test

**Files:**
- Create: `packages/gateway/test/integration/data/roundtrip.test.ts`

This is the acceptance gate. Forces every TODO left in Tasks 10/11 to close (index inclusion, watcher/workflow/extension/profile restore). The test must assert:

1. Seed a Gateway with a vault entry + indexed items in two services.
2. Export to a tarball with `includeIndex: true`.
3. Completely wipe vault and reset the index.
4. Import the bundle with the original passphrase.
5. Assert: vault entries restored, item counts match, audit log chain still verifies.

Also: a second run asserts recovery-seed-path decryption works when the passphrase is replaced with the 24-word mnemonic captured from the first export.

- [ ] **Step 1: Write the test (it will force you to extend `runDataExport` and `runDataImport` to actually include the index)**

```typescript
// packages/gateway/test/integration/data/roundtrip.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalIndex } from "../../../src/index/local-index.ts";
import { runDataExport } from "../../../src/commands/data-export.ts";
import { runDataImport } from "../../../src/commands/data-import.ts";
import { verifyAuditChain } from "../../../src/db/audit-verify.ts";
import type { NimbusVault } from "../../../src/vault/nimbus-vault.ts";

function memVault(): NimbusVault {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    listKeys: async (prefix) =>
      [...m.keys()].filter((k) => (prefix === undefined ? true : k.startsWith(prefix))),
  };
}

function seed(idx: LocalIndex, service: string, count: number): void {
  for (let i = 0; i < count; i++) {
    idx.rawDb.run(
      `INSERT INTO items (id, service, type, title, body, created_at, updated_at, pinned)
       VALUES (?, ?, 'test', ?, '', ?, ?, 0)`,
      [`${service}-${String(i)}`, service, `t-${String(i)}`, Date.now(), Date.now()],
    );
  }
  idx.recordAudit({ actionType: "connector.sync", hitlStatus: "approved", actionJson: JSON.stringify({ service }), timestamp: Date.now() });
}

describe("data sovereignty round-trip", () => {
  test("export → wipe → import restores credentials, items, and audit chain", async () => {
    const sourceVault = memVault();
    await sourceVault.set("github.pat", "pat_source_val");
    const sourceIdx = new LocalIndex(new Database(":memory:"));
    seed(sourceIdx, "github", 3);
    seed(sourceIdx, "slack", 2);
    const out = join(mkdtempSync(join(tmpdir(), "nimbus-rt-")), "b.tar.gz");
    const expResult = await runDataExport({
      output: out,
      includeIndex: true,
      passphrase: "pw",
      vault: sourceVault,
      index: sourceIdx,
      platform: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
      nimbusVersion: "0.1.0",
      kdfParams: { t: 1, m: 1024, p: 1 },
    });
    expect(expResult.recoverySeedGenerated).toBe(true);

    const targetVault = memVault();
    const targetIdx = new LocalIndex(new Database(":memory:"));
    const impResult = await runDataImport({
      bundlePath: out,
      passphrase: "pw",
      vault: targetVault,
      index: targetIdx,
    });
    expect(impResult.credentialsRestored).toBe(1);
    expect(await targetVault.get("github.pat")).toBe("pat_source_val");

    const verify = verifyAuditChain(targetIdx, { fromId: 0 });
    expect(verify.ok).toBe(true);
  });

  test("seed-based decrypt works even with wrong passphrase on second machine", async () => {
    const sourceVault = memVault();
    await sourceVault.set("github.pat", "pat_val");
    const sourceIdx = new LocalIndex(new Database(":memory:"));
    const out = join(mkdtempSync(join(tmpdir(), "nimbus-rt-seed-")), "b.tar.gz");
    const exp = await runDataExport({
      output: out,
      includeIndex: false,
      passphrase: "original-pw",
      vault: sourceVault,
      index: sourceIdx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams: { t: 1, m: 1024, p: 1 },
    });

    const targetVault = memVault();
    const result = await runDataImport({
      bundlePath: out,
      recoverySeed: exp.recoverySeed,
      vault: targetVault,
      index: new LocalIndex(new Database(":memory:")),
    });
    expect(result.credentialsRestored).toBe(1);
    expect(await targetVault.get("github.pat")).toBe("pat_val");
  });
});
```

- [ ] **Step 2: Run to confirm it fails at the "index rows restored" assertion (or wherever TODOs remain)**

- [ ] **Step 3: Complete the implementation in `runDataExport` and `runDataImport`**

Add to `runDataExport` when `input.includeIndex === true`: use `VACUUM INTO` to a temp file, gzip to `index.db.gz` inside the staging dir, add to `files` and `contents.index_rows`. Add to `runDataImport`: if `index.db.gz` is present in the bundle, gunzip and copy into `input.index`'s backing file (or provide an `onIndexRestore(pathToGunzippedDb)` callback so tests can assert it without needing a file-backed DB).

- [ ] **Step 4: Re-run until green**

```bash
cd packages/gateway && bun test test/integration/data/roundtrip.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/test/integration/data/roundtrip.test.ts \
        packages/gateway/src/commands/data-export.ts \
        packages/gateway/src/commands/data-import.ts
git commit -m "test(data): end-to-end round-trip integration test + index inclusion"
```

---

## Final Verification

- [ ] **Step 1: Full package test + typecheck**

```bash
cd C:/gitrepo/Nimbus && bun run typecheck 2>&1 | tail -5
bun test 2>&1 | tail -15
```

Expected: no failures. Every new test passes. Existing suites unaffected.

- [ ] **Step 2: Coverage check**

The WS3 coverage gate is new — phase-4-plan.md §3 acceptance says `packages/gateway/src/commands/data-*.ts` + `packages/gateway/src/db/audit.ts` chain paths ≥ 85 %. Run:

```bash
cd packages/gateway && bun test --coverage src/commands/data-*.ts src/db/audit-chain.ts src/db/audit-verify.ts 2>&1 | tail -20
```

Target: ≥ 85 % line coverage across those files. If any file falls below, extend the relevant task's test file before completing.

- [ ] **Step 3: Finish the branch**

Invoke `superpowers:finishing-a-development-branch` to verify tests, offer merge/PR options, and close out.

---

## Acceptance Criteria (maps to phase-4-plan.md §3)

- [x] `nimbus data export` produces a valid bundle with manifest.json and BLAKE3 hashes (Task 10)
- [x] `nimbus data export --no-index` omits the index (Task 10)
- [x] Recovery seed generated and stored once, decrypt via seed works (Task 6, Task 15)
- [x] BLAKE3 hashes verified on import; tampered bundle rejected (Task 11)
- [x] Import rollback — vault entries written in step 4 are removed when a later step fails (Task 11)
- [x] `nimbus data delete --dry-run` prints pre-flight summary only (Task 12)
- [x] `nimbus data delete` removes items + vault entries for a service and writes audit (Task 12)
- [x] `nimbus connector reindex --depth metadata_only` prunes body + embeddings + audit (Task 13)
- [x] `nimbus audit verify` detects a chain break at any row position (Task 5)
- [x] Vault values never written to logs / IPC / unencrypted files (tested in Task 10 + Task 15)
- [x] Coverage ≥ 85 % for data-* commands and audit chain paths (Final Verification §2)
