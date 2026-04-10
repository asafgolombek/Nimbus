import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";

import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { createLinearSyncable } from "./linear-sync.ts";

function stubVault(key: string | null): NimbusVault {
  return {
    set: async () => {},
    get: async (k: string) => (k === "linear.api_key" ? key : null),
    delete: async () => {},
    listKeys: async () => [],
  };
}

describe("linear-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when API key missing", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const sync = createLinearSyncable({ ensureLinearMcpRunning: async () => {} });
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

  test("indexes issues from GraphQL response and advances cursor", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      const u =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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
      vault: stubVault("lin_api_test"),
      db,
      logger: pino({ level: "silent" }),
      rateLimiter: new ProviderRateLimiter(),
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
