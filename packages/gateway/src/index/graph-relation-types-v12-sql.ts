/**
 * Migration 12 — filesystem graph edges (`depends_on`, `defined_in`, `in_repo`) used by graph-populator.
 */

export const GRAPH_RELATION_TYPES_V12_SQL = `
INSERT OR IGNORE INTO graph_relation_type (name, directed) VALUES
  ('depends_on', 1),
  ('defined_in', 1),
  ('in_repo', 1);
`;
