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

export { createNimbusVault } from "./factory.ts";

export { isWellFormedVaultKey, validateVaultKeyOrThrow } from "./key-format.ts";
export type {
  NimbusVault,
  VaultDeleter,
  VaultLister,
  VaultReader,
  VaultWriter,
} from "./nimbus-vault.ts";
