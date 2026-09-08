/**
 * End-to-end tests for `GET /v1/items/resolve-ids` — the reverse lookup a client uses to turn the
 * item ids inside an agent brief into links. Sibling of `items-resolve-route.test.ts`: same
 * harness, same inline-bearer-read seam, same `resolve` scope.
 */

import { describe, expect, test } from "bun:test";
import { LEGACY_SCOPES } from "../../../src/clips/api-scopes.ts";
import { upsertIndexedItem } from "../../../src/index/item-store.ts";
import { RESOLVE_IDS_MAX_BATCH } from "../../../src/index/resolve-ids.ts";
import {
  startServerWithClipToken,
  startServerWithoutClipsVault,
} from "../../../src/ipc/http-api-test-server.ts";

/**
 * Repeats `id=` once per value, matching the wire shape `?id=...&id=...` and the browser client's
 * own `URLSearchParams` serialisation — never a single comma-joined value.
 */
function idsQuery(ids: readonly string[]): string {
  const params = new URLSearchParams();
  for (const id of ids) params.append("id", id);
  return params.toString();
}

function get(port: number, token: string | undefined, query: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/v1/items/resolve-ids?${query}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

describe("GET /v1/items/resolve-ids (integration)", () => {
  test("resolves several ids in one call, returned in id order regardless of request order", async () => {
    const { port, token, db, stop } = await startServerWithClipToken(["resolve"]);
    try {
      upsertIndexedItem(db, {
        service: "jira",
        type: "issue",
        externalId: "PLAT-91",
        title: "Latency spike",
        url: "https://jira.example.test/browse/PLAT-91",
        modifiedAt: 2_000,
        syncedAt: 2_000,
      });
      upsertIndexedItem(db, {
        service: "github",
        type: "pull_request",
        externalId: "web#482",
        title: "Rewrite the auth middleware",
        url: "https://github.com/acme/web/pull/482",
        modifiedAt: 1_000,
        syncedAt: 1_000,
      });
      // Requested in the OPPOSITE order from the ids' own sort order, so a response that merely
      // echoed request order would fail this.
      const res = await get(port, token, idsQuery(["jira:PLAT-91", "github:web#482"]));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items).toEqual([
        {
          id: "github:web#482",
          service: "github",
          type: "pull_request",
          title: "Rewrite the auth middleware",
          url: "https://github.com/acme/web/pull/482",
          modified_at: 1_000,
        },
        {
          id: "jira:PLAT-91",
          service: "jira",
          type: "issue",
          title: "Latency spike",
          url: "https://jira.example.test/browse/PLAT-91",
          modified_at: 2_000,
        },
      ]);
    } finally {
      stop();
    }
  });

  test("omits an id the index does not hold, rather than erroring or returning a null entry", async () => {
    const { port, token, db, stop } = await startServerWithClipToken(["resolve"]);
    try {
      upsertIndexedItem(db, {
        service: "github",
        type: "pull_request",
        externalId: "web#482",
        title: "Rewrite the auth middleware",
        url: "https://github.com/acme/web/pull/482",
        modifiedAt: 1_000,
        syncedAt: 1_000,
      });
      const res = await get(port, token, idsQuery(["github:web#482", "github:web#does-not-exist"]));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.id).toBe("github:web#482");
    } finally {
      stop();
    }
  });

  // Distinct from the case above: this row IS indexed, and its absent source URL must survive as
  // `url: null`, not cause the row to be dropped. "Not indexed" and "indexed with no source URL"
  // are different facts the client renders differently.
  test("url is nullable and a row is never omitted because its url is null", async () => {
    const { port, token, db, stop } = await startServerWithClipToken(["resolve"]);
    try {
      upsertIndexedItem(db, {
        service: "nimbus",
        type: "research_brief",
        externalId: "brief-7",
        title: "A saved brief",
        modifiedAt: 3_000,
        syncedAt: 3_000,
        // No url and no canonicalUrl: this item genuinely has neither.
      });
      const res = await get(
        port,
        token,
        idsQuery(["nimbus:brief-7", "nimbus:also-does-not-exist"]),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string; url: unknown }> };
      // Exactly one row: the indexed-but-url-less one, not the unindexed one — proving `url: null`
      // and "absent from the response" are kept as two different facts.
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ id: "nimbus:brief-7", url: null });
    } finally {
      stop();
    }
  });

  test("discloses exactly six fields", async () => {
    const { port, token, db, stop } = await startServerWithClipToken(["resolve"]);
    try {
      upsertIndexedItem(db, {
        service: "github",
        type: "pull_request",
        externalId: "web#482",
        title: "Rewrite the auth middleware",
        url: "https://github.com/acme/web/pull/482",
        modifiedAt: 1_000,
        syncedAt: 1_000,
      });
      const res = await get(port, token, idsQuery(["github:web#482"]));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<Record<string, unknown>> };
      // The disclosure guard. A column added to `item` later cannot reach the wire unnamed.
      expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
        "id",
        "modified_at",
        "service",
        "title",
        "type",
        "url",
      ]);
    } finally {
      stop();
    }
  });

  test("400 missing_id when no id parameter is given", async () => {
    const { port, token, stop } = await startServerWithClipToken(["resolve"]);
    try {
      const res = await get(port, token, "");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "missing_id" });
    } finally {
      stop();
    }
  });

  test("400 missing_id when every id parameter is blank", async () => {
    const { port, token, stop } = await startServerWithClipToken(["resolve"]);
    try {
      const res = await get(port, token, idsQuery(["", "   "]));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "missing_id" });
    } finally {
      stop();
    }
  });

  test("400 too_many_ids above the cap", async () => {
    const { port, token, stop } = await startServerWithClipToken(["resolve"]);
    try {
      // RESOLVE_IDS_MAX_BATCH + 1 DISTINCT ids.
      const ids = Array.from({ length: RESOLVE_IDS_MAX_BATCH + 1 }, (_, i) => `x:${i}`);
      const res = await get(port, token, idsQuery(ids));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "too_many_ids" });
    } finally {
      stop();
    }
  });

  // THE test that matters most: the route counts raw `?id=` parameters BEFORE de-duplicating.
  // De-duplicating first would let 101 copies of one id through with a one-row answer — an
  // earlier draft of this route had that ordering backwards.
  test("400 too_many_ids on 101 copies of a single id", async () => {
    const { port, token, stop } = await startServerWithClipToken(["resolve"]);
    try {
      const ids = Array.from({ length: RESOLVE_IDS_MAX_BATCH + 1 }, () => "github:web#482");
      const res = await get(port, token, idsQuery(ids));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "too_many_ids" });
    } finally {
      stop();
    }
  });

  test("401s an unknown token", async () => {
    const { port, stop } = await startServerWithClipToken(["resolve"]);
    try {
      const res = await get(port, "not-a-real-token", idsQuery(["github:web#482"]));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    } finally {
      stop();
    }
  });

  // Distinct from the bad-token case above: no header at all takes `bearerToken`'s own
  // "absent or wrong scheme" branch, returning undefined before `verifyApiToken` is ever called.
  test("401s a request with no Authorization header at all", async () => {
    const { port, stop } = await startServerWithClipToken(["resolve"]);
    try {
      const res = await get(port, undefined, idsQuery(["github:web#482"]));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    } finally {
      stop();
    }
  });

  // A browser paired before scopes existed holds LEGACY_SCOPES. Imported rather than hardcoded so
  // this test stays honest if the constant changes, matching `items-resolve-file-route.test.ts`'s
  // own use of it.
  test("403s a legacy-scoped token, naming the gap", async () => {
    const { port, token, stop } = await startServerWithClipToken(LEGACY_SCOPES);
    try {
      const res = await get(port, token, idsQuery(["github:web#482"]));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "insufficient_scope",
        required: "resolve",
        granted: LEGACY_SCOPES,
      });
    } finally {
      stop();
    }
  });

  test("404s resolve_disabled when the clips surface is not mounted", async () => {
    const { port, stop } = await startServerWithoutClipsVault();
    try {
      const res = await get(port, undefined, idsQuery(["github:web#482"]));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "resolve_disabled" });
    } finally {
      stop();
    }
  });

  // The capability-signal ordering: an unmounted server answers 404 even for a BAD token, never
  // 401/403. A client reads 404 as "gateway older than this route" and withholds its links
  // silently; a 401 here would turn a quiet degradation into a visible error.
  test("404 fires before the auth check on an unmounted server", async () => {
    const { port, stop } = await startServerWithoutClipsVault();
    try {
      const res = await get(port, "not-a-real-token", idsQuery(["github:web#482"]));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "resolve_disabled" });
    } finally {
      stop();
    }
  });

  // Nothing leaves the machine, so nothing belongs in the ledger of what did. Asserted as a DELTA
  // rather than `=== 0`: what must hold is that RESOLVING appends nothing, and a test pinned to an
  // empty table would start failing for an unrelated row the server wrote at boot.
  test("appends no egress row", async () => {
    const { port, token, db, stop } = await startServerWithClipToken(["resolve"]);
    try {
      upsertIndexedItem(db, {
        service: "github",
        type: "pull_request",
        externalId: "web#482",
        title: "Rewrite the auth middleware",
        url: "https://github.com/acme/web/pull/482",
        modifiedAt: 1_000,
        syncedAt: 1_000,
      });
      const ledgerRows = (): number =>
        (db.query("SELECT COUNT(*) AS n FROM egress_ledger").get() as { n: number }).n;
      const before = ledgerRows();
      const res = await get(port, token, idsQuery(["github:web#482"]));
      expect(res.status).toBe(200);
      expect(ledgerRows()).toBe(before);
    } finally {
      stop();
    }
  });
});
