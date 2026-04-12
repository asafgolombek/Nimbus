import { resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";

import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function stripFlags(args: string[]): string[] {
  return args.filter((a) => a !== "--yes" && a !== "-y");
}

export async function runExtension(args: string[]): Promise<void> {
  const sub = args[0]?.trim() ?? "";
  const rest = stripFlags(args.slice(1));
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running. Start with: nimbus start");
  }

  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    if (sub === "list" || sub === "") {
      const out = await client.call<{ extensions: unknown }>("extension.list", {});
      console.log(JSON.stringify(out, undefined, 2));
      return;
    }

    if (sub === "install") {
      const sourceRaw = rest[0]?.trim() ?? "";
      if (sourceRaw === "") {
        throw new Error("Usage: nimbus extension install <path> [--yes]");
      }
      const accept = hasFlag(args, "--yes") || hasFlag(args, "-y");
      if (!accept) {
        if (process.stdout.isTTY !== true) {
          throw new Error(
            "Refusing to install without confirmation in non-TTY mode. Pass --yes to proceed.",
          );
        }
        const ok = await confirm({
          message:
            "Install copies the extension into your Nimbus extensions directory. Only proceed if you trust this code.",
        });
        if (isCancel(ok) || ok !== true) {
          console.log("Cancelled.");
          return;
        }
      }
      const sourcePath = resolve(process.cwd(), sourceRaw);
      const out = await client.call<{
        id: string;
        version: string;
        installPath: string;
      }>("extension.install", { sourcePath });
      console.log(JSON.stringify(out, undefined, 2));
      return;
    }

    if (sub === "enable") {
      const id = rest[0]?.trim() ?? "";
      if (id === "") {
        throw new Error("Usage: nimbus extension enable <id>");
      }
      const out = await client.call<{ ok: boolean }>("extension.enable", { id });
      console.log(JSON.stringify(out, undefined, 2));
      return;
    }

    if (sub === "disable") {
      const id = rest[0]?.trim() ?? "";
      if (id === "") {
        throw new Error("Usage: nimbus extension disable <id>");
      }
      const out = await client.call<{ ok: boolean }>("extension.disable", { id });
      console.log(JSON.stringify(out, undefined, 2));
      return;
    }

    if (sub === "remove") {
      const id = rest[0]?.trim() ?? "";
      if (id === "") {
        throw new Error("Usage: nimbus extension remove <id> [--yes]");
      }
      const accept = hasFlag(args, "--yes") || hasFlag(args, "-y");
      if (!accept) {
        if (process.stdout.isTTY !== true) {
          throw new Error(
            "Refusing to remove without confirmation in non-TTY mode. Pass --yes to proceed.",
          );
        }
        const ok = await confirm({
          message: `Remove extension "${id}" from the registry and delete its files?`,
        });
        if (isCancel(ok) || ok !== true) {
          console.log("Cancelled.");
          return;
        }
      }
      const out = await client.call<{ ok: boolean }>("extension.remove", { id });
      console.log(JSON.stringify(out, undefined, 2));
      return;
    }

    throw new Error(
      "Usage: nimbus extension list | install <path> [--yes] | enable <id> | disable <id> | remove <id> [--yes]",
    );
  } finally {
    await client.disconnect();
  }
}
