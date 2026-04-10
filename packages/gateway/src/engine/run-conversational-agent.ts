import type { Agent } from "@mastra/core/agent";

import { Config } from "../config.ts";
import { GatewayAgentUnavailableError } from "./gateway-agent-error.ts";

export type RunConversationalAgentParams = {
  agent: Agent;
  input: string;
  stream: boolean;
  sendChunk: (text: string) => void;
};

function isTextDeltaChunk(chunk: unknown): chunk is {
  type: "text-delta";
  payload: { text: string };
} {
  if (chunk === null || typeof chunk !== "object" || Array.isArray(chunk)) {
    return false;
  }
  const rec = chunk as Record<string, unknown>;
  if (rec["type"] !== "text-delta") {
    return false;
  }
  const payload = rec["payload"];
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const text = (payload as Record<string, unknown>)["text"];
  return typeof text === "string";
}

/**
 * Mastra agent turn with local index tools (Q2 §7.0 follow-up — `nimbus ask` conversational path).
 */
export async function runConversationalAgent(
  p: RunConversationalAgentParams,
): Promise<{ reply: string }> {
  const maxSteps = Config.conversationalAgentMaxSteps;
  const trimmed = p.input.trim();
  if (trimmed === "") {
    return { reply: "" };
  }

  try {
    if (!p.stream) {
      const out = await p.agent.generate(trimmed, { maxSteps });
      return { reply: out.text };
    }

    const streamOut = await p.agent.stream(trimmed, { maxSteps });
    for await (const chunk of streamOut.fullStream) {
      if (isTextDeltaChunk(chunk) && chunk.payload.text.length > 0) {
        p.sendChunk(chunk.payload.text);
      }
    }
    const reply = await streamOut.text;
    return { reply };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("API key") ||
      msg.includes("401") ||
      msg.includes("Unauthorized") ||
      msg.includes("invalid_api_key")
    ) {
      throw new GatewayAgentUnavailableError();
    }
    throw e;
  }
}
