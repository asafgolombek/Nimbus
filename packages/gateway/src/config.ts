import { processEnvGet } from "./platform/env-access.ts";

function parseSearchPriorityJson(): ReadonlyMap<string, number> {
  const raw = processEnvGet("NIMBUS_SEARCH_PRIORITY_JSON");
  if (raw === undefined || raw.trim() === "") {
    return new Map();
  }
  try {
    const p: unknown = JSON.parse(raw);
    if (p === null || typeof p !== "object" || Array.isArray(p)) {
      return new Map();
    }
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        m.set(k, Math.min(1, Math.max(0, v)));
      }
    }
    return m;
  } catch {
    return new Map();
  }
}

function parseEngineContextWindowItems(): number {
  const raw = processEnvGet("NIMBUS_ENGINE_CONTEXT_WINDOW_ITEMS");
  if (raw === undefined || raw === "") {
    return 20;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 200 ? n : 20;
}

function parseConversationalAgentMaxSteps(): number {
  const raw = processEnvGet("NIMBUS_ASK_MAX_STEPS");
  if (raw === undefined || raw === "") {
    return 20;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 64 ? n : 20;
}

function parseEmbeddingsEnabled(): boolean {
  const raw = processEnvGet("NIMBUS_EMBEDDINGS");
  if (raw === "0" || raw === "false") {
    return false;
  }
  return true;
}

const searchServicePriorityMap: ReadonlyMap<string, number> = parseSearchPriorityJson();

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
   * Shared per provider family: google.oauth covers Drive + Gmail + Photos; microsoft.oauth covers OneDrive + Outlook + Teams.
   */
  oauthGoogleClientId: processEnvGet("NIMBUS_OAUTH_GOOGLE_CLIENT_ID") ?? "",
  /**
   * Only for Google **Web application** OAuth clients (confidential). Desktop clients use PKCE without a secret.
   */
  oauthGoogleClientSecret: processEnvGet("NIMBUS_OAUTH_GOOGLE_CLIENT_SECRET") ?? "",
  oauthMicrosoftClientId: processEnvGet("NIMBUS_OAUTH_MICROSOFT_CLIENT_ID") ?? "",
  oauthSlackClientId: processEnvGet("NIMBUS_OAUTH_SLACK_CLIENT_ID") ?? "",
  /** Notion public integration (token endpoint requires Basic auth with secret). */
  oauthNotionClientId: processEnvGet("NIMBUS_OAUTH_NOTION_CLIENT_ID") ?? "",
  oauthNotionClientSecret: processEnvGet("NIMBUS_OAUTH_NOTION_CLIENT_SECRET") ?? "",
  /**
   * Q2 §7.0 — top-N items passed in full to the agent after ranked search; override with `NIMBUS_ENGINE_CONTEXT_WINDOW_ITEMS` (1–200).
   * Future: `engine.context_window_items` in nimbus.toml.
   */
  engineContextWindowItems: parseEngineContextWindowItems(),
  /** Q2 §7.2 — per-service weights (0–1); JSON object env `NIMBUS_SEARCH_PRIORITY_JSON` e.g. `{"github":0.8,"slack":0.7}`. */
  searchServicePriorityMap,
  /** Mastra tool loop depth for conversational `nimbus ask` (`NIMBUS_ASK_MAX_STEPS`, 1–64). */
  conversationalAgentMaxSteps: parseConversationalAgentMaxSteps(),
  /**
   * Phase 3 — background local embeddings after index upserts (`NIMBUS_EMBEDDINGS=false` to disable).
   */
  embeddingsEnabled: parseEmbeddingsEnabled(),
} as const;
