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

// TODO Q1: Export platform vault implementations resolved via PAL
