import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spinner } from "@clack/prompts";
import { IPCClient } from "../ipc-client/index.ts";
import { ensureGatewayDirs, isProcessAlive, readGatewayState } from "../lib/gateway-process.ts";
import { spawnGateway } from "../lib/spawn-gateway.ts";
import { getCliPlatformPaths } from "../paths.ts";

const ONBOARDING_MARKER = ".nimbus-post-start-onboarding";

function wantsNoWizard(args: readonly string[]): boolean {
  return args.includes("--no-wizard");
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

async function maybePrintFirstRunHints(
  paths: ReturnType<typeof getCliPlatformPaths>,
): Promise<void> {
  if (!process.stdout.isTTY || process.env["CI"] === "true") {
    return;
  }
  const marker = join(paths.dataDir, ONBOARDING_MARKER);
  if (existsSync(marker)) {
    return;
  }
  for (let i = 0; i < 30; i++) {
    const state = await readGatewayState(paths);
    if (state !== undefined && isProcessAlive(state.pid)) {
      const client = new IPCClient(state.socketPath);
      try {
        await client.connect();
        const rows = await client.call<Array<{ serviceId?: string }>>("connector.listStatus", {});
        if (Array.isArray(rows) && rows.length === 0) {
          console.log("");
          console.log("Next — connect a service so the index has data to search:");
          console.log("  nimbus connector auth github");
          console.log("  nimbus connector sync github");
          console.log("  nimbus doctor");
        }
        try {
          writeFileSync(marker, `${new Date().toISOString()}\n`, "utf8");
        } catch {
          /* non-fatal */
        }
      } catch {
        /* IPC not ready yet */
      } finally {
        await client.disconnect().catch(() => {});
      }
      return;
    }
    await sleep(200);
  }
}

export async function runStart(args: string[]): Promise<void> {
  const paths = getCliPlatformPaths();
  await ensureGatewayDirs(paths);

  const existing = await readGatewayState(paths);
  if (existing !== undefined && isProcessAlive(existing.pid)) {
    console.log(`Gateway already running (pid ${String(existing.pid)}).`);
    return;
  }

  const s = spinner();
  s.start("Starting Gateway");

  try {
    const { pid, logPath } = await spawnGateway(paths);
    s.stop(`Gateway started (pid ${String(pid)})`);
    console.log(`Socket: ${paths.socketPath}`);
    console.log(`Log:    ${logPath}`);
    if (!wantsNoWizard(args)) {
      await maybePrintFirstRunHints(paths);
    }
  } catch (e) {
    s.stop("Could not start Gateway");
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    process.exitCode = 1;
  }
}
