import { processEnvGet } from "./platform/env-access.ts";

/**
 * Central env-driven config. Never hardcode provider model ids in call sites.
 */
export const Config = {
  agentModel: processEnvGet("NIMBUS_AGENT_MODEL") ?? "claude-sonnet-4-20250514",
  classifierModel: processEnvGet("NIMBUS_CLASSIFIER_MODEL") ?? "claude-3-5-haiku-20241022",
  /** Used when only `OPENAI_API_KEY` is set (Anthropic model ids are invalid on OpenAI). */
  openaiClassifierModel: processEnvGet("NIMBUS_OPENAI_CLASSIFIER_MODEL") ?? "gpt-4o-mini",
} as const;
