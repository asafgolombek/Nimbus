/**
 * Secure Vault — OS-native credential storage
 *
 * Platform implementations:
 * - Windows: CryptProtectData / DPAPI
 * - macOS: SecItemAdd / SecItemCopyMatching (Keychain Services)
 * - Linux: org.freedesktop.secrets via libsecret
 *
 * Invariants:
 * - No credential ever touches disk in plaintext
 * - No credential appears in logs, IPC responses, or error messages
 * - get() returns null for missing keys — never throws on absence
 *
 * See architecture.md §Subsystem 3: The Secure Vault
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

/**
 * Validates documented vault key shape (`<segment>.<segment>`) for API boundaries.
 * PAL implementations remain authoritative; this is a shared guard for callers.
 */
export function isWellFormedVaultKey(key: string): boolean {
  if (key.length === 0 || key.length > 256) {
    return false;
  }
  return /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(key);
}

// TODO Q1: Export platform vault implementations resolved via PAL
