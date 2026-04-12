import { readFileSync } from "node:fs";

import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { registerInteractiveCliIpcHandlers } from "../lib/interactive-ipc-handlers.ts";
import { parseWorkflowFileContent } from "../lib/workflow-parse.ts";
import { getCliPlatformPaths } from "../paths.ts";

/**
 * `nimbus run <workflow-file>` — upserts workflow from file, then executes it (same as workflow save + run).
 */
export async function runWorkflowFromFile(args: string[]): Promise<void> {
  const file = args[0]?.trim() ?? "";
  if (file === "") {
    throw new Error(
      "Usage: nimbus run <workflow.json|yaml> [--dry-run] [--agent nimbus|devops|research]",
    );
  }
  let dryRun = false;
  let agent: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--agent" && args[i + 1] !== undefined) {
      agent = args[i + 1];
      i += 1;
    }
  }

  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running. Start with: nimbus start");
  }

  const content = readFileSync(file, "utf8");
  const parsed = parseWorkflowFileContent(content, file);

  const client = new IPCClient(state.socketPath);
  await client.connect();
  registerInteractiveCliIpcHandlers(client);

  try {
    const savePayload: Record<string, unknown> = {
      name: parsed.name,
      stepsJson: parsed.stepsJson,
    };
    if (parsed.description !== null) {
      savePayload["description"] = parsed.description;
    }
    await client.call("workflow.save", savePayload);
    const runPayload: Record<string, unknown> = {
      name: parsed.name,
      stream: dryRun === false,
      dryRun,
    };
    if (agent !== undefined && agent !== "") {
      runPayload["agent"] = agent;
    }
    const out = await client.call("workflow.run", runPayload);
    console.log(`\n${JSON.stringify(out, undefined, 2)}`);
  } finally {
    await client.disconnect();
  }
}
