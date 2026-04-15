import { expect, test } from "bun:test";

import { RateLimitError, UnauthenticatedError } from "../sync/types.ts";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  expectServiceItemCount,
  type SyncTestFetchParams,
  silentSyncContextExtras,
  testConnectorSyncNoop,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";
import { createGithubSyncable } from "./github-sync.ts";

describeWithFetchRestore("github-sync", () => {
  testConnectorSyncNoop(
    "no-op when PAT missing",
    () => createGithubSyncable({ ensureGithubMcpRunning: async () => {} }),
    createStubVault({ "github.pat": null }),
  );

  test("indexes PullRequestEvent and stores cursor with etag", async () => {
    const db = createMemoryIndexDb();
    globalThis.fetch = (async (
      input: SyncTestFetchParams[0],
      init?: SyncTestFetchParams[1],
    ): Promise<Response> => {
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
    expectServiceItemCount(db, "github", 1);
  });

  test("304 uses If-None-Match and returns zero upserts", async () => {
    const db = createMemoryIndexDb();
    let calls = 0;
    globalThis.fetch = (async (
      input: SyncTestFetchParams[0],
      init?: SyncTestFetchParams[1],
    ): Promise<Response> => {
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

  test("401 throws UnauthenticatedError", async () => {
    const db = createMemoryIndexDb();
    globalThis.fetch = (async () =>
      new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;

    const sync = createGithubSyncable({ ensureGithubMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "github.pat": "ghp_x" }),
      db,
      ...silentSyncContextExtras(),
    };
    await expect(sync.sync(ctx, null)).rejects.toThrow(UnauthenticatedError);
  });

  test("403 with exhausted quota throws RateLimitError honoring Retry-After seconds", async () => {
    const db = createMemoryIndexDb();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "rate limit" }), {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "retry-after": "90",
        },
      })) as unknown as typeof fetch;

    const sync = createGithubSyncable({ ensureGithubMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "github.pat": "ghp_x" }),
      db,
      ...silentSyncContextExtras(),
    };
    try {
      await sync.sync(ctx, null);
      expect.unreachable();
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(RateLimitError);
      const rl = e as RateLimitError;
      const delta = rl.retryAfter.getTime() - Date.now();
      expect(delta).toBeGreaterThanOrEqual(90_000 - 200);
      expect(delta).toBeLessThanOrEqual(90_000 + 200);
    }
  });
});
