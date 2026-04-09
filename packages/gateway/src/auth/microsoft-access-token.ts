import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  getValidVaultOAuthAccessToken,
  microsoftOAuthAccessFromConfig,
} from "./oauth-vault-tokens.ts";

/**
 * Returns a valid Microsoft Graph access token, refreshing via PKCE when near expiry.
 */
export async function getValidMicrosoftAccessToken(vault: NimbusVault): Promise<string> {
  const c = microsoftOAuthAccessFromConfig();
  return getValidVaultOAuthAccessToken({ vault, ...c });
}
