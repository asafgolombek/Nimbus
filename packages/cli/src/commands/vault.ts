import { confirm, isCancel } from "@clack/prompts";

import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

async function withIpc<T>(fn: (c: IPCClient) => Promise<T>): Promise<T> {
  const paths = getCliPlatformPaths();
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

export async function runVault(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === "set") {
    const key = rest[0];
    const value = rest[1];
    if (key === undefined || value === undefined) {
      throw new Error("Usage: nimbus vault set <key> <value>");
    }
    await withIpc((c) => c.call("vault.set", { key, value }));
    console.log("Stored.");
    return;
  }

  if (sub === "get") {
    const key = rest[0];
    if (key === undefined) {
      throw new Error("Usage: nimbus vault get <key>");
    }
    const ok = await confirm({
      message: "Secrets echo to this terminal. Continue?",
    });
    if (isCancel(ok) || ok !== true) {
      return;
    }
    const v = await withIpc((c) => c.call<string | null>("vault.get", { key }));
    console.log(v === null ? "(not set)" : v);
    return;
  }

  if (sub === "delete") {
    const key = rest[0];
    if (key === undefined) {
      throw new Error("Usage: nimbus vault delete <key>");
    }
    await withIpc((c) => c.call("vault.delete", { key }));
    console.log("Deleted (if it existed).");
    return;
  }

  if (sub === "list") {
    const prefix = rest[0];
    const keys = await withIpc((c) =>
      c.call<string[]>("vault.listKeys", prefix === undefined ? {} : { prefix }),
    );
    for (const k of keys) {
      console.log(k);
    }
    return;
  }

  throw new Error("Usage: nimbus vault <set|get|delete|list> …");
}
