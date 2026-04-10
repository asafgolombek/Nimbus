import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";

import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { createGitlabSyncable } from "./gitlab-sync.ts";

function stubVault(pat: string | null, apiBase: string | null = null): NimbusVault {
  return {
    set: async () => {},
    get: async (key: string) => {
      if (key === "gitlab.pat") {
        return pat;
      }
      if (key === "gitlab.api_base") {
        return apiBase;
      }
      return null;
    },
    delete: async () => {},
    listKeys: async () => [],
  };
}

describe("gitlab-sync", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("no-op when PAT missing", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const sync = createGitlabSyncable({ ensureGitlabMcpRunning: async () => {} });
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

  test("indexes MergeRequest event and returns cursor", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
      const u =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(u).toContain("gitlab.com/api/v4/events");
      expect(u).toContain("after=");
      expect(init?.headers).toBeDefined();
      const h = new Headers(
        init?.headers !== undefined && init?.headers !== null ? init.headers : undefined,
      );
      expect(h.get("PRIVATE-TOKEN")).toBe("glpat_test");
      return new Response(
        JSON.stringify([
          {
            id: 101,
            project_id: 1,
            action_name: "opened",
            target_id: 9,
            target_iid: 4,
            target_type: "MergeRequest",
            target_title: "Add feature",
            created_at: "2026-04-01T12:00:00.000Z",
            project: { path_with_namespace: "acme/app" },
          },
        ]),
        {
          status: 200,
          headers: {},
        },
      );
    }) as typeof fetch;

    const sync = createGitlabSyncable({ ensureGitlabMcpRunning: async () => {} });
    const ctx = {
      vault: stubVault("glpat_test"),
      db,
      logger: pino({ level: "silent" }),
      rateLimiter: new ProviderRateLimiter(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-glab1:");
    const row = db.prepare("SELECT COUNT(*) AS c FROM item WHERE service = ?").get("gitlab") as {
      c: number;
    };
    expect(row.c).toBe(1);
  });

  test("uses custom api base from vault", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0]): Promise<Response> => {
      const u =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(u).toContain("git.example.com/api/v4/events");
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const sync = createGitlabSyncable({ ensureGitlabMcpRunning: async () => {} });
    await sync.sync(
      {
        vault: stubVault("glpat_x", "https://git.example.com/api/v4"),
        db,
        logger: pino({ level: "silent" }),
        rateLimiter: new ProviderRateLimiter(),
      },
      null,
    );
  });
});
