---
name: nimbus-db-migrations
description: >
  Reference for authoring SQLite migrations in the Nimbus Gateway: file location and
  numbering, the runner contract (transaction wrapping, pre-migration backups, ledger
  recording), the append-only schema rule, large-backfill batching, the _schema_migrations
  ledger, the new-table checklist, and FTS5/vec0 virtual-table cautions. Use this skill
  whenever the user is adding a schema migration, modifying an existing one, debugging
  a failed migration, asking why a migration cannot be rolled back, or adding a new
  table or column. Also trigger for questions like "what V<N> number do I use?", "can
  I drop this column?", "how do I backfill safely?", or "where does the pre-migration
  backup live?". Consult before creating any file under packages/gateway/src/db/migrations/.
---

# Nimbus DB Migrations

## Migration Location

All migrations live in `packages/gateway/src/db/migrations/`. Each migration is a numbered TypeScript file:

```
V<N>__<description>.ts
```

Example: `V23__add_api_endpoint_items.ts`.

**Numbers are strictly sequential — never reuse or skip a number.**

## Migration Runner Contract

The runner in `packages/gateway/src/db/migrate.ts`:

- Applies migrations in order.
- Wraps each migration in **a single transaction**.
- Writes a **pre-migration backup** before each migration runs.
- Records each migration in `_schema_migrations` on success.
- On a thrown migration: rolls back the transaction, restores the backup, marks the migration `failed` in the ledger, and exits with an error.

**Never write a migration that cannot be safely rolled back within a transaction.**

## Pre-migration Backup Rule

The backup is written by the runner automatically before every migration. **Never skip it.** If the backup write fails, the migration is **aborted** — this is intentional.

The backup lives at:

```
<dataDir>/backups/pre-migration-V<N>-<timestamp>.db
```

## Migration File Structure

Every migration file must export exactly one function:

```typescript
export async function up(db: Database): Promise<void> {
  // All SQL in one transaction — the runner wraps this call
  db.run("CREATE TABLE ...");
  db.run("CREATE INDEX ...");
}
```

**No `down()` function** — Nimbus migrations are append-only and forward-only. If you need to undo a migration, write a new migration that reverses it.

## Append-only Schema Rule

**Never** drop a column, rename a column, or drop a table in a migration unless it was added in the same phase and has no data.

Additive changes only:

- `CREATE TABLE`
- `CREATE INDEX`
- `ALTER TABLE ADD COLUMN`
- `CREATE VIRTUAL TABLE`

If a column rename is truly necessary: add the new column, backfill it, and **leave the old column in place with a deprecation comment**.

## Large Backfill Pattern

Migrations that backfill existing rows must process in batches to avoid locking the DB for extended periods:

```typescript
const BATCH = 1000;
let offset = 0;
while (true) {
  const rows = db.query("SELECT id FROM table LIMIT ? OFFSET ?").all(BATCH, offset);
  if (rows.length === 0) break;
  db.transaction(() => { /* update rows */ })();
  offset += BATCH;
}
```

**Never process an unbounded number of rows in a single statement inside a migration.**

## `_schema_migrations` Ledger

Columns:

| Column | Type | Notes |
|---|---|---|
| `version` | integer | the `V<N>` number |
| `description` | text | from the filename |
| `applied_at` | integer | unix ms |
| `status` | `applied` \| `failed` | runner-managed |

The runner inserts a row with `status = 'applied'` after each successful migration. **Never write to this table manually.**

## New Table Checklist

When adding a new table, always include:

- A primary key.
- `created_at INTEGER NOT NULL` (unix ms).
- Appropriate indexes for the expected query patterns.
- A `CHECK` constraint on any enum-like column.
- An entry in the schema reference in `docs/architecture.md` under "Local Database Schema".

## Virtual Table Caution

FTS5 and `vec0` virtual tables cannot be created inside a regular `ALTER TABLE` — they must be `CREATE VIRTUAL TABLE` statements.

When deleting rows from a source table that has an FTS5 shadow:

- **Delete from the FTS5 table first** using targeted row deletion: `DELETE FROM items_fts WHERE rowid = ?`.
- **Never** issue `INSERT INTO items_fts(items_fts) VALUES('rebuild')` inside a migration — that rebuilds the entire index and blocks reads.

## Coverage Gate

`packages/gateway/src/db/` ≥ **85% line coverage**. Migration files are covered by the integration test suite which runs all migrations against a fresh in-memory SQLite instance on every CI run.

## Authoring Checklist

- [ ] File created at `packages/gateway/src/db/migrations/V<N>__<description>.ts` with the next sequential number — no reuse, no gaps.
- [ ] Exports a single `up(db: Database): Promise<void>` function — no `down()`.
- [ ] All schema changes are additive (`CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ADD COLUMN`, `CREATE VIRTUAL TABLE`); no drops or renames except for same-phase, no-data items.
- [ ] Backfills process in 1 000-row batches inside `db.transaction()`.
- [ ] No manual writes to `_schema_migrations`.
- [ ] New tables include primary key, `created_at INTEGER NOT NULL`, query-pattern indexes, and `CHECK` constraints on enum columns.
- [ ] FTS5 row deletes use targeted `DELETE FROM items_fts WHERE rowid = ?` — never the `'rebuild'` command.
- [ ] Schema reference in `docs/architecture.md` updated for any new table.
- [ ] Integration tests covering the migration are green; `packages/gateway/src/db/` line coverage stays ≥ 85%.
