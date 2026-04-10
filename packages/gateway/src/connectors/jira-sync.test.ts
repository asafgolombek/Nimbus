import { afterEach, describe, expect, test } from "bun:test";

import {
  createMemoryIndexDb,
  createStubVault,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";
import { createJiraSyncable } from "./jira-sync.ts";

describe("jira-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when credentials missing", async () => {
    const db = createMemoryIndexDb();
    const sync = createJiraSyncable({ ensureJiraMcpRunning: async () => {} });
    const r = await sync.sync(
      { vault: EMPTY_NIMBUS_VAULT, db, ...silentSyncContextExtras() },
      null,
    );
    expect(r.itemsUpserted).toBe(0);
    expect(r.itemsDeleted).toBe(0);
    expect(r.cursor).toBeNull();
  });

  test("indexes issues from Jira search response and advances cursor", async () => {
    const db = createMemoryIndexDb();
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      const u = urlFromFetchInput(input);
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
      vault: createStubVault({
        "jira.email": "u@example.com",
        "jira.api_token": "tok",
        "jira.base_url": "https://example.atlassian.net",
      }),
      db,
      ...silentSyncContextExtras(),
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
