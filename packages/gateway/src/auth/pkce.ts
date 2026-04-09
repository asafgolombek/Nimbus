import { validateVaultKeyOrThrow } from "../vault/key-format.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export type OAuthProvider = "google" | "microsoft" | "slack" | "notion";

/** Subset of `fetch` for tests and dependency injection (avoids Bun/undici `preconnect` typing drift). */
export type PKCEFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PKCEOptions {
  clientId: string;
  scopes: string[];
  /** If set, this port is tried first (before `portRange`). */
  redirectPort?: number;
  /** Inclusive range of ports to try after `redirectPort` (if any). */
  portRange?: [number, number];
  provider: OAuthProvider;
  vault: NimbusVault;
  openUrl: (url: string) => Promise<void>;
  /** @default global fetch */
  fetchImpl?: PKCEFetch;
  /** Invoked once when binding an OS-assigned ephemeral port (last resort). */
  onRandomPortFallback?: () => void;
}

export interface PKCEResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

const CALLBACK_PATH = "/oauth/callback";
const AUTH_TIMEOUT_MS = 5 * 60_000;

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

const MS_AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

function vaultKeyForProvider(provider: OAuthProvider): string {
  switch (provider) {
    case "google":
      return "google.oauth";
    case "microsoft":
      return "microsoft.oauth";
    case "slack":
      return "slack.oauth";
    case "notion":
      return "notion.oauth";
  }
}

function assertValidPort(p: number): void {
  if (!Number.isInteger(p) || p < 1 || p > 65_535) {
    throw new Error("Invalid redirect port");
  }
}

function isAddrInUse(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const code = (err as { code?: string }).code;
  return code === "EADDRINUSE";
}

function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  const b64 = btoa(binary);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** RFC 7636: code_challenge = BASE64URL(SHA256(code_verifier)). */
export async function pkceCodeChallengeS256(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function buildPortSequence(options: PKCEOptions): Array<number | "ephemeral"> {
  const seen = new Set<number>();
  const seq: Array<number | "ephemeral"> = [];

  if (options.redirectPort !== undefined) {
    assertValidPort(options.redirectPort);
    seen.add(options.redirectPort);
    seq.push(options.redirectPort);
  }

  if (options.portRange !== undefined) {
    const [lo, hi] = options.portRange;
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > 65_535 || lo > hi) {
      throw new Error("Invalid portRange");
    }
    for (let p = lo; p <= hi; p++) {
      if (!seen.has(p)) {
        seen.add(p);
        seq.push(p);
      }
    }
  }

  seq.push("ephemeral");
  return seq;
}

type TokenEndpointResult = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

/** Narrowing shape for OAuth token JSON (avoids `noPropertyAccessFromIndexSignature` on generic records). */
type OAuthTokenJson = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
};

function parseTokenJson(json: unknown): TokenEndpointResult {
  if (json === null || typeof json !== "object") {
    throw new Error("Token response was not valid JSON");
  }
  const o = json as OAuthTokenJson;
  const access = o.access_token;
  const rawExpires = o.expires_in;
  if (typeof access !== "string" || access.length === 0) {
    throw new Error("Token response missing access_token");
  }
  const expiresIn =
    typeof rawExpires === "number"
      ? rawExpires
      : typeof rawExpires === "string"
        ? Number.parseInt(rawExpires, 10)
        : Number.NaN;
  if (!Number.isFinite(expiresIn) || expiresIn < 0) {
    throw new Error("Token response missing expires_in");
  }
  const refresh = o.refresh_token;
  const scope = o.scope;
  const out: TokenEndpointResult = {
    access_token: access,
    expires_in: expiresIn,
  };
  if (typeof refresh === "string" && refresh.length > 0) {
    out.refresh_token = refresh;
  }
  if (typeof scope === "string" && scope.length > 0) {
    out.scope = scope;
  }
  return out;
}

async function postForm(
  fetchFn: PKCEFetch,
  url: string,
  body: Record<string, string>,
): Promise<unknown> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    params.set(k, v);
  }
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Token endpoint returned non-JSON");
  }
  if (!res.ok) {
    throw new Error("Token exchange failed");
  }
  return parsed;
}

function scopesFromTokenResponse(scopeField: string | undefined, requested: string[]): string[] {
  if (scopeField !== undefined && scopeField.trim() !== "") {
    return scopeField.split(/\s+/).filter((s) => s.length > 0);
  }
  return requested;
}

async function persistTokens(
  vault: NimbusVault,
  provider: OAuthProvider,
  result: PKCEResult,
): Promise<void> {
  const key = vaultKeyForProvider(provider);
  validateVaultKeyOrThrow(key);
  const payload = JSON.stringify({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    scopes: result.scopes,
  });
  await vault.set(key, payload);
}

async function runOnLocalPort(
  options: PKCEOptions,
  bindPort: number,
  fetchFn: PKCEFetch,
): Promise<PKCEResult> {
  const { provider, clientId, scopes, vault, openUrl } = options;
  if (provider === "slack" || provider === "notion") {
    throw new Error(`PKCE OAuth for provider "${provider}" is not implemented yet`);
  }

  const codeVerifier = randomUrlSafeString(32);
  const codeChallenge = await pkceCodeChallengeS256(codeVerifier);
  const state = randomUrlSafeString(16);

  let completion: { code: string } | { error: string } | undefined;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: bindPort,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname !== CALLBACK_PATH) {
        return new Response("Not Found", { status: 404 });
      }
      const err = u.searchParams.get("error");
      if (err !== null && err !== "") {
        completion = { error: err };
        return new Response("Authorization was denied. You can close this window.", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      const code = u.searchParams.get("code");
      const st = u.searchParams.get("state");
      if (code === null || code === "" || st !== state) {
        return new Response("Invalid callback", { status: 400 });
      }
      completion = { code };
      return new Response("Signed in. You can close this window.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    },
  });

  const boundPort = server.port;
  const redirectUri = `http://127.0.0.1:${String(boundPort)}${CALLBACK_PATH}`;

  const authUrl = new URL(provider === "google" ? GOOGLE_AUTH : MS_AUTH);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") {
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
  }

  const abortTimer = setTimeout(() => {
    completion ??= { error: "timeout" };
  }, AUTH_TIMEOUT_MS);

  try {
    await openUrl(authUrl.toString());

    while (completion === undefined) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const done = completion;
    if ("error" in done) {
      throw new Error("OAuth authorization did not complete");
    }

    const tokenUrl = provider === "google" ? GOOGLE_TOKEN : MS_TOKEN;
    const tokenBody: Record<string, string> = {
      client_id: clientId,
      grant_type: "authorization_code",
      code: done.code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    };

    const json = await postForm(fetchFn, tokenUrl, tokenBody);
    const parsed = parseTokenJson(json);
    const refreshTok = parsed.refresh_token;
    if (refreshTok === undefined || refreshTok === "") {
      throw new Error("No refresh token returned; try revoking app access and signing in again");
    }

    const result: PKCEResult = {
      accessToken: parsed.access_token,
      refreshToken: refreshTok,
      expiresAt: Date.now() + Math.floor(parsed.expires_in * 1000),
      scopes: scopesFromTokenResponse(parsed.scope, scopes),
    };

    await persistTokens(vault, provider, result);
    return result;
  } finally {
    clearTimeout(abortTimer);
    server.stop();
  }
}

export async function runPKCEFlow(options: PKCEOptions): Promise<PKCEResult> {
  const fetchFn: PKCEFetch = options.fetchImpl ?? ((i, init) => globalThis.fetch(i, init));
  const sequence = buildPortSequence(options);

  for (const spec of sequence) {
    if (spec === "ephemeral") {
      options.onRandomPortFallback?.();
    }
    const bindPort = spec === "ephemeral" ? 0 : spec;
    try {
      return await runOnLocalPort(options, bindPort, fetchFn);
    } catch (err) {
      if (spec !== "ephemeral" && isAddrInUse(err)) {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Could not bind a local port for OAuth callback");
}

export interface RefreshAccessTokenContext {
  vault: NimbusVault;
  fetchImpl?: PKCEFetch;
}

export async function refreshAccessToken(
  refreshToken: string,
  provider: "google" | "microsoft",
  clientId: string,
  ctx: RefreshAccessTokenContext,
): Promise<PKCEResult> {
  const fetchFn: PKCEFetch = ctx.fetchImpl ?? ((i, init) => globalThis.fetch(i, init));
  const tokenUrl = provider === "google" ? GOOGLE_TOKEN : MS_TOKEN;
  const json = await postForm(fetchFn, tokenUrl, {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const parsed = parseTokenJson(json);
  const newRefresh = parsed.refresh_token ?? refreshToken;
  const result: PKCEResult = {
    accessToken: parsed.access_token,
    refreshToken: newRefresh,
    expiresAt: Date.now() + Math.floor(parsed.expires_in * 1000),
    scopes: scopesFromTokenResponse(parsed.scope, []),
  };
  await persistTokens(ctx.vault, provider, result);
  return result;
}
