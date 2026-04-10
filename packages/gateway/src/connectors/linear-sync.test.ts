import { afterEach, describe, expect, test } from "bun:test";

import {
  createMemoryIndexDb,
  createStubVault,
  silentSyncContextExtras,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";
import { createLinearSyncable } from "./linear-sync.ts";

describe("linear-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when API key missing", async () => {
    const db = createMemoryIndexDb();
    const sync = createLinearSyncable({ ensureLinearMcpRunning: async () => {} });
    const r = await sync.sync(
      {
        vault: createStubVault({ "linear.api_key": null }),
        db,
        ...silentSyncContextExtras(),
      },
      null,
    );
    expect(r.itemsUpserted).toBe(0);
    expect(r.itemsDeleted).toBe(0);
    expect(r.cursor).toBeNull();
  });

  test("indexes issues from GraphQL response and advances cursor", async () => {
    const db = createMemoryIndexDb();
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      const u = urlFromFetchInput(input);
      expect(u).toContain("api.linear.app/graphql");
      const body =
        init?.body !== undefined && typeof init.body === "string" ? JSON.parse(init.body) : {};
      expect(body.query).toContain("issues(");
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: "uuid-1",
                  identifier: "NIM-1",
                  title: "Ship Linear",
                  description: "Connector",
                  updatedAt: "2026-04-01T12:00:00.000Z",
                  url: "https://linear.example/NIM-1",
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const sync = createLinearSyncable({ ensureLinearMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "linear.api_key": "lin_api_test" }),
      db,
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-lnr1:");
    const row = db.prepare("SELECT COUNT(*) AS c FROM item WHERE service = ?").get("linear") as {
      c: number;
    };
    expect(row.c).toBe(1);
  });
});
