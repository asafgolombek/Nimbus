import { confirm, isCancel } from "@clack/prompts";

import type { IPCClient } from "../ipc-client/index.ts";

/** Stream agent tokens to stdout (used by `agent.invoke` / `workflow.run` with streaming). */
export function registerAgentChunkStdout(client: IPCClient): void {
  client.onNotification("agent.chunk", (params: unknown) => {
    const t = (params as { text?: string }).text;
    if (typeof t === "string" && t.length > 0) {
      process.stdout.write(t);
    }
  });
}

/** Prompt in the terminal for HITL consent and respond over IPC. */
export function registerConsentPromptHandler(client: IPCClient): void {
  client.onNotification("consent.request", async (params: unknown) => {
    const p = params as { requestId?: string; prompt?: string };
    if (typeof p.requestId !== "string") {
      return;
    }
    const message = typeof p.prompt === "string" ? p.prompt : "Approve action?";
    const ok = await confirm({ message });
    const approved = !isCancel(ok) && ok === true;
    await client.call("consent.respond", {
      requestId: p.requestId,
      approved,
    });
  });
}

/** Consent prompts + streaming chunks — typical setup for interactive CLI commands. */
export function registerInteractiveCliIpcHandlers(client: IPCClient): void {
  registerConsentPromptHandler(client);
  registerAgentChunkStdout(client);
}
