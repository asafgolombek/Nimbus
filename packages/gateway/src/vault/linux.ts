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
 * Parses `secret-tool search --all` stdout: each matched item includes a line
 * `label = Nimbus: <vaultKey>` (see libsecret `secret-tool.c`).
 * Exported for unit tests (runs on every OS); do not log or return secret values.
 */
export function extractNimbusVaultKeysFromSecretToolSearchOutput(raw: string): string[] {
  const labelLine = /^label = Nimbus: (.+)$/gm;
  const keys: string[] = [];
  for (const m of raw.matchAll(labelLine)) {
    const k = m[1]?.trim() ?? "";
    if (k.length > 0) {
      keys.push(k);
    }
  }
  keys.sort(compareVaultKeysAlphabetically);
  return keys;
}

function runSecretTool(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(secretToolExecutable(), args, { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      out += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(new Error("Vault operation failed"));
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin, "utf8");
    }
    child.stdin.end();
  });
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
    let raw: string;
    try {
      raw = await runSecretTool(["search", "--all", "application", "nimbus"]);
    } catch {
      return [];
    }
    const keys = extractNimbusVaultKeysFromSecretToolSearchOutput(raw);
    if (prefix === undefined || prefix.length === 0) {
      return keys;
    }
    return keys.filter((k) => k.startsWith(prefix));
  }
}
