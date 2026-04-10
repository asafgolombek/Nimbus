import { Config } from "../config.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { refreshAccessToken } from "./pkce.ts";

export type StoredOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type ParseStoredOAuthErrors = {
  invalidJson: string;
  invalidPayload: string;
  missingAccess: string;
  missingRefresh: string;
  missingExpiry: string;
};

export function parseStoredOAuthTokens(
  raw: string,
  errs: ParseStoredOAuthErrors,
): StoredOAuthTokens {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError(errs.invalidJson);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(errs.invalidPayload);
  }
  const rec = parsed as Record<string, unknown>;
  const accessToken = rec["accessToken"];
  const refreshToken = rec["refreshToken"];
  const expiresAt = rec["expiresAt"];
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new TypeError(errs.missingAccess);
  }
  if (typeof refreshToken !== "string" || refreshToken === "") {
    throw new TypeError(errs.missingRefresh);
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new TypeError(errs.missingExpiry);
  }
  return { accessToken, refreshToken, expiresAt };
}

export async function getValidVaultOAuthAccessToken(args: {
  vault: NimbusVault;
  vaultKey: string;
  notConfiguredError: string;
  parseErrors: ParseStoredOAuthErrors;
  marginMs?: number;
  getClientId: () => string;
  emptyClientIdError: string;
  provider: "google" | "microsoft";
}): Promise<string> {
  const raw = await args.vault.get(args.vaultKey);
  if (raw === null || raw === "") {
    throw new Error(args.notConfiguredError);
  }
  const parsed = parseStoredOAuthTokens(raw, args.parseErrors);
  const marginMs = args.marginMs ?? 120_000;
  if (parsed.expiresAt > Date.now() + marginMs) {
    return parsed.accessToken;
  }
  const clientId = args.getClientId();
  if (clientId === "") {
    throw new Error(args.emptyClientIdError);
  }
  const next = await refreshAccessToken(parsed.refreshToken, args.provider, clientId, {
    vault: args.vault,
  });
  return next.accessToken;
}

export function googleOAuthAccessFromConfig(): {
  vaultKey: string;
  notConfiguredError: string;
  parseErrors: ParseStoredOAuthErrors;
  getClientId: () => string;
  emptyClientIdError: string;
  provider: "google";
} {
  return {
    vaultKey: "google.oauth",
    notConfiguredError:
      "Google OAuth not configured; run: nimbus connector auth google_drive (or gmail / google_photos)",
    parseErrors: {
      invalidJson: "Invalid google.oauth vault payload",
      invalidPayload: "Invalid google.oauth vault payload",
      missingAccess: "Missing Google access token",
      missingRefresh: "Missing Google refresh token",
      missingExpiry: "Missing token expiry",
    },
    getClientId: () => Config.oauthGoogleClientId,
    emptyClientIdError: "Set NIMBUS_OAUTH_GOOGLE_CLIENT_ID for token refresh",
    provider: "google",
  };
}

export function microsoftOAuthAccessFromConfig(): {
  vaultKey: string;
  notConfiguredError: string;
  parseErrors: ParseStoredOAuthErrors;
  getClientId: () => string;
  emptyClientIdError: string;
  provider: "microsoft";
} {
  return {
    vaultKey: "microsoft.oauth",
    notConfiguredError:
      "Microsoft OAuth not configured; run: nimbus connector auth onedrive (or outlook / teams)",
    parseErrors: {
      invalidJson: "Invalid microsoft.oauth vault payload",
      invalidPayload: "Invalid microsoft.oauth vault payload",
      missingAccess: "Missing Microsoft access token",
      missingRefresh: "Missing Microsoft refresh token",
      missingExpiry: "Missing token expiry",
    },
    getClientId: () => Config.oauthMicrosoftClientId,
    emptyClientIdError: "Set NIMBUS_OAUTH_MICROSOFT_CLIENT_ID for token refresh",
    provider: "microsoft",
  };
}
