import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { withGatewayIpc } from "../lib/with-gateway-ipc.ts";
import { getCliPlatformPaths } from "../paths.ts";

export async function runTelemetry(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    console.log(`nimbus telemetry — opt-in aggregate telemetry

Usage:
  nimbus telemetry show     Print sanitized preview payload (requires Gateway)
  nimbus telemetry disable  Write local disable marker under the data directory (no Gateway)
`);
    return;
  }

  if (sub === "show") {
    const r = await withGatewayIpc((c) => c.call<unknown>("telemetry.preview", {}));
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (sub === "disable") {
    const paths = getCliPlatformPaths();
    await mkdir(paths.dataDir, { recursive: true });
    await Bun.write(join(paths.dataDir, ".nimbus-telemetry-disabled"), `${String(Date.now())}\n`);
    console.log("Telemetry disabled (local marker written under the data directory).");
    return;
  }

  throw new Error(`Unknown telemetry subcommand: ${sub}`);
}
