import { IPCClient } from "../ipc-client/index.ts";
import type { CliPlatformPaths } from "../paths.ts";
import { getCliPlatformPaths } from "../paths.ts";
import { readGatewayState } from "./gateway-process.ts";

export async function withGatewayIpc<T>(
  fn: (c: IPCClient) => Promise<T>,
  paths: CliPlatformPaths = getCliPlatformPaths(),
): Promise<T> {
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running. Start with: nimbus start");
  }
  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}
