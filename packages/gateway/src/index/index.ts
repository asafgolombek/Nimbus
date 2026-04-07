/**
 * Local Index — bun:sqlite metadata store + sqlite-vec embeddings
 *
 * Tables:
 * - indexed_items: metadata for all items across all services
 * - item_embeddings: float[1536] vectors via sqlite-vec virtual table
 * - action_log: full audit trail of every agent action + HITL decision
 * - sync_state: per-connector sync tokens and health
 * - extensions: installed extension registry
 *
 * See architecture.md §Local Database Schema
 */

// TODO Q1: Export Database, migrations runner, query helpers
export {};
