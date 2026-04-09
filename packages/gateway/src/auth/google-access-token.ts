import { Config } from "../config.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { refreshAccessToken } from "./pkce.ts";

type GoogleOAuthVaultPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

function parseGoogleOAuthPayload(raw: string): GoogleOAuthVaultPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid google.oauth vault payload");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid google.oauth vault payload");
  }
  const rec = parsed as Record<string, unknown>;
  const accessToken = rec["accessToken"];
  const refreshToken = rec["refreshToken"];
  const expiresAt = rec["expiresAt"];
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new Error("Missing Google access token");
  }
  if (typeof refreshToken !== "string" || refreshToken === "") {
    throw new Error("Missing Google refresh token");
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new Error("Missing token expiry");
  }
  return { accessToken, refreshToken, expiresAt };
}

/**
 * Returns a valid Google access token, refreshing via PKCE when near expiry.
 */
export async function getValidGoogleAccessToken(vault: NimbusVault): Promise<string> {
  const raw = await vault.get("google.oauth");
  if (raw === null || raw === "") {
    throw new Error("Google OAuth not configured; run: nimbus connector auth google_drive");
  }
  const parsed = parseGoogleOAuthPayload(raw);
  const marginMs = 120_000;
  if (parsed.expiresAt > Date.now() + marginMs) {
    return parsed.accessToken;
  }
  const clientId = Config.oauthGoogleClientId;
  if (clientId === "") {
    throw new Error("Set NIMBUS_OAUTH_GOOGLE_CLIENT_ID for token refresh");
  }
  const next = await refreshAccessToken(parsed.refreshToken, "google", clientId, { vault });
  return next.accessToken;
}
