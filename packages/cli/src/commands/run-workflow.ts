import { readFileSync } from "node:fs";

import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { registerInteractiveCliIpcHandlers } from "../lib/interactive-ipc-handlers.ts";
import { parseWorkflowFileContent } from "../lib/workflow-parse.ts";
import { getCliPlatformPaths } from "../paths.ts";

function hasFlag(args: string[], flag: string): boolean {
  const i = args.indexOf(flag);
  if (i < 0) {
    return false;
  }
  args.splice(i, 1);
  return true;
}

function shiftFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || args[i + 1] === undefined) {
    return undefined;
  }
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function buildWorkflowRunPayload(
  name: string,
  dryRun: boolean,
  agent: string | undefined,
): Record<string, unknown> {
  const runPayload: Record<string, unknown> = {
    name,
    stream: dryRun === false,
    dryRun,
  };
  if (agent !== undefined && agent !== "") {
    runPayload["agent"] = agent;
  }
  return runPayload;
}

/**
 * `nimbus run <workflow-file>` — upserts workflow from file, then executes it (same as workflow save + run).
 */
export async function runWorkflowFromFile(args: string[]): Promise<void> {
  const file = args[0]?.trim() ?? "";
  if (file === "") {
    throw new Error(
      "Usage: nimbus run <workflow.json|yaml> [--dry-run] [--no-ttv] [--agent nimbus|devops|research]",
    );
  }
  const tail = args.slice(1);
  const dryRun = hasFlag(tail, "--dry-run");
  const noTtv = hasFlag(tail, "--no-ttv");
  const agentArg = shiftFlag(tail, "--agent");
  let agent: string | undefined;
  if (agentArg !== undefined && agentArg !== "") {
    agent = agentArg;
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
    if (noTtv && !dryRun) {
      const preview = await client.call(
        "workflow.run",
        buildWorkflowRunPayload(parsed.name, true, agent),
      );
      const rec = preview as { stepResults?: Array<{ hitlActions?: readonly string[] }> };
      const flagged = (rec.stepResults ?? []).filter((s) => (s.hitlActions?.length ?? 0) > 0);
      if (flagged.length > 0) {
        throw new Error(
          "Workflow steps may require human approval (HITL). Omit --no-ttv to run, or use --dry-run to inspect hitlActions.",
        );
      }
    }
    const out = await client.call(
      "workflow.run",
      buildWorkflowRunPayload(parsed.name, dryRun, agent),
    );
    console.log(`\n${JSON.stringify(out, undefined, 2)}`);
  } finally {
    await client.disconnect();
  }
}
