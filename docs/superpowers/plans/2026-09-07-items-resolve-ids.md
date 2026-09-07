# `GET /v1/items/resolve-ids` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is conditional on the contract being accepted.** The spec it
> implements is a proposal; the gateway owns the wire and may change the shape or
> decline it. Nothing here presumes approval — it exists so the cost of saying
> yes is visible alongside the ask, and so nobody has to re-derive the surface.

**Goal:** Serve one bearer-authed read that maps indexed item ids back to the references they came from, so a client holding an agent brief can turn an item id into a link.

**Architecture:** A pure lookup module beside `resolve-by-url.ts` doing one parameterised `IN (…)` query with an exact projection, plus a handler mounted inline in the bearer-authed GET family. No schema change, no new scope, no egress row, no OpenAPI entry.

**Tech Stack:** TypeScript strict, Bun, `bun:sqlite`, Biome, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-07-items-resolve-ids-design.md` — read §4 (contract), §5 (the three argued decisions), §6 (what this is not) and §8 (compliance) before starting.

## Global Constraints

- **`RESOLVE_IDS_MAX_BATCH = 100`.** Not 5 — that is `RESOLVE_CANDIDATE_CAP`, whose *rationale* this borrows and whose *magnitude* would refuse `catchup` on its ordinary path (`PER_SERVICE_QUOTA = 50` per service, `packages/gateway/src/agents/catchup.ts:12`).
- **Over the cap: refuse `400 { "error": "too_many_ids" }`.** Never clamp — silently dropping ids means silently dropping links.
- **Count RAW `?id=` parameters before de-duplicating.** A post-dedup check is cheap for a caller sending fifty thousand copies of one id and not for the gateway.
- **Response fields, exactly:** `id`, `service`, `type`, `title`, `url`, `modified_at`. Never `body`, `body_preview`, `metadata`, `author_id`, `external_id`, `synced_at`.
- **`url` selection:** the bare `url` column, matching `resolve-by-url.ts:58` — **except** fall back to `canonical_url` where `url` is null. This is the opposite precedence from `resolve_key`, deliberately (spec §4).
- **`url` stays nullable** all the way to the response. Never substitute, never omit the row because of it.
- **An unindexed id is ABSENT from `items`** — not an error, not a null entry. Absent and `url: null` are different facts.
- **404 `{ "error": "resolve_disabled" }` fires BEFORE the auth check** when the clips surface is unmounted. This is the capability signal a client probes; a 500 would turn a quiet degradation into a visible error.
- **Bind every id as a parameter.** Never interpolate into the `IN (…)` list.
- **No egress row.** No outbound request of any kind; no federation arm, now or later.
- **No `any`;** external data is `unknown` narrowed by a guard. Biome must pass with `--error-on-warnings`.

---

## File Structure

**Create:**

- `packages/gateway/src/index/resolve-ids.ts` — the lookup and its exact projection. Beside `resolve-by-url.ts` because it is the same kind of thing: a read over `item` that answers a resolution question, with no HTTP knowledge.
- `packages/gateway/src/index/resolve-ids.test.ts` — unit tests over a real in-memory database, matching how `resolve-by-url.test.ts` tests its sibling.
- `packages/gateway/test/integration/http/items-resolve-ids-route.test.ts` — the route's end-to-end tests, beside `items-resolve-route.test.ts` and `items-resolve-file-route.test.ts`.

**Modify:**

- `packages/gateway/src/ipc/http-route-auth.ts` — the route-key constant, the `HTTP_ROUTE_AUTH` entry, the `ClipReadRouteKey` union member (`:154-165`).
- `packages/gateway/src/ipc/http-server.ts` — the handler beside `handleItemsResolveFile` (`:672`), and one mount line in the bearer-authed GET dispatcher (`:1146-1148`).
- `packages/gateway/src/egress/egress-coverage.ts:80-88` — re-point the "newest of them" sentence.
- `docs/CHANGELOG.md`, `docs/architecture.md`.

**Not touched, deliberately:** no migration, no `HTTP_ROUTES` / OpenAPI entry, no `WRITE_ROUTE_ALLOWLIST` (this is a read), no new scope.

---

### Task 1: The lookup module

**Files:**

- Create: `packages/gateway/src/index/resolve-ids.ts`
- Test: `packages/gateway/src/index/resolve-ids.test.ts`

**Interfaces:**

- Consumes: `Database` from `bun:sqlite`; the `item` table.
- Produces: `RESOLVE_IDS_MAX_BATCH: 100`, `type ResolvedItemRef`, `resolveItemsByIds(db: Database, ids: readonly string[]): ResolvedItemRef[]`.

- [ ] **Step 1: Write the failing tests**

Read `packages/gateway/src/index/resolve-by-url.test.ts` first and reuse its database-seeding idiom rather than inventing one.

```ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { RESOLVE_IDS_MAX_BATCH, resolveItemsByIds } from "./resolve-ids.ts";

function seed(): Database {
  const db = new Database(":memory:");
  // Use the project's real schema application, exactly as resolve-by-url.test.ts does —
  // a hand-written CREATE TABLE here would drift from the migrations.
  applySchema(db); // replace with whatever resolve-by-url.test.ts calls
  const insert = (row: Record<string, unknown>) => { /* per that file's helper */ };
  insert({ id: "github:acme/web#1", service: "github", type: "pull_request",
           title: "Auth rewrite", url: "https://example.test/pr/1",
           canonical_url: null, modified_at: 1_700_000_000_000 });
  insert({ id: "jira:PLAT-9", service: "jira", type: "issue",
           title: "Latency", url: null, canonical_url: null,
           modified_at: 1_700_000_000_001 });
  insert({ id: "nimbus:brief-7", service: "nimbus", type: "research_brief",
           title: "A saved brief", url: null,
           canonical_url: "https://example.test/canon/7",
           modified_at: 1_700_000_000_002 });
  return db;
}

describe("resolveItemsByIds", () => {
  test("returns the exact six-field projection and nothing else", () => {
    const [row] = resolveItemsByIds(seed(), ["github:acme/web#1"]);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "id", "modified_at", "service", "title", "type", "url",
    ]);
    expect(row?.url).toBe("https://example.test/pr/1");
  });

  test("omits ids the index does not hold, without erroring", () => {
    const rows = resolveItemsByIds(seed(), ["github:acme/web#1", "github:nope#404"]);
    expect(rows.map((r) => r.id)).toEqual(["github:acme/web#1"]);
  });

  test("keeps url null when the row has neither url nor canonical_url", () => {
    const [row] = resolveItemsByIds(seed(), ["jira:PLAT-9"]);
    // Null must survive to the caller: the client renders the title as plain
    // text. Substituting anything here would fabricate a reference.
    expect(row?.url).toBeNull();
  });

  test("falls back to canonical_url only when url is null", () => {
    const [row] = resolveItemsByIds(seed(), ["nimbus:brief-7"]);
    expect(row?.url).toBe("https://example.test/canon/7");
  });

  test("prefers url over canonical_url when both exist", () => {
    const db = seed();
    db.query("UPDATE item SET canonical_url = ? WHERE id = ?")
      .run("https://example.test/canon/1", "github:acme/web#1");
    const [row] = resolveItemsByIds(db, ["github:acme/web#1"]);
    // The sibling route returns the bare `url` column; matching it matters more
    // than matching resolve_key's canonical-first derivation. Spec §4.
    expect(row?.url).toBe("https://example.test/pr/1");
  });

  test("de-duplicates repeated ids into one row", () => {
    const rows = resolveItemsByIds(seed(), ["jira:PLAT-9", "jira:PLAT-9", "jira:PLAT-9"]);
    expect(rows).toHaveLength(1);
  });

  test("returns an empty array for an empty id list", () => {
    expect(resolveItemsByIds(seed(), [])).toEqual([]);
  });

  test("orders deterministically by id", () => {
    const rows = resolveItemsByIds(seed(), ["nimbus:brief-7", "github:acme/web#1", "jira:PLAT-9"]);
    expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort());
  });

  test("throws above the batch cap rather than truncating", () => {
    const ids = Array.from({ length: RESOLVE_IDS_MAX_BATCH + 1 }, (_, i) => `x:${i}`);
    expect(() => resolveItemsByIds(seed(), ids)).toThrow();
  });

  test("treats an id containing SQL syntax as data, not as SQL", () => {
    const rows = resolveItemsByIds(seed(), ["github:acme/web#1'); DROP TABLE item; --"]);
    expect(rows).toEqual([]);
    // The table is still there.
    expect(resolveItemsByIds(seed(), ["jira:PLAT-9"])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test packages/gateway/src/index/resolve-ids.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
import type { Database } from "bun:sqlite";

/**
 * The most ids one call may name.
 *
 * `RESOLVE_CANDIDATE_CAP` (resolve-by-url.ts) is the precedent for HAVING a cap:
 * an uncapped list turns a `resolve`-scoped token into a bulk index read. Its
 * magnitude is not the precedent. That cap is 5, sized for a disambiguation menu
 * a human reads; this route answers a machine holding an agent brief, and
 * `catchup` alone admits PER_SERVICE_QUOTA = 50 items PER SERVICE across several
 * sections. A cap near 5 would refuse the largest consumer on its ordinary path.
 *
 * 100 clears a dense brief, sits three orders of magnitude under SQLite's
 * bind-parameter ceiling, and stays well inside any URL-length limit.
 */
export const RESOLVE_IDS_MAX_BATCH = 100;

/**
 * What a resolved id discloses: `ResolveCandidate` plus `modified_at`, which is
 * exactly what `GET /v1/items/resolve`'s `found` arm already returns. Never a
 * body, never `metadata`, never `author_id` — this is a resolver; reading is
 * `GET /v1/items/{id}`.
 */
export type ResolvedItemRef = {
  readonly id: string;
  readonly service: string;
  readonly type: string;
  readonly title: string;
  readonly url: string | null;
  readonly modified_at: number;
};

/**
 * Map item ids to their references. Ids the index does not hold are ABSENT from
 * the result — not null entries. "Not indexed" and "indexed with no source URL"
 * are different facts and a caller renders them differently.
 *
 * Throws above `RESOLVE_IDS_MAX_BATCH`; the HTTP layer turns that into a 400
 * rather than clamping, because silently dropping ids drops links.
 */
export function resolveItemsByIds(db: Database, ids: readonly string[]): ResolvedItemRef[] {
  const unique = [...new Set(ids)];
  if (unique.length > RESOLVE_IDS_MAX_BATCH) {
    throw new Error(`resolveItemsByIds: ${unique.length} ids exceeds ${RESOLVE_IDS_MAX_BATCH}`);
  }
  if (unique.length === 0) {
    return [];
  }
  const placeholders = unique.map(() => "?").join(", ");
  // `COALESCE(url, canonical_url)` — url FIRST. The sibling route selects the
  // bare `url` column, and this response claims to be that projection; the
  // fallback only fires where the sibling would have returned null anyway, so no
  // caller ever sees a different URL for the same row. This is deliberately the
  // opposite order from `resolve_key`, which is canonical-first because it
  // exists to make two spellings match rather than to be clicked.
  //
  // Every id is BOUND, never interpolated.
  const rows = db
    .query(
      `SELECT id, service, type, title, COALESCE(url, canonical_url) AS url, modified_at
         FROM item
        WHERE id IN (${placeholders})
        ORDER BY id`,
    )
    .all(...unique) as ResolvedItemRef[];
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/gateway/src/index/resolve-ids.test.ts && bun run lint && bun run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/index/resolve-ids.ts packages/gateway/src/index/resolve-ids.test.ts
git commit -m "feat(index): resolve item ids back to their references"
```

---

### Task 2: Route auth wiring

**Files:**

- Modify: `packages/gateway/src/ipc/http-route-auth.ts` (constants near `:22-23`, `HTTP_ROUTE_AUTH` near `:80`, `ClipReadRouteKey` at `:154-165`)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `ROUTE_KEY_ITEMS_RESOLVE_IDS = "GET /v1/items/resolve-ids"`, its `{ kind: "clip", scope: "resolve" }` entry, and its union member.

> **Three completeness tests enforce this**, so a route added without its table
> entry fails the suite rather than failing open. That is the point of doing this
> as its own task: it is the safety wiring, and it should be reviewable alone.

- [ ] **Step 1: Add the constant, the entry, and the union member**

Beside the existing route keys:

```ts
export const ROUTE_KEY_ITEMS_RESOLVE_IDS = "GET /v1/items/resolve-ids";
```

In `HTTP_ROUTE_AUTH`, beside `ROUTE_KEY_ITEMS_RESOLVE_FILE`:

```ts
  // Maps indexed item ids back to their references. Same `resolve` scope as the two reads
  // above and for the same reason: it reads, it runs nothing, and it appends NO egress row.
  [ROUTE_KEY_ITEMS_RESOLVE_IDS]: { kind: "clip", scope: "resolve" },
```

And in the union (`:154-165`), which exists so passing a raw request path to `enforceClipScope` is a compile error rather than a runtime fail-open:

```ts
  | typeof ROUTE_KEY_ITEMS_RESOLVE_IDS
```

- [ ] **Step 2: Run the route-auth suite**

Run: `bun test packages/gateway/src/ipc/http-route-auth.test.ts`
Expected: PASS. Note the scanner also fails if a table entry exists for a route no handler serves — so at this point the entry is present and Task 3 adds the literal it scans for. If the suite objects to an entry without a route, do Tasks 2 and 3 as one commit rather than fighting it, and say so in your report.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/ipc/http-route-auth.ts
git commit -m "feat(http): scope resolve-ids under the existing resolve scope"
```

---

### Task 3: The handler and its mount

**Files:**

- Modify: `packages/gateway/src/ipc/http-server.ts` (handler beside `handleItemsResolveFile` at `:672`; mount at `:1146-1148`)

**Interfaces:**

- Consumes: `resolveItemsByIds`, `RESOLVE_IDS_MAX_BATCH` (Task 1); `ROUTE_KEY_ITEMS_RESOLVE_IDS` (Task 2); the existing `requireScopedClipToken` and `json` helpers.
- Produces: the served route.

- [ ] **Step 1: Add the handler**

Mirror `handleItemsResolveFile` (`:672`) closely — it is the newest sibling and the shape reviewers expect:

```ts
async function handleItemsResolveIds(
  req: Request,
  url: URL,
  db: Database,
  opts: ReadOnlyHttpServerOptions,
): Promise<Response> {
  const clipsVault = opts.clipsVault;
  if (clipsVault === undefined) {
    // Before the auth check, and load-bearing: a client reads this 404 as "gateway older than
    // the route" and withholds its links silently. A 500 would turn a correct, quiet
    // degradation into a visible error on every gateway that does not mount the clips surface.
    return json({ error: "resolve_disabled" }, 404);
  }
  const auth = await requireScopedClipToken(req, clipsVault, ROUTE_KEY_ITEMS_RESOLVE_IDS);
  if (!auth.ok) return auth.response;

  // RAW count first, before trimming and before de-duplicating: checking after the set is built
  // would let a caller send fifty thousand copies of one id and pay only the parse cost.
  const raw = url.searchParams.getAll("id");
  if (raw.length > RESOLVE_IDS_MAX_BATCH) {
    return json({ error: "too_many_ids" }, 400);
  }
  const ids = raw.map((id) => id.trim()).filter((id) => id !== "");
  if (ids.length === 0) {
    return json({ error: "missing_id" }, 400);
  }

  // Field by field, never a spread and never a destructured rest: `item` carries `body`,
  // `metadata` and `author_id`, and this route is reachable by any holder of a clip token. A
  // column added to the row type later cannot leak here unnamed.
  const items = resolveItemsByIds(db, ids).map((row) => ({
    id: row.id,
    service: row.service,
    type: row.type,
    title: row.title,
    url: row.url,
    modified_at: row.modified_at,
  }));
  return json({ items });
}
```

- [ ] **Step 2: Mount it inline in the bearer-authed GET dispatcher**

Beside the two existing resolve mounts (`:1146-1148`):

```ts
  if (url.pathname === "/v1/items/resolve-ids") {
    return await handleItemsResolveIds(req, url, db, opts);
  }
```

**A flat `url.pathname ===` comparison, not a regex** — `http-route-auth.test.ts` source-scans for route literals and separately pins the count of regex-routed GETs, so a regex form needs extra bookkeeping for nothing.

**Never in `dispatchReadOnlyDataGet`** — that table's `"/v1/items/*"` entry is `{ kind: "public" }` with no bearer gate, so routing through it would serve scoped output to any local process.

- [ ] **Step 3: Run the route-auth and server suites**

Run: `bun test packages/gateway/src/ipc/ && bun run typecheck && bun run lint`
Expected: PASS, including the three completeness tests.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/ipc/http-server.ts
git commit -m "feat(http): serve GET /v1/items/resolve-ids"
```

---

### Task 4: Route integration tests

**Files:**

- Create: `packages/gateway/test/integration/http/items-resolve-ids-route.test.ts`

**Interfaces:**

- Consumes: `startServerWithClipToken`, `startServerWithoutClipsVault` from `packages/gateway/src/ipc/http-api-test-server.ts`; `LEGACY_SCOPES` from `packages/gateway/src/clips/api-scopes.ts`.

- [ ] **Step 1: Write the tests**

Read `items-resolve-file-route.test.ts` first and match its harness use and header-comment style.

```ts
/**
 * End-to-end tests for `GET /v1/items/resolve-ids` — the reverse lookup a client uses to turn the
 * item ids inside an agent brief into links. Sibling of `items-resolve-route.test.ts`: same
 * harness, same inline-bearer-read seam, same `resolve` scope.
 */
```

Cover, at minimum:

```ts
test("resolves several ids in one call", /* 200, items in id order */);
test("omits an id the index does not hold", /* the known one comes back, the unknown does not */);
test("discloses exactly six fields", () => {
  // The disclosure guard. A column added to `item` later cannot reach the wire unnamed.
  expect(Object.keys(body.items[0]).sort()).toEqual([
    "id", "modified_at", "service", "title", "type", "url",
  ]);
});
test("400 missing_id when no id parameter is given", /* also: only blank ids */);
test("400 too_many_ids above the cap", /* RESOLVE_IDS_MAX_BATCH + 1 raw params */);
test("403 for a token without the resolve scope", /* LEGACY_SCOPES */);
test("404 resolve_disabled when the clips surface is unmounted", /* startServerWithoutClipsVault */);
test("404 fires before auth", /* unmounted server + a bad token still 404s, not 401 */);
test("appends no egress row", () => {
  // A COUNT delta across the call, not an inspection — the claim is "this route never appends",
  // and only a delta actually tests it.
});
```

- [ ] **Step 2: Run them**

Run: `bun test packages/gateway/test/integration/http/items-resolve-ids-route.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/test/integration/http/items-resolve-ids-route.test.ts
git commit -m "test(http): pin resolve-ids' disclosure, caps and capability signal"
```

---

### Task 5: Documentation

**Files:**

- Modify: `packages/gateway/src/egress/egress-coverage.ts:80-88`, `docs/CHANGELOG.md`, `docs/architecture.md`

- [ ] **Step 1: Re-point the egress-coverage comment**

That comment names `GET /v1/items/resolve-file` as "the newest of them and the one most likely to be mistaken for egress". `resolve-ids` is now the newest. Add it to the list of reads that hand index rows to a local process and append **no** row, and move the "newest" sentence — it takes item ids from an external caller and answers entirely from the local index, with no outbound request at all.

- [ ] **Step 2: Add the changelog entry**

`docs/CHANGELOG.md`, matching the surrounding entries' voice. State the three things a reader needs: it is `resolve`-scoped so no re-pairing is needed; route presence is the capability signal so there is no version floor; and an id the index does not hold is absent from the response rather than null.

- [ ] **Step 3: Note the route in the architecture doc**

Wherever `docs/architecture.md` describes the clip-scoped read surface, add this route beside `resolve` and `resolve-file` — including that it is the only one of the three that takes a *list*, and the cap that bounds it.

- [ ] **Step 4: Run the docs gates**

Run: `bun run lint:markdown && bun run audit:doc-refs`
Expected: both clean. **These are the gates most likely to fail a docs-only change** — markdownlint enforces labelled fences and blank lines around headings and lists, and the doc-reference audit requires every cited path to resolve.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/egress/egress-coverage.ts docs/CHANGELOG.md docs/architecture.md
git commit -m "docs: record resolve-ids as a local read that appends no egress"
```

---

## Self-Review

**Spec coverage.** §4's request shape → Task 3; its response and the six fields → Tasks 1, 3, 4. The URL-column divergence → Task 1's two dedicated tests. Absent-vs-null → Task 1 and Task 4. §4's error table → Task 3, each pinned in Task 4. §5's batching, cap, raw-count-first and ordering → Tasks 1 and 3, pinned in both suites. §5's flat-path and never-in-the-public-table rules → Task 3 Step 2. §6's "not egress" → Task 4's ledger delta and Task 5 Step 1. §7's rollout → Task 4's two 404 tests. §8's compliance list → Tasks 2, 3, 4.

**Deliberately absent:** no migration task (no schema change), no OpenAPI task (this route stays off `HTTP_ROUTES`, like every clip-scoped bearer read), no scope task (`resolve` already exists, so no re-pairing).

**Type consistency.** `resolveItemsByIds(db, ids)` returns `ResolvedItemRef[]` in Task 1 and is consumed under that name in Task 3. `RESOLVE_IDS_MAX_BATCH` is defined once in Task 1 and imported by Task 3 rather than re-declared. `ROUTE_KEY_ITEMS_RESOLVE_IDS` is introduced in Task 2 and used in Task 3. The six-field key set is written identically in Task 1's projection test and Task 4's disclosure guard.

**Known adjustments an implementer should expect.** Task 1's test seeding is written against `resolve-by-url.test.ts`'s helper, which must be read rather than assumed — the placeholder `applySchema`/`insert` names in Step 1 are explicitly marked to be replaced with whatever that file actually uses. Task 2 may not be independently green if the route-auth scanner rejects a table entry with no matching handler literal; the step says to fold Tasks 2 and 3 into one commit if so, rather than working around the scanner.
