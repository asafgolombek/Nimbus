import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export const RECOVERY_SEED_VAULT_KEY = "backup.recovery_seed";

/** 24 words = 256 bits of entropy. */
const MNEMONIC_STRENGTH_BITS = 256;

export type EnsureSeedResult = {
  mnemonic: string;
  /** True only on the call that generated a new seed. */
  generated: boolean;
};

export async function ensureRecoverySeed(vault: NimbusVault): Promise<EnsureSeedResult> {
  const existing = await vault.get(RECOVERY_SEED_VAULT_KEY);
  if (existing !== null && existing !== "") {
    return { mnemonic: existing, generated: false };
  }
  const mnemonic = generateMnemonic(wordlist, MNEMONIC_STRENGTH_BITS);
  await vault.set(RECOVERY_SEED_VAULT_KEY, mnemonic);
  return { mnemonic, generated: true };
}

export function seedIsValidBip39(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}
