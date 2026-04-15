import { platform } from "node:os";

import { withGatewayIpc } from "../lib/with-gateway-ipc.ts";

const LINUX_SECRET_TOOL_HINT =
  "secret-tool not found. Install libsecret-tools (Debian/Ubuntu) or libsecret (Fedora/Arch) to use the OS vault on Linux.";

export async function runDoctor(_args: string[]): Promise<void> {
  let exit = 0;
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

  try {
    const snap = await withGatewayIpc((c) =>
      c.call<{ gateway?: { version?: string } }>("diag.snapshot", {}),
    );
    const v = snap.gateway?.version;
    if (typeof v === "string" && v !== "") {
      console.log(`Gateway: reachable (version ${v}).`);
    } else {
      console.log("Gateway: reachable.");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`Gateway: not reachable — ${msg}`);
    exit = 1;
  }

  process.exitCode = exit;
}
