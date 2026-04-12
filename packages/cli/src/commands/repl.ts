import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { confirm, isCancel } from "@clack/prompts";

import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

function parseReplArgs(args: string[]): { sessionId: string | undefined } {
  let sessionId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--session" && args[i + 1] !== undefined) {
      sessionId = args[i + 1];
      i += 1;
    }
  }
  return { sessionId };
}

export async function runRepl(args: string[]): Promise<void> {
  const { sessionId } = parseReplArgs(args);
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running. Start with: nimbus start");
  }

  const client = new IPCClient(state.socketPath);
  await client.connect();

  client.onNotification("consent.request", async (params) => {
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

  client.onNotification("agent.chunk", (params) => {
    const t = (params as { text?: string }).text;
    if (typeof t === "string" && t.length > 0) {
      process.stdout.write(t);
    }
  });

  const rl = createInterface({ input, output, terminal: true });
  try {
    output.write("Nimbus REPL — type a message, or exit / quit to leave.\n");
    for (;;) {
      const line = await rl.question("nimbus> ");
      const q = line.trim();
      if (q === "" || q === "exit" || q === "quit") {
        break;
      }
      const invokeParams: Record<string, unknown> = {
        input: q,
        stream: true,
      };
      if (sessionId !== undefined) {
        invokeParams["sessionId"] = sessionId;
      }
      const result = await client.call<{ reply: string }>("agent.invoke", invokeParams);
      if (typeof result.reply === "string" && result.reply.length > 0) {
        output.write(`\n${result.reply}\n`);
      }
      if (sessionId !== undefined) {
        await client.call("session.append", {
          sessionId,
          chunkText: q,
          role: "user",
        });
        if (typeof result.reply === "string" && result.reply.trim() !== "") {
          await client.call("session.append", {
            sessionId,
            chunkText: result.reply.slice(0, 8000),
            role: "assistant",
          });
        }
      }
    }
  } finally {
    rl.close();
    await client.disconnect();
  }
}
