/**
 * Phase 4 Section 2 — Graph-aware watcher conditions (user_version 22).
 *
 * Adds a nullable `graph_predicate_json` column to `watcher`. When non-null,
 * the watcher engine additionally filters candidate items through the graph
 * predicate evaluator (see `packages/gateway/src/automation/graph-predicate.ts`).
 *
 * Nullable by design — pre-existing watchers remain unchanged and continue to
 * evaluate using only their `condition_json` filter.
 */

export const WATCHER_GRAPH_V22_SQL = `
ALTER TABLE watcher ADD COLUMN graph_predicate_json TEXT;
`;
