import { afterEach, describe, expect, test } from "bun:test";

import {
  createMemoryIndexDb,
  createStubVault,
  silentSyncContextExtras,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";
import { createGithubSyncable } from "./github-sync.ts";

describe("github-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when PAT missing", async () => {
    const db = createMemoryIndexDb();
    const sync = createGithubSyncable({ ensureGithubMcpRunning: async () => {} });
    const r = await sync.sync(
      {
        vault: createStubVault({ "github.pat": null }),
        db,
        ...silentSyncContextExtras(),
      },
      null,
    );
    expect(r.itemsUpserted).toBe(0);
    expect(r.itemsDeleted).toBe(0);
    expect(r.cursor).toBeNull();
  });

  test("indexes PullRequestEvent and stores cursor with etag", async () => {
    const db = createMemoryIndexDb();
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      const u = urlFromFetchInput(input);
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
      vault: createStubVault({ "github.pat": "ghp_test" }),
      db,
      ...silentSyncContextExtras(),
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
    const db = createMemoryIndexDb();
    let calls = 0;
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      calls += 1;
      const u = urlFromFetchInput(input);
      expect(u).toContain("api.github.com/user/events");
      if (calls === 1) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { etag: '"abc"' },
        });
      }
      const headersInit = init?.headers;
      const h = new Headers(headersInit ?? undefined);
      expect(h.get("If-None-Match")).toBe('"abc"');
      return new Response("", { status: 304 });
    }) as typeof fetch;

    const sync = createGithubSyncable({ ensureGithubMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "github.pat": "ghp_x" }),
      db,
      ...silentSyncContextExtras(),
    };
    const first = await sync.sync(ctx, null);
    expect(first.cursor).toContain("nimbus-ghub1:");
    const second = await sync.sync(ctx, first.cursor);
    expect(second.itemsUpserted).toBe(0);
    expect(second.cursor).toBe(first.cursor);
    expect(calls).toBe(2);
  });
});
