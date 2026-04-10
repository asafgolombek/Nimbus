import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";

import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { createJiraSyncable } from "./jira-sync.ts";

function stubVault(email: string, token: string, base: string): NimbusVault {
  return {
    set: async () => {},
    get: async (k: string) => {
      if (k === "jira.email") {
        return email;
      }
      if (k === "jira.api_token") {
        return token;
      }
      if (k === "jira.base_url") {
        return base;
      }
      return null;
    },
    delete: async () => {},
    listKeys: async () => [],
  };
}

describe("jira-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when credentials missing", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const sync = createJiraSyncable({ ensureJiraMcpRunning: async () => {} });
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
    expect(r.itemsDeleted).toBe(0);
    expect(r.cursor).toBeNull();
  });

  test("indexes issues from Jira search response and advances cursor", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      const u =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(u).toContain("example.atlassian.net/rest/api/3/search");
      const body =
        init?.body !== undefined && typeof init.body === "string" ? JSON.parse(init.body) : {};
      expect(body.jql).toContain("updated");
      return new Response(
        JSON.stringify({
          issues: [
            {
              id: "10001",
              key: "NIM-1",
              fields: {
                summary: "Ship Jira",
                description: { type: "doc", version: 1, content: [] },
                updated: "2026-04-01T12:00:00.000+0000",
              },
            },
          ],
          startAt: 0,
          maxResults: 50,
          total: 1,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const sync = createJiraSyncable({ ensureJiraMcpRunning: async () => {} });
    const ctx = {
      vault: stubVault("u@example.com", "tok", "https://example.atlassian.net"),
      db,
      logger: pino({ level: "silent" }),
      rateLimiter: new ProviderRateLimiter(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-jra1:");
    const row = db.prepare("SELECT COUNT(*) AS c FROM item WHERE service = ?").get("jira") as {
      c: number;
    };
    expect(row.c).toBe(1);
  });
});
