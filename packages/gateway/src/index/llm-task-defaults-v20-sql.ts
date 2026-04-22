export const LLM_TASK_DEFAULTS_V20_SQL = `
CREATE TABLE IF NOT EXISTS llm_task_defaults (
  task_type TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
