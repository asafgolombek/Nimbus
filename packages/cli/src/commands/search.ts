import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

function parseSearchArgs(args: string[]): {
  query: string;
  limit: number;
  semantic: boolean;
  service?: string;
  itemType?: string;
} {
  let limit = 20;
  let semantic = true;
  let service: string | undefined;
  let itemType: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) {
      continue;
    }
    if (a === "--limit" || a === "-n") {
      const n = args[i + 1];
      if (n !== undefined) {
        limit = Math.min(500, Math.max(1, Number.parseInt(n, 10) || 20));
        i++;
      }
      continue;
    }
    if (a === "--semantic") {
      semantic = true;
      continue;
    }
    if (a === "--no-semantic" || a === "--keyword-only") {
      semantic = false;
      continue;
    }
    if (a === "--service" || a === "-s") {
      const v = args[i + 1];
      if (v !== undefined) {
        service = v;
        i++;
      }
      continue;
    }
    if (a === "--type" || a === "-t") {
      const v = args[i + 1];
      if (v !== undefined) {
        itemType = v;
        i++;
      }
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown flag: ${a}`);
    }
    positional.push(a);
  }
  const query = positional.join(" ").trim();
  return {
    query,
    limit,
    semantic,
    ...(service !== undefined ? { service } : {}),
    ...(itemType !== undefined ? { itemType } : {}),
  };
}

export async function runSearch(args: string[]): Promise<void> {
  const { query, limit, semantic, service, itemType } = parseSearchArgs(args);
  if (query === "") {
    throw new Error(
      "Usage: nimbus search <query> [--limit N] [--semantic|--no-semantic] [--service S] [--type T]",
    );
  }
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running (start with: nimbus start)");
  }
  const client = new IPCClient(state.socketPath);
  try {
    await client.connect();
    const rows = await client.call<unknown[]>("index.searchRanked", {
      name: query,
      limit,
      semantic,
      contextChunks: 2,
      ...(service !== undefined ? { service } : {}),
      ...(itemType !== undefined ? { itemType } : {}),
    });
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await client.disconnect().catch(() => {});
  }
}
