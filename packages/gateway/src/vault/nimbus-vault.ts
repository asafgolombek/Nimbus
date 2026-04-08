/**
 * Vault contract — implementations live in platform-specific modules.
 */

export interface NimbusVault {
  /** Store a secret. key format: "<service>.<type>" */
  set(key: string, value: string): Promise<void>;
  /** Returns null for missing keys — never throws on absence. */
  get(key: string): Promise<string | null>;
  /** No-op if key does not exist. */
  delete(key: string): Promise<void>;
  /** Lists key names (never values) for a given prefix. */
  listKeys(prefix?: string): Promise<string[]>;
}
