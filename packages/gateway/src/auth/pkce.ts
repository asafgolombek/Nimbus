import { validateVaultKeyOrThrow } from "../vault/key-format.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export type OAuthProvider = "google" | "microsoft" | "slack" | "notion";

/** Subset of `fetch` for tests and dependency injection (avoids Bun/undici `preconnect` typing drift). */
export type PKCEFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PKCEOptions {
  clientId: string;
  scopes: string[];
  /**
   * Notion public integrations require `client_secret` at the token endpoint (HTTP Basic).
   * Supplied from env via `connector.auth` — never from IPC user params.
   */
  oauthClientSecret?: string;
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

const SLACK_AUTH = "https://slack.com/oauth/v2/authorize";
const SLACK_OAUTH_V2_ACCESS = "https://slack.com/api/oauth.v2.access";

const NOTION_AUTH = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN = "https://api.notion.com/v1/oauth/token";
const NOTION_API_VERSION = "2022-06-28";

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
  for (const b of bytes) {
    binary += String.fromCharCode(b);
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

function parseExpiresInSeconds(raw: unknown): number {
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string") {
    return Number.parseInt(raw, 10);
  }
  return Number.NaN;
}

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
  const expiresIn = parseExpiresInSeconds(rawExpires);
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

type OAuthCompletion = { code: string } | { error: string };

function handlePkceCallbackRequest(
  req: Request,
  expectedState: string,
  sink: { value?: OAuthCompletion },
): Response {
  const u = new URL(req.url);
  if (u.pathname !== CALLBACK_PATH) {
    return new Response("Not Found", { status: 404 });
  }
  const err = u.searchParams.get("error");
  if (err !== null && err !== "") {
    sink.value = { error: err };
    return new Response("Authorization was denied. You can close this window.", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const code = u.searchParams.get("code");
  const st = u.searchParams.get("state");
  if (code === null || code === "" || st !== expectedState) {
    return new Response("Invalid callback", { status: 400 });
  }
  sink.value = { code };
  return new Response("Signed in. You can close this window.", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function buildPkceAuthorizeUrl(
  provider: "google" | "microsoft",
  params: {
    clientId: string;
    scopes: string[];
    redirectUri: string;
    state: string;
    codeChallenge: string;
  },
): URL {
  const authUrl = new URL(provider === "google" ? GOOGLE_AUTH : MS_AUTH);
  authUrl.searchParams.set("client_id", params.clientId);
  authUrl.searchParams.set("redirect_uri", params.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", params.scopes.join(" "));
  authUrl.searchParams.set("state", params.state);
  authUrl.searchParams.set("code_challenge", params.codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") {
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
  }
  return authUrl;
}

function buildNotionAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): URL {
  const authUrl = new URL(NOTION_AUTH);
  authUrl.searchParams.set("client_id", params.clientId);
  authUrl.searchParams.set("redirect_uri", params.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("owner", "user");
  authUrl.searchParams.set("state", params.state);
  return authUrl;
}

function notionBasicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}

type NotionTokenJson = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
};

function pkceResultFromNotionTokenJson(
  json: unknown,
  requestedScopes: string[],
  allowNullRefresh: boolean,
): PKCEResult {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("Notion token response invalid");
  }
  const o = json as NotionTokenJson;
  const access = o.access_token;
  const refresh = o.refresh_token;
  if (typeof access !== "string" || access === "") {
    throw new Error("Notion token response missing access_token");
  }
  const refreshStr = typeof refresh === "string" && refresh !== "" ? refresh : "";
  if (refreshStr === "" && !allowNullRefresh) {
    throw new Error("Notion token response missing refresh_token");
  }
  const syntheticExpiresSec = 86_400;
  return {
    accessToken: access,
    refreshToken: refreshStr,
    expiresAt: Date.now() + syntheticExpiresSec * 1000,
    scopes: requestedScopes,
  };
}

async function exchangeNotionAuthorizationCode(
  fetchFn: PKCEFetch,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  authCode: string,
  requestedScopes: string[],
): Promise<PKCEResult> {
  const res = await fetchFn(NOTION_TOKEN, {
    method: "POST",
    headers: {
      Authorization: notionBasicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: redirectUri,
    }),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Notion token endpoint returned non-JSON");
  }
  if (!res.ok) {
    throw new Error("Notion token exchange failed");
  }
  return pkceResultFromNotionTokenJson(parsed, requestedScopes, false);
}

async function runNotionOAuthOnLocalPort(
  options: PKCEOptions,
  bindPort: number,
  fetchFn: PKCEFetch,
): Promise<PKCEResult> {
  const { clientId, scopes, vault, openUrl } = options;
  const clientSecret = options.oauthClientSecret;
  if (clientSecret === undefined || clientSecret === "") {
    throw new Error("Notion OAuth requires oauthClientSecret (integration client secret)");
  }
  const state = randomUrlSafeString(16);
  const completion: { value?: OAuthCompletion } = {};

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: bindPort,
    fetch(req) {
      return handlePkceCallbackRequest(req, state, completion);
    },
  });

  const boundPort = server.port;
  const redirectUri = `http://127.0.0.1:${String(boundPort)}${CALLBACK_PATH}`;
  const authUrl = buildNotionAuthorizeUrl({
    clientId,
    redirectUri,
    state,
  });

  const abortTimer = setTimeout(() => {
    completion.value ??= { error: "timeout" };
  }, AUTH_TIMEOUT_MS);

  try {
    await openUrl(authUrl.toString());

    while (completion.value === undefined) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const done = completion.value;
    if ("error" in done) {
      throw new Error("OAuth authorization did not complete");
    }

    const result = await exchangeNotionAuthorizationCode(
      fetchFn,
      clientId,
      clientSecret,
      redirectUri,
      done.code,
      scopes,
    );

    await persistTokens(vault, "notion", result);
    return result;
  } finally {
    clearTimeout(abortTimer);
    server.stop();
  }
}

function buildSlackAuthorizeUrl(params: {
  clientId: string;
  userScopes: string[];
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): URL {
  const authUrl = new URL(SLACK_AUTH);
  authUrl.searchParams.set("client_id", params.clientId);
  authUrl.searchParams.set("user_scope", params.userScopes.join(","));
  authUrl.searchParams.set("redirect_uri", params.redirectUri);
  authUrl.searchParams.set("state", params.state);
  authUrl.searchParams.set("code_challenge", params.codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", "");
  return authUrl;
}

async function slackOAuthV2Access(
  fetchFn: PKCEFetch,
  body: Record<string, string>,
): Promise<unknown> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    params.set(k, v);
  }
  const res = await fetchFn(SLACK_OAUTH_V2_ACCESS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Slack token endpoint returned non-JSON");
  }
  if (!res.ok) {
    throw new Error("Slack token HTTP error");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Slack token response invalid");
  }
  if ((parsed as { ok?: unknown }).ok !== true) {
    throw new Error("Slack OAuth token exchange failed");
  }
  return parsed;
}

function pkceResultFromSlackOAuthV2Access(json: unknown, requestedScopes: string[]): PKCEResult {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("Invalid Slack OAuth response");
  }
  const root = json as Record<string, unknown>;
  const au = root["authed_user"];
  if (au === null || typeof au !== "object" || Array.isArray(au)) {
    throw new Error("Slack OAuth response missing authed_user");
  }
  const user = au as Record<string, unknown>;
  const access = user["access_token"];
  if (typeof access !== "string" || access === "") {
    throw new Error("Slack user access token missing");
  }
  const refresh = user["refresh_token"];
  const refreshTok = typeof refresh === "string" && refresh !== "" ? refresh : "";
  if (refreshTok === "") {
    throw new Error(
      "Slack refresh token missing; enable token rotation on the Slack app and re-authorize",
    );
  }
  const expIn = user["expires_in"];
  const expiresSec =
    typeof expIn === "number" && Number.isFinite(expIn)
      ? expIn
      : typeof expIn === "string"
        ? Number.parseInt(expIn, 10)
        : Number.NaN;
  const safeExpires = Number.isFinite(expiresSec) && expiresSec > 0 ? expiresSec : 43_200;
  const scopeStr = user["scope"];
  const scopes =
    typeof scopeStr === "string" && scopeStr.trim() !== ""
      ? scopeStr
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : requestedScopes;
  return {
    accessToken: access,
    refreshToken: refreshTok,
    expiresAt: Date.now() + Math.floor(safeExpires * 1000),
    scopes,
  };
}

async function exchangeSlackAuthorizationCode(
  fetchFn: PKCEFetch,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  authCode: string,
  requestedScopes: string[],
): Promise<PKCEResult> {
  const json = await slackOAuthV2Access(fetchFn, {
    client_id: clientId,
    code: authCode,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  return pkceResultFromSlackOAuthV2Access(json, requestedScopes);
}

async function runSlackOAuthOnLocalPort(
  options: PKCEOptions,
  bindPort: number,
  fetchFn: PKCEFetch,
): Promise<PKCEResult> {
  const { clientId, scopes, vault, openUrl } = options;
  const codeVerifier = randomUrlSafeString(32);
  const codeChallenge = await pkceCodeChallengeS256(codeVerifier);
  const state = randomUrlSafeString(16);
  const completion: { value?: OAuthCompletion } = {};

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: bindPort,
    fetch(req) {
      return handlePkceCallbackRequest(req, state, completion);
    },
  });

  const boundPort = server.port;
  const redirectUri = `http://127.0.0.1:${String(boundPort)}${CALLBACK_PATH}`;
  const authUrl = buildSlackAuthorizeUrl({
    clientId,
    userScopes: scopes,
    redirectUri,
    state,
    codeChallenge,
  });

  const abortTimer = setTimeout(() => {
    completion.value ??= { error: "timeout" };
  }, AUTH_TIMEOUT_MS);

  try {
    await openUrl(authUrl.toString());

    while (completion.value === undefined) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const done = completion.value;
    if ("error" in done) {
      throw new Error("OAuth authorization did not complete");
    }

    const result = await exchangeSlackAuthorizationCode(
      fetchFn,
      clientId,
      redirectUri,
      codeVerifier,
      done.code,
      scopes,
    );
    await persistTokens(vault, "slack", result);
    return result;
  } finally {
    clearTimeout(abortTimer);
    server.stop();
  }
}

async function exchangePkceAuthorizationCode(
  fetchFn: PKCEFetch,
  provider: "google" | "microsoft",
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  authCode: string,
  requestedScopes: string[],
): Promise<PKCEResult> {
  const tokenUrl = provider === "google" ? GOOGLE_TOKEN : MS_TOKEN;
  const tokenBody: Record<string, string> = {
    client_id: clientId,
    grant_type: "authorization_code",
    code: authCode,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  };
  const json = await postForm(fetchFn, tokenUrl, tokenBody);
  const parsed = parseTokenJson(json);
  const refreshTok = parsed.refresh_token;
  if (refreshTok === undefined || refreshTok === "") {
    throw new Error("No refresh token returned; try revoking app access and signing in again");
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: refreshTok,
    expiresAt: Date.now() + Math.floor(parsed.expires_in * 1000),
    scopes: scopesFromTokenResponse(parsed.scope, requestedScopes),
  };
}

async function runOnLocalPort(
  options: PKCEOptions,
  bindPort: number,
  fetchFn: PKCEFetch,
): Promise<PKCEResult> {
  const { provider, clientId, scopes, vault, openUrl } = options;
  if (provider === "slack") {
    return await runSlackOAuthOnLocalPort(options, bindPort, fetchFn);
  }
  if (provider === "notion") {
    return await runNotionOAuthOnLocalPort(options, bindPort, fetchFn);
  }

  const codeVerifier = randomUrlSafeString(32);
  const codeChallenge = await pkceCodeChallengeS256(codeVerifier);
  const state = randomUrlSafeString(16);

  const completion: { value?: OAuthCompletion } = {};

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: bindPort,
    fetch(req) {
      return handlePkceCallbackRequest(req, state, completion);
    },
  });

  const boundPort = server.port;
  const redirectUri = `http://127.0.0.1:${String(boundPort)}${CALLBACK_PATH}`;
  const authUrl = buildPkceAuthorizeUrl(provider, {
    clientId,
    scopes,
    redirectUri,
    state,
    codeChallenge,
  });

  const abortTimer = setTimeout(() => {
    completion.value ??= { error: "timeout" };
  }, AUTH_TIMEOUT_MS);

  try {
    await openUrl(authUrl.toString());

    while (completion.value === undefined) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const done = completion.value;
    if ("error" in done) {
      throw new Error("OAuth authorization did not complete");
    }

    const result = await exchangePkceAuthorizationCode(
      fetchFn,
      provider,
      clientId,
      redirectUri,
      codeVerifier,
      done.code,
      scopes,
    );

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

/**
 * Slack user-token refresh (`oauth.v2.access` with `grant_type=refresh_token`).
 * Persists merged tokens to `slack.oauth`.
 */
export async function refreshSlackUserToken(
  refreshToken: string,
  clientId: string,
  ctx: RefreshAccessTokenContext,
): Promise<PKCEResult> {
  const fetchFn: PKCEFetch = ctx.fetchImpl ?? ((i, init) => globalThis.fetch(i, init));
  const json = await slackOAuthV2Access(fetchFn, {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const result = pkceResultFromSlackOAuthV2Access(json, []);
  await persistTokens(ctx.vault, "slack", result);
  return result;
}

/**
 * Notion OAuth refresh (`/v1/oauth/token` with `grant_type=refresh_token`).
 * Persists merged tokens to `notion.oauth`.
 */
export async function refreshNotionToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  ctx: RefreshAccessTokenContext,
): Promise<PKCEResult> {
  const fetchFn: PKCEFetch = ctx.fetchImpl ?? ((i, init) => globalThis.fetch(i, init));
  const res = await fetchFn(NOTION_TOKEN, {
    method: "POST",
    headers: {
      Authorization: notionBasicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Notion refresh returned non-JSON");
  }
  if (!res.ok) {
    throw new Error("Notion token refresh failed");
  }
  const partial = pkceResultFromNotionTokenJson(parsed, [], true);
  const result: PKCEResult = {
    accessToken: partial.accessToken,
    refreshToken: partial.refreshToken !== "" ? partial.refreshToken : refreshToken,
    expiresAt: partial.expiresAt,
    scopes: partial.scopes,
  };
  await persistTokens(ctx.vault, "notion", result);
  return result;
}
