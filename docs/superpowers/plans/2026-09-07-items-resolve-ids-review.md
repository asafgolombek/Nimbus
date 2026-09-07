# Implementation Plan Review: `GET /v1/items/resolve-ids`

**Date:** 2026-09-07  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Approved with Notes  
**Target Plan:** [`2026-09-07-items-resolve-ids.md`](file:///C:/gitrep/Nimbus/.claude/worktrees/items-resolve-ids/docs/superpowers/plans/2026-09-07-items-resolve-ids.md)  
**Design Spec:** [`../specs/2026-09-07-items-resolve-ids-design.md`](file:///C:/gitrep/Nimbus/.claude/worktrees/items-resolve-ids/docs/superpowers/specs/2026-09-07-items-resolve-ids-design.md)  

---

> **This is a review note, not guidance. Where it disagrees with the design
> spec, the spec wins.**
>
> Every recommendation here was adjudicated in
> [`../specs/2026-09-07-items-resolve-ids-design.md`](../specs/2026-09-07-items-resolve-ids-design.md)
> §11 and in the plan's own disposition section. Three were accepted, one was
> accepted with the fix inverted, and the rest are assessments. **Do not
> implement from this file.**
>
> Two disagreements are deliberate and worth naming, because a reader who copied
> the snippets below would ship the wrong behaviour:
>
> - **§2's SQL recommends `COALESCE(canonical_url, url)`** — canonical first.
>   The spec requires the opposite: the bare `url`, falling back to
>   `canonical_url` only when `url` is null, because the sibling route selects
>   the bare column and this response claims to be that projection.
> - **§2 offers `ORDER BY modified_at DESC, id ASC` as an alternative** to
>   `ORDER BY id`. The spec picks `ORDER BY id`, singular — two deterministic
>   orders are still two different wire responses.
>
> It is committed because this repo keeps review notes beside their specs, and
> it is pruned when the feature ships.

## 1. Summary of Review

The proposal and implementation plan for [`GET /v1/items/resolve-ids`](file:///C:/gitrep/Nimbus/.claude/worktrees/items-resolve-ids/docs/superpowers/plans/2026-09-07-items-resolve-ids.md) are clean, minimal, and fully compliant with gateway architectural and security invariants:

1. **Security & Scoping:** Reuses the existing `resolve` scope under bearer authentication; avoids public unauthenticated exposure; does not append to the egress ledger (pure local index read); enforces fail-closed behavior on missing or legacy scopes.
2. **Safe Disclosure Boundary:** Strict field-by-field projection (`id`, `service`, `type`, `title`, `url`, `modified_at`), preventing leakage of `body`, `metadata`, `author_id`, or `external_id`.
3. **URL Selection & Fallback Logic:** Selects `COALESCE(url, canonical_url) AS url`, prioritizing the bare `url` column (matching [`resolveItemByUrl`](file:///C:/gitrep/Nimbus/packages/gateway/src/index/resolve-by-url.ts#L58)) while falling back to `canonical_url` only when `url` is null to maximize linkability.
4. **Resilience & DoS Mitigation:** Bounded batching (`RESOLVE_IDS_MAX_BATCH = 100`) with raw query parameter counting before trimming/de-duplication, refusing over-cap requests (`400 too_many_ids`) rather than silently dropping links.

Below are specific technical nuances and recommendations to observe during implementation.

---

## 2. Critical Findings & Technical Corrections

### F2.1: SQLite Seed Schema in Unit Tests (`canonical_url` column)

- **Issue:** In Task 1 Step 1, the test setup notes:

  ```ts
  // Use the project's real schema application, exactly as resolve-by-url.test.ts does —
  // a hand-written CREATE TABLE here would drift from the migrations.
  applySchema(db); // replace with whatever resolve-by-url.test.ts calls
  ```

- **Context:** [`packages/gateway/src/index/resolve-by-url.test.ts`](file:///C:/gitrep/Nimbus/packages/gateway/src/index/resolve-by-url.test.ts#L7-L8) uses a lightweight custom DDL:

  ```ts
  db.exec(`CREATE TABLE item (id TEXT PRIMARY KEY, service TEXT, type TEXT, title TEXT,
    url TEXT, resolve_key TEXT, modified_at INTEGER)`);
  ```

  Note that `resolve-by-url.test.ts` did not declare `canonical_url`.
- **Correction:** Because `resolveItemsByIds` executes `SELECT id, service, type, title, COALESCE(url, canonical_url) AS url, modified_at FROM item`, copying `resolve-by-url.test.ts`'s DDL verbatim will cause SQLite to fail with `no such column: canonical_url`.
- **Fix:** In `resolve-ids.test.ts`, ensure the in-memory test table explicitly includes `canonical_url TEXT`, or import [`UNIFIED_ITEM_V3_SCHEMA_SQL`](file:///C:/gitrep/Nimbus/packages/gateway/src/index/unified-item-v3-sql.ts#L16-L31) from `packages/gateway/src/index/unified-item-v3-sql.ts`.

---

### F2.2: Test Scanner Ordering Coupling in Task 2 vs Task 3

- **Context:** [`packages/gateway/src/ipc/http-route-auth.test.ts`](file:///C:/gitrep/Nimbus/packages/gateway/src/ipc/http-route-auth.test.ts#L101-L114) includes the anti-stale test:

  ```ts
  test("no table entry is a route that no longer exists", async () => { ... });
  ```

  This scanner checks that every entry in `HTTP_ROUTE_AUTH` matches a string literal in [`http-server.ts`](file:///C:/gitrep/Nimbus/packages/gateway/src/ipc/http-server.ts).
- **Observation:** Adding `[ROUTE_KEY_ITEMS_RESOLVE_IDS]: { kind: "clip", scope: "resolve" }` in Task 2 *before* mounting `if (url.pathname === "/v1/items/resolve-ids")` in Task 3 will cause `http-route-auth.test.ts` to fail because the route literal is not yet found in `http-server.ts`.
- **Guidance:** Task 2 and Task 3 are closely coupled by design. Implementers should combine Task 2 and Task 3 edits into a single logical step/commit to keep CI and pre-commit test runs cleanly green.

---

### F2.3: Two-Tier Batch Cap Enforcement

- **Assessment:** The plan employs a layered defense for the 100-item batch cap:
  1. **HTTP Layer ([`handleItemsResolveIds`](file:///C:/gitrep/Nimbus/packages/gateway/src/ipc/http-server.ts)):** Inspects `url.searchParams.getAll("id").length > RESOLVE_IDS_MAX_BATCH` immediately, protecting the server against expensive parameter parsing and set construction when flooded with duplicate parameters.
  2. **Lookup Layer ([`resolveItemsByIds`](file:///C:/gitrep/Nimbus/packages/gateway/src/index/resolve-ids.ts)):** Asserts `unique.length > RESOLVE_IDS_MAX_BATCH`, preventing unbounded dynamic parameter lists in SQLite queries.
- **Verdict:** This separation of concerns is robust and prevents algorithmic complexity attacks on the query parser.

---

## 3. Improvements & Observations

### S2.1: Parity Unit Tests in `http-route-auth.test.ts`

- **Suggestion:** In [`packages/gateway/src/ipc/http-route-auth.test.ts`](file:///C:/gitrep/Nimbus/packages/gateway/src/ipc/http-route-auth.test.ts), add explicit scope assertions for `ROUTE_KEY_ITEMS_RESOLVE_IDS` alongside the existing tests for `ROUTE_KEY_ITEMS_RESOLVE`:

  ```ts
  test("the resolve-ids route requires the resolve scope", () => {
    expect(HTTP_ROUTE_AUTH[ROUTE_KEY_ITEMS_RESOLVE_IDS]).toEqual({ kind: "clip", scope: "resolve" });
    expect(clipScopeFor(ROUTE_KEY_ITEMS_RESOLVE_IDS)).toBe("resolve");
  });
  ```

### S2.2: Egress Ledger Delta Assertion in Integration Tests

- **Assessment:** Task 4 Step 1 specifies testing that the route appends no egress ledger rows:

  ```ts
  const ledgerRows = (): number =>
    (db.query("SELECT COUNT(*) AS n FROM egress_ledger").get() as { n: number }).n;
  const before = ledgerRows();
  await fetch(...);
  expect(ledgerRows()).toBe(before);
  ```

- **Note:** Checking the delta across the request rather than `=== 0` avoids flakiness if boot-time markers or background migrations append ledger records. This matches the convention established in [`items-resolve-file-route.test.ts:335`](file:///C:/gitrep/Nimbus/packages/gateway/test/integration/http/items-resolve-file-route.test.ts#L335).

---

## 4. Summary of Recommended Plan Actions

1. In Task 1 Step 1, explicitly specify `canonical_url TEXT` in the test database schema definition.
2. Note that Tasks 2 and 3 should be tested and committed together to satisfy `http-route-auth.test.ts`'s route literal scanner.
3. Proceed with implementation as outlined.
