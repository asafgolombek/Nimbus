import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { withGatewayIpc } from "../lib/with-gateway-ipc.ts";
import { getCliPlatformPaths } from "../paths.ts";

function printConfigHelp(): void {
  console.log(`nimbus config — local TOML + Gateway validation

Usage:
  nimbus config validate   (requires Gateway — checks nimbus.toml in config dir)
  nimbus config list       Print nimbus.toml path and contents if present
  nimbus config edit       Open nimbus.toml in $EDITOR (default: notepad on Windows, vi elsewhere)
`);
}

async function configValidate(): Promise<void> {
  const r = await withGatewayIpc((c) =>
    c.call<{ ok: boolean; errors: string[]; warnings: string[] }>("config.validate", {}),
  );
  if (r.warnings.length > 0) {
    for (const w of r.warnings) {
      console.log(`warning: ${w}`);
    }
  }
  if (r.errors.length > 0) {
    for (const e of r.errors) {
      console.log(`error: ${e}`);
    }
  }
  process.exitCode = r.ok ? 0 : 1;
}

function configList(tomlPath: string): void {
  console.log(tomlPath);
  if (!existsSync(tomlPath)) {
    console.log("(file missing)");
    return;
  }
  console.log(readFileSync(tomlPath, "utf8"));
}

async function configEdit(tomlPath: string): Promise<void> {
  const editor = process.env["EDITOR"]?.trim() || (process.platform === "win32" ? "notepad" : "vi");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [tomlPath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${editor} exited with code ${String(code)}`));
      }
    });
  });
}

export async function runConfig(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    printConfigHelp();
    return;
  }

  const paths = getCliPlatformPaths();
  const tomlPath = join(paths.configDir, "nimbus.toml");

  if (sub === "validate") {
    await configValidate();
    return;
  }

  if (sub === "list") {
    configList(tomlPath);
    return;
  }

  if (sub === "edit") {
    await configEdit(tomlPath);
    return;
  }

  if (sub === "get" || sub === "set") {
    throw new Error(
      `nimbus config ${sub} is not implemented in this release — edit ${tomlPath} or use nimbus config list / edit.`,
    );
  }

  throw new Error(`Unknown config subcommand: ${sub}`);
}
