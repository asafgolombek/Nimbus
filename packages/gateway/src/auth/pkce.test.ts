import { describe, expect, test } from "bun:test";

import {
  createMemoryVault,
  googlePkceOpenUrlCompleter,
  requestUrlString,
} from "../testing/bun-test-support.ts";
import { pkceCodeChallengeS256, refreshAccessToken, runPKCEFlow } from "./pkce.ts";

describe("pkceCodeChallengeS256", () => {
  test("matches SHA-256 base64url of verifier (RFC 7636)", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // example shape; URL-safe
    const challenge = await pkceCodeChallengeS256(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge.length).toBeGreaterThan(0);
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    let binary = "";
    for (const b of bytes) {
      binary += String.fromCodePoint(b);
    }
    const expected = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    expect(challenge).toBe(expected);
  });
});

describe("runPKCEFlow", () => {
  test("completes Google flow, persists vault JSON, no token in thrown errors on exchange failure", async () => {
    const vault = createMemoryVault();
    const secretAccess = "ACCESS_TOKEN_SECRET_VALUE";
    const secretRefresh = "REFRESH_TOKEN_SECRET_VALUE";

    const result = await runPKCEFlow({
      clientId: "test-client",
      scopes: ["openid", "email"],
      provider: "google",
      vault,
      openUrl: googlePkceOpenUrlCompleter("mock-auth-code", { expectAccountsHost: true }),
      fetchImpl: async (input) => {
        const s = requestUrlString(input);
        if (s.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({
              access_token: secretAccess,
              refresh_token: secretRefresh,
              expires_in: 3600,
              scope: "openid email",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    expect(result.accessToken).toBe(secretAccess);
    expect(result.refreshToken).toBe(secretRefresh);
    expect(result.scopes).toEqual(["openid", "email"]);

    const stored = await vault.get("google.oauth");
    expect(stored).toBeTruthy();
    expect(stored).toContain(secretAccess);
    expect(stored).toContain(secretRefresh);

    let threw = "";
    try {
      await runPKCEFlow({
        clientId: "test-client",
        scopes: ["openid"],
        provider: "google",
        vault,
        openUrl: googlePkceOpenUrlCompleter("code2", {
          missingParamsMessage: "expected redirect_uri and state",
          assertFetchOk: false,
        }),
        fetchImpl: async (_input) =>
          new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
      });
    } catch (e) {
      threw = String(e instanceof Error ? e.message : e);
    }
    expect(threw.length).toBeGreaterThan(0);
    expect(threw.includes(secretAccess)).toBe(false);
    expect(threw.includes(secretRefresh)).toBe(false);
  });

  test("invokes onRandomPortFallback when using ephemeral port after fixed port busy", async () => {
    const blocker = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("busy"),
    });
    const busyPort = blocker.port;
    if (busyPort === undefined) {
      throw new Error("expected blocker to bind a port");
    }

    let fallback = 0;
    const vault = createMemoryVault();

    try {
      await runPKCEFlow({
        clientId: "test-client",
        scopes: ["openid"],
        provider: "google",
        redirectPort: busyPort,
        vault,
        onRandomPortFallback: () => {
          fallback += 1;
        },
        openUrl: googlePkceOpenUrlCompleter("c", {
          missingParamsMessage: "expected redirect_uri and state",
          assertFetchOk: false,
        }),
        fetchImpl: async (input) => {
          const s = requestUrlString(input);
          if (s.includes("oauth2.googleapis.com/token")) {
            return new Response(
              JSON.stringify({
                access_token: "a",
                refresh_token: "r",
                expires_in: 60,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response("no", { status: 404 });
        },
      });
    } finally {
      blocker.stop();
    }

    expect(fallback).toBe(1);
  });

  test("completes Slack PKCE flow, persists slack.oauth (user token in authed_user)", async () => {
    const vault = createMemoryVault();
    const secretAccess = "xoxp-slack-access-test";
    const secretRefresh = "xoxe-slack-refresh-test";

    const result = await runPKCEFlow({
      clientId: "123.456",
      scopes: ["channels:read"],
      provider: "slack",
      vault,
      openUrl: googlePkceOpenUrlCompleter("slack-mock-code", {
        missingParamsMessage: "expected redirect_uri and state in Slack auth URL",
      }),
      fetchImpl: async (input) => {
        const s = requestUrlString(input);
        if (s.includes("slack.com/api/oauth.v2.access")) {
          return new Response(
            JSON.stringify({
              ok: true,
              authed_user: {
                access_token: secretAccess,
                refresh_token: secretRefresh,
                expires_in: 3600,
                scope: "channels:read",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    expect(result.accessToken).toBe(secretAccess);
    expect(result.refreshToken).toBe(secretRefresh);
    expect(result.scopes).toEqual(["channels:read"]);

    const stored = await vault.get("slack.oauth");
    expect(stored).toBeTruthy();
    expect(stored).toContain(secretAccess);
    expect(stored).toContain(secretRefresh);
  });
});

describe("refreshAccessToken", () => {
  test("writes merged refresh token to vault", async () => {
    const vault = createMemoryVault();
    const r = await refreshAccessToken("old-refresh", "microsoft", "cid", {
      vault,
      fetchImpl: async (_input) =>
        new Response(
          JSON.stringify({
            access_token: "new-access",
            expires_in: 120,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    expect(r.accessToken).toBe("new-access");
    expect(r.refreshToken).toBe("old-refresh");
    const raw = await vault.get("microsoft.oauth");
    expect(raw).toContain("new-access");
    expect(raw).toContain("old-refresh");
  });
});
