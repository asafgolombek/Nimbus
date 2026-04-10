import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";

import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { createConfluenceSyncable } from "./confluence-sync.ts";

function stubVault(email: string, token: string, base: string): NimbusVault {
  return {
    set: async () => {},
    get: async (k: string) => {
      if (k === "confluence.email") {
        return email;
      }
      if (k === "confluence.api_token") {
        return token;
      }
      if (k === "confluence.base_url") {
        return base;
      }
      return null;
    },
    delete: async () => {},
    listKeys: async () => [],
  };
}

describe("confluence-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when credentials missing", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const sync = createConfluenceSyncable({ ensureConfluenceMcpRunning: async () => {} });
    const emptyVault: NimbusVault = {
      set: async () => {},
      get: async () => null,
      delete: async () => {},
      listKeys: async () => [],
    };
    const r = await sync.sync(
      {
        vault: emptyVault,
        db,
        logger: pino({ level: "silent" }),
        rateLimiter: new ProviderRateLimiter(),
      },
      null,
    );
    expect(r.itemsUpserted).toBe(0);
    expect(r.cursor).toBeNull();
  });

  test("indexes pages from Confluence CQL search and advances cursor", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0]): Promise<Response> => {
      const u =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(u).toContain("example.atlassian.net/wiki/rest/api/content/search");
      expect(u).toContain("cql=");
      return new Response(
        JSON.stringify({
          results: [
            {
              type: "page",
              id: "12345",
              title: "Wiki Page",
              history: {
                lastUpdated: { when: "2026-04-01T12:00:00.000+0000" },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const sync = createConfluenceSyncable({ ensureConfluenceMcpRunning: async () => {} });
    const ctx = {
      vault: stubVault("u@example.com", "tok", "https://example.atlassian.net"),
      db,
      logger: pino({ level: "silent" }),
      rateLimiter: new ProviderRateLimiter(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-cfl1:");
    const row = db
      .prepare("SELECT COUNT(*) AS c FROM item WHERE service = ?")
      .get("confluence") as {
      c: number;
    };
    expect(row.c).toBe(1);
  });
});
