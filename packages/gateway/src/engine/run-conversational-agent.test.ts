import { describe, expect, mock, test } from "bun:test";
import type { Agent } from "@mastra/core/agent";

import { GatewayAgentUnavailableError } from "./gateway-agent-error.ts";
import { runConversationalAgent } from "./run-conversational-agent.ts";

describe("runConversationalAgent", () => {
  test("returns empty reply for whitespace-only input", async () => {
    const agent = {} as Agent;
    const r = await runConversationalAgent({
      agent,
      input: "   \n\t  ",
      stream: false,
      sendChunk: () => {
        /* noop */
      },
    });
    expect(r.reply).toBe("");
  });

  test("non-stream uses generate text", async () => {
    const agent = {
      generate: mock(async () => ({ text: "ok" })),
    } as unknown as Agent;
    const r = await runConversationalAgent({
      agent,
      input: "hello",
      stream: false,
      sendChunk: () => {
        /* noop */
      },
    });
    expect(r.reply).toBe("ok");
    expect(agent.generate).toHaveBeenCalled();
  });

  test("stream forwards text-delta chunks and returns final text", async () => {
    const chunks: string[] = [];
    async function* fullStream() {
      yield { type: "text-delta" as const, payload: { text: "a" } };
      yield { type: "text-delta" as const, payload: { text: "b" } };
    }
    const agent = {
      stream: mock(async () => ({
        fullStream: fullStream(),
        text: Promise.resolve("full"),
      })),
    } as unknown as Agent;
    const r = await runConversationalAgent({
      agent,
      input: "x",
      stream: true,
      sendChunk: (t) => {
        chunks.push(t);
      },
    });
    expect(chunks.join("")).toBe("ab");
    expect(r.reply).toBe("full");
  });

  test("maps API key errors to GatewayAgentUnavailableError", async () => {
    const agent = {
      generate: mock(async () => {
        throw new Error("missing API key");
      }),
    } as unknown as Agent;
    await expect(
      runConversationalAgent({
        agent,
        input: "q",
        stream: false,
        sendChunk: () => {
          /* noop */
        },
      }),
    ).rejects.toBeInstanceOf(GatewayAgentUnavailableError);
  });
});
