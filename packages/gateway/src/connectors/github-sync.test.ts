import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";

import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { createGithubSyncable } from "./github-sync.ts";

function stubVault(pat: string | null): NimbusVault {
  return {
    set: async () => {},
    get: async (key: string) => (key === "github.pat" ? pat : null),
    delete: async () => {},
    listKeys: async () => [],
  };
}

describe("github-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when PAT missing", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const sync = createGithubSyncable({ ensureGithubMcpRunning: async () => {} });
    const r = await sync.sync(
      {
        vault: stubVault(null),
        db,
        logger: pino({ level: "silent" }),
        rateLimiter: new ProviderRateLimiter(),
      },
      null,
    );
    expect(r.itemsUpserted).toBe(0);
    expect(r.itemsDeleted).toBe(0);
    expect(r.cursor).toBeNull();
  });

  test("indexes PullRequestEvent and stores cursor with etag", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      const u =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(u).toContain("api.github.com/user/events");
      expect(init?.headers).toBeDefined();
      return new Response(
        JSON.stringify([
          {
            id: "e1",
            type: "PullRequestEvent",
            repo: { full_name: "nimbus/repo" },
            payload: {
              pull_request: {
                number: 9,
                title: "Fix sync",
                html_url: "https://github.com/nimbus/repo/pull/9",
                updated_at: "2026-04-01T12:00:00Z",
                state: "open",
                user: { login: "alice" },
              },
            },
          },
        ]),
        {
          status: 200,
          headers: { etag: '"w1"' },
        },
      );
    }) as typeof fetch;

    const sync = createGithubSyncable({ ensureGithubMcpRunning: async () => {} });
    const ctx = {
      vault: stubVault("ghp_test"),
      db,
      logger: pino({ level: "silent" }),
      rateLimiter: new ProviderRateLimiter(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-ghub1:");
    const row = db.prepare("SELECT COUNT(*) AS c FROM item WHERE service = ?").get("github") as {
      c: number;
    };
    expect(row.c).toBe(1);
  });

  test("304 uses If-None-Match and returns zero upserts", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    let calls = 0;
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      calls += 1;
      const u =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(u).toContain("api.github.com/user/events");
      if (calls === 1) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { etag: '"abc"' },
        });
      }
      const headersInit = init?.headers;
      const h = new Headers(
        headersInit !== undefined && headersInit !== null ? headersInit : undefined,
      );
      expect(h.get("If-None-Match")).toBe('"abc"');
      return new Response("", { status: 304 });
    }) as typeof fetch;

    const sync = createGithubSyncable({ ensureGithubMcpRunning: async () => {} });
    const ctx = {
      vault: stubVault("ghp_x"),
      db,
      logger: pino({ level: "silent" }),
      rateLimiter: new ProviderRateLimiter(),
    };
    const first = await sync.sync(ctx, null);
    expect(first.cursor).toContain("nimbus-ghub1:");
    const second = await sync.sync(ctx, first.cursor);
    expect(second.itemsUpserted).toBe(0);
    expect(second.cursor).toBe(first.cursor);
    expect(calls).toBe(2);
  });
});
