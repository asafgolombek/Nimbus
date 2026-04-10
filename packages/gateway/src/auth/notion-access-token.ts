import { Config } from "../config.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { parseStoredOAuthTokens } from "./oauth-vault-tokens.ts";
import { refreshNotionToken } from "./pkce.ts";

/**
 * Returns a valid Notion integration access token, refreshing when the synthetic vault expiry is near.
 */
export async function getValidNotionAccessToken(vault: NimbusVault): Promise<string> {
  const raw = await vault.get("notion.oauth");
  if (raw === null || raw === "") {
    throw new Error("Notion OAuth not configured; run: nimbus connector auth notion");
  }
  const parsed = parseStoredOAuthTokens(raw, {
    invalidJson: "Invalid notion.oauth vault payload",
    invalidPayload: "Invalid notion.oauth vault payload",
    missingAccess: "Missing Notion access token",
    missingRefresh: "Missing Notion refresh token",
    missingExpiry: "Missing token expiry",
  });
  const marginMs = 120_000;
  if (parsed.expiresAt > Date.now() + marginMs) {
    return parsed.accessToken;
  }
  const clientId = Config.oauthNotionClientId;
  const clientSecret = Config.oauthNotionClientSecret;
  if (clientId === "" || clientSecret === "") {
    throw new Error(
      "Set NIMBUS_OAUTH_NOTION_CLIENT_ID and NIMBUS_OAUTH_NOTION_CLIENT_SECRET for Notion token refresh",
    );
  }
  const next = await refreshNotionToken(parsed.refreshToken, clientId, clientSecret, { vault });
  return next.accessToken;
}
