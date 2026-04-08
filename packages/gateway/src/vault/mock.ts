import { validateVaultKeyOrThrow } from "./key-format.ts";
import type { NimbusVault } from "./nimbus-vault.ts";

/**
 * In-memory vault for tests and PAL bootstrap until OS vaults land (Stage 2).
 * Do not use for production secrets.
 */
export class MockVault implements NimbusVault {
  private readonly store = new Map<string, string>();

  async set(key: string, value: string): Promise<void> {
    validateVaultKeyOrThrow(key);
    this.store.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    validateVaultKeyOrThrow(key);
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    validateVaultKeyOrThrow(key);
    this.store.delete(key);
  }

  async listKeys(prefix?: string): Promise<string[]> {
    const keys = [...this.store.keys()].sort();
    if (prefix === undefined || prefix.length === 0) {
      return keys;
    }
    return keys.filter((k) => k.startsWith(prefix));
  }
}

export function createMockVault(): NimbusVault {
  return new MockVault();
}
