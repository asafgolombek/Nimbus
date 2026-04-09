import { Config } from "../config.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { refreshAccessToken } from "./pkce.ts";

type MicrosoftOAuthVaultPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

function parseMicrosoftOAuthPayload(raw: string): MicrosoftOAuthVaultPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid microsoft.oauth vault payload");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid microsoft.oauth vault payload");
  }
  const rec = parsed as Record<string, unknown>;
  const accessToken = rec["accessToken"];
  const refreshToken = rec["refreshToken"];
  const expiresAt = rec["expiresAt"];
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new Error("Missing Microsoft access token");
  }
  if (typeof refreshToken !== "string" || refreshToken === "") {
    throw new Error("Missing Microsoft refresh token");
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new Error("Missing token expiry");
  }
  return { accessToken, refreshToken, expiresAt };
}

/**
 * Returns a valid Microsoft Graph access token, refreshing via PKCE when near expiry.
 */
export async function getValidMicrosoftAccessToken(vault: NimbusVault): Promise<string> {
  const raw = await vault.get("microsoft.oauth");
  if (raw === null || raw === "") {
    throw new Error(
      "Microsoft OAuth not configured; run: nimbus connector auth onedrive (or outlook / teams)",
    );
  }
  const parsed = parseMicrosoftOAuthPayload(raw);
  const marginMs = 120_000;
  if (parsed.expiresAt > Date.now() + marginMs) {
    return parsed.accessToken;
  }
  const clientId = Config.oauthMicrosoftClientId;
  if (clientId === "") {
    throw new Error("Set NIMBUS_OAUTH_MICROSOFT_CLIENT_ID for token refresh");
  }
  const next = await refreshAccessToken(parsed.refreshToken, "microsoft", clientId, { vault });
  return next.accessToken;
}
