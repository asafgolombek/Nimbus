import { describe, expect, mock, test } from "bun:test";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { CONNECTOR_SERVICE_IDS } from "./connector-catalog.ts";
import {
  CONNECTOR_VAULT_SECRET_KEYS,
  clearConnectorVaultSecretKeys,
} from "./connector-secrets-manifest.ts";

describe("CONNECTOR_VAULT_SECRET_KEYS", () => {
  test("lists every connector service id", () => {
    for (const id of CONNECTOR_SERVICE_IDS) {
      expect(Array.isArray(CONNECTOR_VAULT_SECRET_KEYS[id])).toBe(true);
    }
  });
});

describe("clearConnectorVaultSecretKeys", () => {
  test("deletes all keys for github", async () => {
    const deleted: string[] = [];
    const vault: NimbusVault = {
      get: mock(async () => null),
      set: mock(async () => {
        /* noop */
      }),
      delete: mock(async (k: string) => {
        deleted.push(k);
      }),
      listKeys: mock(async () => []),
    };
    const keys = await clearConnectorVaultSecretKeys(vault, "github");
    expect(keys).toEqual(["github.pat"]);
    expect(deleted).toEqual(["github.pat"]);
  });
});
