/**
 * Vault key shape: "<segment>.<segment>" — shared by all vault implementations.
 */

export function isWellFormedVaultKey(key: string): boolean {
  if (key.length === 0 || key.length > 256) {
    return false;
  }
  return /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(key);
}

/** Throws a generic error — never include secret material in the message. */
export function validateVaultKeyOrThrow(key: string): void {
  if (!isWellFormedVaultKey(key)) {
    throw new Error("Invalid vault key format");
  }
}
