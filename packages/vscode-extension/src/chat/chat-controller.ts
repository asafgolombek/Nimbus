import type { AskStreamHandle, AskStreamOptions } from "@nimbus-dev/client";

import type { Logger } from "../logging.js";
import type { ChatPanel } from "./chat-panel.js";
import type { ExtensionToWebview } from "./chat-protocol.js";
import type { SessionStore } from "./session-store.js";

export interface ChatClientLike {
  askStream(input: string, opts?: AskStreamOptions): AskStreamHandle;
  cancelStream(streamId: string): Promise<{ ok: boolean }>;
  getSessionTranscript(params: { sessionId: string; limit?: number }): Promise<{
    sessionId: string;
    turns: Array<{ role: "user" | "assistant"; text: string; timestamp: number }>;
    hasMore: boolean;
  }>;
}

export interface ChatControllerDeps {
  client: ChatClientLike;
  panel: ChatPanel;
  sessionStore: SessionStore;
  registerStreamWithHitl(streamId: string): void;
  unregisterStreamWithHitl(streamId: string): void;
  log: Logger;
  agent?: () => string;
}

export interface ChatController {
  start(input: string): Promise<void>;
  stop(): Promise<void>;
  newConversation(): Promise<void>;
  rehydrateIfNeeded(limit: number): Promise<void>;
  isStreaming(): boolean;
}

export function createChatController(deps: ChatControllerDeps): ChatController {
  let active: AskStreamHandle | undefined;

  const post = (m: ExtensionToWebview): void => {
    void deps.panel.postMessage(m);
  };

  return {
    async start(input): Promise<void> {
      if (active !== undefined) {
        throw new Error("Stream in progress; click Stop or wait for it to finish.");
      }
      const opts: AskStreamOptions = {};
      const sid = deps.sessionStore.get();
      if (sid !== undefined) opts.sessionId = sid;
      const agent = deps.agent?.() ?? "";
      if (agent.length > 0) opts.agent = agent;
      const handle = deps.client.askStream(input, opts);
      active = handle;
      post({ type: "userMessage", text: input });
      try {
        let registered = false;
        for await (const ev of handle) {
          if (!registered && handle.streamId.length > 0) {
            deps.registerStreamWithHitl(handle.streamId);
            registered = true;
          }
          if (ev.type === "token") {
            post({ type: "token", text: ev.text });
            continue;
          }
          if (ev.type === "subTaskProgress") {
            const m: ExtensionToWebview =
              typeof ev.progress === "number"
                ? {
                    type: "subTask",
                    subTaskId: ev.subTaskId,
                    status: ev.status,
                    progress: ev.progress,
                  }
                : { type: "subTask", subTaskId: ev.subTaskId, status: ev.status };
            post(m);
            continue;
          }
          if (ev.type === "hitlBatch") {
            post({
              type: "hitlInline",
              requestId: ev.requestId,
              prompt: ev.prompt,
              details: ev.details,
            });
            continue;
          }
          if (ev.type === "done") {
            post({ type: "done", reply: ev.reply, sessionId: ev.sessionId });
            if (ev.sessionId.length > 0) {
              await deps.sessionStore.set(ev.sessionId);
            }
            break;
          }
          if (ev.type === "error") {
            post({ type: "error", message: ev.message });
            deps.log.error(`Stream error: ${ev.code}: ${ev.message}`);
            break;
          }
        }
      } finally {
        if (handle.streamId.length > 0) {
          deps.unregisterStreamWithHitl(handle.streamId);
        }
        active = undefined;
      }
    },
    async stop(): Promise<void> {
      if (active === undefined) return;
      await active.cancel();
      active = undefined;
    },
    async newConversation(): Promise<void> {
      if (active !== undefined) {
        await active.cancel();
        active = undefined;
      }
      await deps.sessionStore.clear();
      post({ type: "reset" });
    },
    async rehydrateIfNeeded(limit): Promise<void> {
      const sid = deps.sessionStore.get();
      if (sid === undefined) {
        post({ type: "emptyState", sub: "no-transcript" });
        return;
      }
      try {
        const r = await deps.client.getSessionTranscript({ sessionId: sid, limit });
        post({ type: "hydrate", turns: r.turns });
      } catch (e) {
        deps.log.warn(`getSessionTranscript failed: ${e instanceof Error ? e.message : String(e)}`);
        post({ type: "emptyState", sub: "no-transcript" });
      }
    },
    isStreaming: () => active !== undefined,
  };
}
