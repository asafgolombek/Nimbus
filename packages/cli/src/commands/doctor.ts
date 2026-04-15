import { platform } from "node:os";

import { IPCClient } from "../ipc-client/index.ts";
import { gatewayStatePath, isProcessAlive, readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

const LINUX_SECRET_TOOL_HINT =
  "secret-tool not found. Install libsecret-tools (Debian/Ubuntu) or libsecret (Fedora/Arch) to use the OS vault on Linux.";

const MIN_BUN_MAJOR = 1;
const MIN_BUN_MINOR = 2;

function bunVersionOk(): boolean {
  const m = /^(\d+)\.(\d+)\./.exec(Bun.version);
  if (m === null) {
    return true;
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > MIN_BUN_MAJOR || (major === MIN_BUN_MAJOR && minor >= MIN_BUN_MINOR);
}

export async function runDoctor(_args: string[]): Promise<void> {
  let exit = 0;
  const paths = getCliPlatformPaths();

  console.log(`Runtime: Bun ${Bun.version}`);
  if (!bunVersionOk()) {
    console.log(
      `⚠ Nimbus expects Bun >= ${String(MIN_BUN_MAJOR)}.${String(MIN_BUN_MINOR)} (see repository README).`,
    );
    exit = 1;
  }

  console.log(`Data dir: ${paths.dataDir}`);
  console.log(`Gateway state file: ${gatewayStatePath(paths)}`);

  if (platform() === "linux") {
    if (Bun.which("secret-tool") === null) {
      console.log(`Vault: ${LINUX_SECRET_TOOL_HINT}`);
      exit = 1;
    } else {
      console.log("Vault: secret-tool is on PATH.");
    }
  } else {
    console.log(`Vault: OS-native store (${platform()}) — no Linux secret-tool check.`);
  }

  const state = await readGatewayState(paths);
  if (state === undefined) {
    console.log("Gateway: not running (no gateway.json — start with: nimbus start).");
  } else if (!isProcessAlive(state.pid)) {
    console.log(
      `Gateway: stale state (pid ${String(state.pid)} is not running) — try nimbus stop or remove the state file.`,
    );
    exit = 1;
  } else {
    const client = new IPCClient(state.socketPath);
    try {
      await client.connect();
      const snap = await client.call<{ gateway?: { version?: string } }>("diag.snapshot", {});
      const v = snap.gateway?.version;
      if (typeof v === "string" && v !== "") {
        console.log(`Gateway: IPC OK (version ${v}).`);
      } else {
        console.log("Gateway: IPC OK.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`Gateway: IPC failed — ${msg}`);
      exit = 1;
    } finally {
      await client.disconnect().catch(() => {});
    }
  }

  process.exitCode = exit;
}
