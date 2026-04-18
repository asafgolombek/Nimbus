export const SUB_TASK_RESULTS_V17_SQL = `
CREATE TABLE IF NOT EXISTS sub_task_results (
  id           INTEGER PRIMARY KEY,
  session_id   TEXT NOT NULL,
  parent_id    TEXT NOT NULL,
  task_index   INTEGER NOT NULL,
  task_type    TEXT NOT NULL,
  status       TEXT NOT NULL
    CHECK(status IN ('pending','running','done','rejected','error')),
  result_json  TEXT,
  error_text   TEXT,
  model_used   TEXT,
  tokens_in    INTEGER,
  tokens_out   INTEGER,
  started_at   INTEGER,
  completed_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_str_session_parent
  ON sub_task_results(session_id, parent_id);
`;
