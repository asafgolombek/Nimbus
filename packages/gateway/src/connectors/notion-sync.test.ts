import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";

import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { createNotionSyncable } from "./notion-sync.ts";

function stubVault(access: string): NimbusVault {
  const payload = JSON.stringify({
    accessToken: access,
    refreshToken: "refresh_test",
    expiresAt: Date.now() + 86_400_000,
    scopes: [] as string[],
  });
  return {
    set: async () => {},
    get: async (k: string) => (k === "notion.oauth" ? payload : null),
    delete: async () => {},
    listKeys: async () => [],
  };
}

describe("notion-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when notion.oauth missing", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const sync = createNotionSyncable({ ensureNotionMcpRunning: async () => {} });
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

  test("indexes pages from Notion search and advances cursor", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      const u =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(u).toContain("api.notion.com/v1/search");
      const body =
        init?.body !== undefined && typeof init.body === "string" ? JSON.parse(init.body) : {};
      expect(body.filter?.value).toBe("page");
      return new Response(
        JSON.stringify({
          results: [
            {
              object: "page",
              id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
              last_edited_time: "2026-04-01T12:00:00.000Z",
              properties: {
                title: {
                  type: "title",
                  title: [{ type: "text", text: { content: "Hello" } }],
                },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const sync = createNotionSyncable({ ensureNotionMcpRunning: async () => {} });
    const ctx = {
      vault: stubVault("notion_secret_test"),
      db,
      logger: pino({ level: "silent" }),
      rateLimiter: new ProviderRateLimiter(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-ntn1:");
    const row = db.prepare("SELECT COUNT(*) AS c FROM item WHERE service = ?").get("notion") as {
      c: number;
    };
    expect(row.c).toBe(1);
  });
});
