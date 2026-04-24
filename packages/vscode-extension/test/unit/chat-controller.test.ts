import { describe, expect, test, vi } from "vitest";

import { createChatController } from "../../src/chat/chat-controller.js";
import { createNoopChatPanel } from "../../src/chat/chat-panel.js";
import { MockClient } from "@nimbus-dev/client";

describe("ChatController", () => {
  test("askStream messages get translated to webview postMessage", async () => {
    const panel = createNoopChatPanel();
    const posted: unknown[] = [];
    panel.postMessage = vi.fn(async (msg) => {
      posted.push(msg);
      return true;
    });
    const client = new MockClient({ streamTokens: ["a", "b"], reply: "ab" });
    const ctrl = createChatController({
      client,
      panel,
      sessionStore: {
        get: () => undefined,
        set: async () => undefined,
        clear: async () => undefined,
      },
      registerStreamWithHitl: () => undefined,
      unregisterStreamWithHitl: () => undefined,
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    });
    await ctrl.start("hi");
    const types = posted.map((m) => (m as { type: string }).type);
    expect(types).toContain("userMessage");
    expect(types).toContain("token");
    expect(types).toContain("done");
  });

  test("rejects start while a stream is in progress", async () => {
    const panel = createNoopChatPanel();
    const client = new MockClient({ streamTokens: ["a"] });
    const ctrl = createChatController({
      client,
      panel,
      sessionStore: {
        get: () => undefined,
        set: async () => undefined,
        clear: async () => undefined,
      },
      registerStreamWithHitl: () => undefined,
      unregisterStreamWithHitl: () => undefined,
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    });
    const p = ctrl.start("first");
    await expect(ctrl.start("second")).rejects.toThrow(/in progress/i);
    await p;
  });

  test("newConversation clears sessionId and posts reset", async () => {
    const panel = createNoopChatPanel();
    const posted: unknown[] = [];
    panel.postMessage = vi.fn(async (m) => {
      posted.push(m);
      return true;
    });
    const cleared = vi.fn(async () => undefined);
    const client = new MockClient();
    const ctrl = createChatController({
      client,
      panel,
      sessionStore: {
        get: () => "sess-old",
        set: async () => undefined,
        clear: cleared,
      },
      registerStreamWithHitl: () => undefined,
      unregisterStreamWithHitl: () => undefined,
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    });
    await ctrl.newConversation();
    expect(cleared).toHaveBeenCalled();
    expect(posted.some((m) => (m as { type: string }).type === "reset")).toBe(true);
  });
});
