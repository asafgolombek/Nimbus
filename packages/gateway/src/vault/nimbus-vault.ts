/**
 * Vault contract — implementations live in platform-specific modules.
 */

export interface VaultReader {
  /** Returns null for missing keys — never throws on absence. */
  get(key: string): Promise<string | null>;
}

export interface VaultWriter {
  /** Store a secret. key format: "<service>.<type>" */
  set(key: string, value: string): Promise<void>;
}

export interface VaultDeleter {
  /** No-op if key does not exist. */
  delete(key: string): Promise<void>;
}

export interface VaultLister {
  /** Lists key names (never values) for a given prefix. */
  listKeys(prefix?: string): Promise<string[]>;
}

export interface NimbusVault extends VaultReader, VaultWriter, VaultDeleter, VaultLister {}
