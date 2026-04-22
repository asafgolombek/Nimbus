/**
 * V23 migration — adds `dry_run` and `params_override_json` columns to the
 * existing `workflow_run` table (v9 schema). These support the WS5-D Polish
 * sub-project: the runner writes dry-run rows (previously short-circuited
 * before INSERT) and records the per-invocation params override so the UI
 * can surface it in the run-history drawer.
 *
 * Purely additive — no backfill required. Existing rows get `dry_run = 0`
 * and `params_override_json = NULL`.
 */

export const WORKFLOW_RUN_COLUMNS_V23_SQL = `
ALTER TABLE workflow_run ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_run ADD COLUMN params_override_json TEXT;
`;
