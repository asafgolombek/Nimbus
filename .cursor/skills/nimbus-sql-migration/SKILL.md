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

- Embeddings use `sqlite-vec` with **dimension-qualified table names**: `vec_items_384` (float[384], `all-MiniLM-L6-v2` local model, Phase 3). Future model tables (`vec_items_1536` for OpenAI 1536-dim) are added alongside, not replacing.
- `embedding_chunk` table tracks `model TEXT` and `dims INTEGER` per row — always filter by `model` when querying a specific vector table.
- Migration 6 creates `vec_items_384` and `embedding_chunk`. Do not reuse `vec_items` as a name — the `_384` suffix is load-bearing for future multi-model support.

## Verification

- After index or query changes: `bun run typecheck`, gateway tests, and `bun run test:integration` when IPC, startup, or persistence behavior is affected. Use `nimbus-staged-verify` for path-based depth.
