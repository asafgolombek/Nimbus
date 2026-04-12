import { readFileSync } from "node:fs";

import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { parseWorkflowFileContent } from "../lib/workflow-parse.ts";
import { getCliPlatformPaths } from "../paths.ts";

function shiftFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || args[i + 1] === undefined) {
    return undefined;
  }
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function hasFlag(args: string[], flag: string): boolean {
  const i = args.indexOf(flag);
  if (i < 0) {
    return false;
  }
  args.splice(i, 1);
  return true;
}

export async function runWorkflowCli(args: string[]): Promise<void> {
  const sub = args[0]?.trim() ?? "";
  const rest = args.slice(1);
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running. Start with: nimbus start");
  }

  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    if (sub === "list" || sub === "") {
      const out = await client.call<{ workflows: unknown }>("workflow.list", {});
      console.log(JSON.stringify(out, undefined, 2));
      return;
    }

    if (sub === "delete") {
      const name = rest[0]?.trim() ?? "";
      if (name === "") {
        throw new Error("Usage: nimbus workflow delete <name>");
      }
      const out = await client.call<{ ok: boolean }>("workflow.delete", { name });
      console.log(JSON.stringify(out, undefined, 2));
      return;
    }

    if (sub === "save") {
      const name = rest[0]?.trim() ?? "";
      const tail = rest.slice(1);
      const file = shiftFlag(tail, "--file");
      if (name === "" || file === undefined || file === "") {
        throw new Error("Usage: nimbus workflow save <name> --file <path> [--description text]");
      }
      const description = shiftFlag(tail, "--description");
      const content = readFileSync(file, "utf8");
      const parsed = parseWorkflowFileContent(content, file);
      if (parsed.name !== name) {
        console.warn(
          `Note: file declares name "${parsed.name}"; saving under CLI name "${name}" as requested.`,
        );
      }
      const desc =
        description !== undefined && description !== ""
          ? description
          : parsed.description !== null
            ? parsed.description
            : null;
      const out = await client.call("workflow.save", {
        name,
        stepsJson: parsed.stepsJson,
        ...(desc !== null ? { description: desc } : {}),
      });
      console.log(JSON.stringify(out, undefined, 2));
      return;
    }

    if (sub === "run") {
      const name = rest[0]?.trim() ?? "";
      const tail = rest.slice(1);
      if (name === "") {
        throw new Error(
          "Usage: nimbus workflow run <name> [--dry-run] [--agent nimbus|devops|research]",
        );
      }
      const dryRun = hasFlag(tail, "--dry-run");
      const agentArg = shiftFlag(tail, "--agent");
      const agent = agentArg !== undefined && agentArg !== "" ? agentArg : undefined;

      client.onNotification("agent.chunk", (params) => {
        const t = (params as { text?: string }).text;
        if (typeof t === "string" && t.length > 0) {
          process.stdout.write(t);
        }
      });

      const out = await client.call("workflow.run", {
        name,
        stream: !dryRun,
        dryRun,
        ...(agent !== undefined ? { agent } : {}),
      });
      console.log(`\n${JSON.stringify(out, undefined, 2)}`);
      return;
    }

    throw new Error(
      "Usage: nimbus workflow list | save <name> --file <path> | run <name> | delete <name>",
    );
  } finally {
    await client.disconnect();
  }
}
