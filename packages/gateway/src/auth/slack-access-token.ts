import { Config } from "../config.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { parseStoredOAuthTokens } from "./oauth-vault-tokens.ts";
import { refreshSlackUserToken } from "./pkce.ts";

/**
 * Returns a valid Slack user access token, refreshing via `oauth.v2.access` when near expiry.
 */
export async function getValidSlackAccessToken(vault: NimbusVault): Promise<string> {
  const raw = await vault.get("slack.oauth");
  if (raw === null || raw === "") {
    throw new Error("Slack OAuth not configured; run: nimbus connector auth slack");
  }
  const parsed = parseStoredOAuthTokens(raw, {
    invalidJson: "Invalid slack.oauth vault payload",
    invalidPayload: "Invalid slack.oauth vault payload",
    missingAccess: "Missing Slack access token",
    missingRefresh: "Missing Slack refresh token",
    missingExpiry: "Missing token expiry",
  });
  const marginMs = 120_000;
  if (parsed.expiresAt > Date.now() + marginMs) {
    return parsed.accessToken;
  }
  const clientId = Config.oauthSlackClientId;
  if (clientId === "") {
    throw new Error("Set NIMBUS_OAUTH_SLACK_CLIENT_ID for Slack token refresh");
  }
  const next = await refreshSlackUserToken(parsed.refreshToken, clientId, { vault });
  return next.accessToken;
}
