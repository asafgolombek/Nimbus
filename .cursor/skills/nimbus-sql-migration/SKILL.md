---
name: nimbus-sql-migration
description: >-
  Guides SQLite schema and query changes for the Nimbus local index
  (packages/gateway/src/index/). Covers embedded schema updates, numbered
  migration files if present, parameterized queries from TypeScript, and
  metadata-only storage. Use when altering schema-sql.ts, adding SQL migration
  files, writing raw SQL against bun:sqlite, or when the user mentions LocalIndex,
  sqlite-vec, or index migrations.
---

# Nimbus — SQLite index and SQL discipline

## Schema source of truth

- Initial schema is embedded in `packages/gateway/src/index/schema-sql.ts` as `INITIAL_SCHEMA_SQL` (bundled with `bun build --compile`). Align changes with **`architecture.md`** (Local Database Schema / index sections).
- If the repo introduces numbered SQL migration files (e.g. `001_initial.sql`, `002_add_sync_state.sql`), treat them as **append-only**: new files get the next number; **do not** rewrite shipped migration history.

## Queries from TypeScript

- Use **`bun:sqlite`** with **parameterized** statements — no string interpolation or template literals for user- or connector-supplied values in SQL text.
- Prefer explicit parameter binding APIs; keep dynamic identifiers (rare) to a fixed allowlist, not arbitrary strings.

## What belongs in SQLite

- **Metadata only** — not raw file contents, full email bodies, or large blobs. Respect project rules on `raw_meta` size caps where defined.

## Vectors (sqlite-vec)

- Embeddings roadmap uses `sqlite-vec` with fixed dimensions (e.g. float[1536]); follow existing types and migration style when that subsystem lands.

## Verification

- After index or query changes: `bun run typecheck`, gateway tests, and `bun run test:integration` when IPC, startup, or persistence behavior is affected. Use `nimbus-staged-verify` for path-based depth.
