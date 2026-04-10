import { afterEach, describe, expect, test } from "bun:test";

import {
  createMemoryIndexDb,
  createStubVault,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";
import { createNotionSyncable } from "./notion-sync.ts";

describe("notion-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when notion.oauth missing", async () => {
    const db = createMemoryIndexDb();
    const sync = createNotionSyncable({ ensureNotionMcpRunning: async () => {} });
    const r = await sync.sync(
      { vault: EMPTY_NIMBUS_VAULT, db, ...silentSyncContextExtras() },
      null,
    );
    expect(r.itemsUpserted).toBe(0);
    expect(r.cursor).toBeNull();
  });

  test("indexes pages from Notion search and advances cursor", async () => {
    const db = createMemoryIndexDb();
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      const u = urlFromFetchInput(input);
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

    const oauthPayload = JSON.stringify({
      accessToken: "notion_secret_test",
      refreshToken: "refresh_test",
      expiresAt: Date.now() + 86_400_000,
      scopes: [] as string[],
    });
    const sync = createNotionSyncable({ ensureNotionMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "notion.oauth": oauthPayload }),
      db,
      ...silentSyncContextExtras(),
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
