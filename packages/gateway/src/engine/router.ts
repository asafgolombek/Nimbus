import { Config } from "../config.ts";
import { processEnvGet } from "../platform/env-access.ts";
import { GatewayAgentUnavailableError } from "./gateway-agent-error.ts";

export type IntentClass = "file_search" | "file_organize" | "unknown";

export type ClassifiedIntent = {
  intent: IntentClass;
  entities: Record<string, string>;
  requiresHITL: boolean;
  confidence: number;
};

function extractJsonObject(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1] !== undefined) {
    return fence[1].trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return t.slice(start, end + 1);
  }
  return t;
}

function resolveAnthropicModelId(configured: string): string {
  const s = configured.trim();
  if (s.startsWith("anthropic/")) {
    return s.slice("anthropic/".length);
  }
  return s;
}

async function anthropicClassify(
  userText: string,
  model: string,
  apiKey: string,
): Promise<ClassifiedIntent> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: resolveAnthropicModelId(model),
      max_tokens: 512,
      system: `You classify user requests for a local-first assistant. Reply with a single JSON object only, no markdown:
{
  "intent": "file_search" | "file_organize" | "unknown",
  "entities": { string: string },
  "requiresHITL": boolean,
  "confidence": number
}
Rules:
- file_search: user wants to find/list/search files by name or pattern. Put glob or substring in entities.pattern; optional entities.path for root directory.
- file_organize: user wants to move or rename a file/dir. Put entities.source and entities.destination (full or relative paths under the allowed sandbox).
- unknown: chit-chat, unclear, or unsupported. Keep entities empty or minimal.
- requiresHITL: true for file_organize (destructive path change), false for file_search.
- confidence: 0–1.`,
      messages: [{ role: "user", content: userText.slice(0, 8000) }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${String(res.status)} ${errBody.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const block = body.content?.find((c) => c.type === "text");
  const text = block?.text ?? "";
  const raw = extractJsonObject(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Classifier returned non-JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Classifier JSON not an object");
  }
  const o = parsed as Record<string, unknown>;
  const intentRaw = o["intent"];
  const confidenceRaw = o["confidence"];
  const entitiesRaw = o["entities"];
  const requiresHITLRaw = o["requiresHITL"];

  let intent: IntentClass = "unknown";
  if (intentRaw === "file_search" || intentRaw === "file_organize" || intentRaw === "unknown") {
    intent = intentRaw;
  }

  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : 0;

  const entities: Record<string, string> = {};
  if (entitiesRaw !== null && typeof entitiesRaw === "object" && !Array.isArray(entitiesRaw)) {
    for (const [k, v] of Object.entries(entitiesRaw as Record<string, unknown>)) {
      if (typeof v === "string") {
        entities[k] = v;
      }
    }
  }

  const requiresHITL =
    typeof requiresHITLRaw === "boolean" ? requiresHITLRaw : intent === "file_organize";

  return { intent, entities, requiresHITL, confidence };
}

async function openAiClassify(
  userText: string,
  model: string,
  apiKey: string,
): Promise<ClassifiedIntent> {
  const m = model.replace(/^openai\//, "");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: m,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Classify the user message. Return JSON only:
{"intent":"file_search"|"file_organize"|"unknown","entities":{},"requiresHITL":bool,"confidence":0-1}
file_search: finding files — put pattern in entities.pattern, optional entities.path.
file_organize: move/rename — entities.source and entities.destination.
unknown: else.`,
        },
        { role: "user", content: userText.slice(0, 8000) },
      ],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${String(res.status)} ${errBody.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = body.choices?.[0]?.message?.content ?? "";
  const raw = extractJsonObject(text);
  const parsed: unknown = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Classifier JSON not an object");
  }
  const o = parsed as Record<string, unknown>;
  const intentRaw = o["intent"];
  let intent: IntentClass = "unknown";
  if (intentRaw === "file_search" || intentRaw === "file_organize" || intentRaw === "unknown") {
    intent = intentRaw;
  }
  const confidenceRaw = o["confidence"];
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : 0;
  const entities: Record<string, string> = {};
  const entitiesRaw = o["entities"];
  if (entitiesRaw !== null && typeof entitiesRaw === "object" && !Array.isArray(entitiesRaw)) {
    for (const [k, v] of Object.entries(entitiesRaw as Record<string, unknown>)) {
      if (typeof v === "string") {
        entities[k] = v;
      }
    }
  }
  const requiresHITLRaw = o["requiresHITL"];
  const requiresHITL =
    typeof requiresHITLRaw === "boolean" ? requiresHITLRaw : intent === "file_organize";
  return { intent, entities, requiresHITL, confidence };
}

/**
 * Single LLM call to classify NL input. Uses Anthropic when `ANTHROPIC_API_KEY` is set, else OpenAI when `OPENAI_API_KEY` is set.
 */
export async function classifyIntent(userText: string): Promise<ClassifiedIntent> {
  const trimmed = userText.trim();
  if (trimmed.length === 0) {
    return {
      intent: "unknown",
      entities: {},
      requiresHITL: false,
      confidence: 1,
    };
  }

  const anthropicKey = processEnvGet("ANTHROPIC_API_KEY");
  const openAiKey = processEnvGet("OPENAI_API_KEY");

  if (anthropicKey !== undefined && anthropicKey.length > 0) {
    try {
      return await anthropicClassify(trimmed, Config.classifierModel, anthropicKey);
    } catch {
      throw new GatewayAgentUnavailableError();
    }
  }

  if (openAiKey !== undefined && openAiKey.length > 0) {
    try {
      return await openAiClassify(trimmed, Config.openaiClassifierModel, openAiKey);
    } catch {
      throw new GatewayAgentUnavailableError();
    }
  }

  throw new GatewayAgentUnavailableError();
}
