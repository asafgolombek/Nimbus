import { processEnvGet } from "./platform/env-access.ts";

/**
 * Central env-driven config. Never hardcode provider model ids in call sites.
 */
export const Config = {
  agentModel: processEnvGet("NIMBUS_AGENT_MODEL") ?? "claude-sonnet-4-20250514",
  classifierModel: processEnvGet("NIMBUS_CLASSIFIER_MODEL") ?? "claude-3-5-haiku-20241022",
  /** Used when only `OPENAI_API_KEY` is set (Anthropic model ids are invalid on OpenAI). */
  openaiClassifierModel: processEnvGet("NIMBUS_OPENAI_CLASSIFIER_MODEL") ?? "gpt-4o-mini",
  /**
   * Public OAuth client ids (PKCE). Set in the environment until bundled desktop ids ship.
   * @see docs/q2-2026-plan.md §1.0 OAuth Client ID Strategy
   */
  oauthGoogleClientId: processEnvGet("NIMBUS_OAUTH_GOOGLE_CLIENT_ID") ?? "",
  oauthMicrosoftClientId: processEnvGet("NIMBUS_OAUTH_MICROSOFT_CLIENT_ID") ?? "",
} as const;
