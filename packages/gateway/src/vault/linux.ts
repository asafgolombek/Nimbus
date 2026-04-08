/**
 * Linux vault — libsecret via `secret-tool` (stdin for secrets; no argv exposure).
 */

import { spawn } from "node:child_process";

import { compareVaultKeysAlphabetically, validateVaultKeyOrThrow } from "./key-format.ts";
import type { NimbusVault } from "./nimbus-vault.ts";

const LABEL_PREFIX = "Nimbus: ";

function nimbusLabel(key: string): string {
  return `${LABEL_PREFIX}${key}`;
}

function runSecretTool(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("secret-tool", args, { stdio: ["pipe", "pipe", "ignore"] });
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
    const keys = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith(LABEL_PREFIX))
      .map((line) => line.slice(LABEL_PREFIX.length))
      .filter((k) => k.length > 0)
      .sort(compareVaultKeysAlphabetically);
    if (prefix === undefined || prefix.length === 0) {
      return keys;
    }
    return keys.filter((k) => k.startsWith(prefix));
  }
}
