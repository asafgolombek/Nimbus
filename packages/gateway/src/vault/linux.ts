/**
 * Linux vault — libsecret via `secret-tool` (stdin for secrets; no argv exposure).
 * Spawn uses the FHS path so execution does not depend on the process PATH (Sonar S4036).
 */

import { spawn } from "node:child_process";

import { compareVaultKeysAlphabetically, validateVaultKeyOrThrow } from "./key-format.ts";
import type { NimbusVault } from "./nimbus-vault.ts";

/** FHS path when `secret-tool` is not on `PATH` (e.g. minimal systemd environments). */
const SECRET_TOOL_FALLBACK = "/usr/bin/secret-tool";

const LABEL_PREFIX = "Nimbus: ";

function secretToolExecutable(): string {
  return Bun.which("secret-tool") ?? SECRET_TOOL_FALLBACK;
}

function nimbusLabel(key: string): string {
  return `${LABEL_PREFIX}${key}`;
}

/**
 * Parses `secret-tool search --all` output (see libsecret `secret-tool.c`):
 * - stdout: `label = Nimbus: <vaultKey>` per item
 * - stderr: `attribute.nimbus-key = <vaultKey>` per item (attributes use g_printerr)
 *
 * Exported for unit tests (runs on every OS); do not log or return secret values.
 */
export function extractNimbusVaultKeysFromSecretToolSearchOutput(
  stdout: string,
  stderr?: string,
): string[] {
  const keys = new Set<string>();
  const labelLine = /^label = Nimbus: (.+)$/gm;
  for (const m of stdout.matchAll(labelLine)) {
    const k = m[1]?.trim() ?? "";
    if (k.length > 0) {
      keys.add(k);
    }
  }
  if (stderr !== undefined && stderr.length > 0) {
    const nimbusKeyAttr = /^attribute\.nimbus-key = (.+)$/gm;
    for (const m of stderr.matchAll(nimbusKeyAttr)) {
      const k = m[1]?.trim() ?? "";
      if (k.length > 0) {
        keys.add(k);
      }
    }
  }
  return Array.from(keys).sort(compareVaultKeysAlphabetically);
}

function spawnSecretTool(
  args: string[],
  options: { stdin?: string; captureStderr: boolean },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stdio: ["pipe", "pipe", "pipe" | "ignore"] = options.captureStderr
      ? ["pipe", "pipe", "pipe"]
      : ["pipe", "pipe", "ignore"];
    const child = spawn(secretToolExecutable(), args, { stdio });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c: string) => {
        stderr += c;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin, "utf8");
    }
    child.stdin.end();
  });
}

async function runSecretTool(args: string[], stdin?: string): Promise<string> {
  const r = await spawnSecretTool(args, { stdin, captureStderr: false });
  if (r.code === 0) {
    return r.stdout;
  }
  throw new Error("Vault operation failed");
}

export class LinuxSecretToolVault implements NimbusVault {
  async set(key: string, value: string): Promise<void> {
    validateVaultKeyOrThrow(key);
    await runSecretTool(
      ["store", "--label", nimbusLabel(key), "application", "nimbus", "nimbus-key", key],
      value,
    );
  }

  async get(key: string): Promise<string | null> {
    validateVaultKeyOrThrow(key);
    try {
      const out = await runSecretTool(["lookup", "application", "nimbus", "nimbus-key", key]);
      return out.replace(/\n$/, "");
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    validateVaultKeyOrThrow(key);
    try {
      await runSecretTool(["clear", "application", "nimbus", "nimbus-key", key]);
    } catch {
      /* treat as no-op if missing */
    }
  }

  async listKeys(prefix?: string): Promise<string[]> {
    let stdout: string;
    let stderr: string;
    try {
      const r = await spawnSecretTool(["search", "--all", "application", "nimbus"], {
        captureStderr: true,
      });
      if (r.code !== 0) {
        return [];
      }
      stdout = r.stdout;
      stderr = r.stderr;
    } catch {
      return [];
    }
    const keys = extractNimbusVaultKeysFromSecretToolSearchOutput(stdout, stderr);
    if (prefix === undefined || prefix.length === 0) {
      return keys;
    }
    return keys.filter((k) => k.startsWith(prefix));
  }
}
