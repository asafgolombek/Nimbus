import { beforeEach, describe, expect, test } from "bun:test";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { ensureRecoverySeed, RECOVERY_SEED_VAULT_KEY, seedIsValidBip39 } from "./recovery-seed.ts";

function makeMemoryVault(): NimbusVault {
  const store = new Map<string, string>();
  return {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
    delete: async (k) => {
      store.delete(k);
    },
    listKeys: async (prefix) =>
      [...store.keys()].filter((k) => (prefix === undefined ? true : k.startsWith(prefix))),
  };
}

describe("recovery seed", () => {
  let vault: NimbusVault;
  beforeEach(() => {
    vault = makeMemoryVault();
  });

  test("ensureRecoverySeed generates a 24-word BIP39 mnemonic on first call", async () => {
    const result = await ensureRecoverySeed(vault);
    expect(result.generated).toBe(true);
    expect(result.mnemonic.split(" ")).toHaveLength(24);
    expect(seedIsValidBip39(result.mnemonic)).toBe(true);
  });

  test("ensureRecoverySeed is idempotent — second call returns the same seed and generated=false", async () => {
    const first = await ensureRecoverySeed(vault);
    const second = await ensureRecoverySeed(vault);
    expect(second.generated).toBe(false);
    expect(second.mnemonic).toBe(first.mnemonic);
  });

  test("vault key is backup.recovery_seed", () => {
    expect(RECOVERY_SEED_VAULT_KEY).toBe("backup.recovery_seed");
  });
});
