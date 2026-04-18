export const LLM_MODELS_V16_SQL = `
CREATE TABLE IF NOT EXISTS llm_models (
  id               INTEGER PRIMARY KEY,
  provider         TEXT NOT NULL CHECK(provider IN ('ollama','llamacpp','remote')),
  model_name       TEXT NOT NULL,
  parameter_count  INTEGER,
  context_window   INTEGER,
  quantization     TEXT,
  vram_estimate_mb INTEGER,
  last_seen_at     INTEGER NOT NULL,
  UNIQUE(provider, model_name)
);

CREATE INDEX IF NOT EXISTS idx_llm_models_provider
  ON llm_models(provider);
`;

export const LLM_CONTEXT_WINDOW_V16_ALTER_SQL = `
ALTER TABLE sync_state ADD COLUMN context_window_tokens INTEGER;
`;
