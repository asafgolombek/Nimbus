import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  getValidVaultOAuthAccessToken,
  googleOAuthAccessFromConfig,
} from "./oauth-vault-tokens.ts";

/**
 * Returns a valid Google access token, refreshing via PKCE when near expiry.
 */
export async function getValidGoogleAccessToken(vault: NimbusVault): Promise<string> {
  const c = googleOAuthAccessFromConfig();
  return getValidVaultOAuthAccessToken({ vault, ...c });
}
