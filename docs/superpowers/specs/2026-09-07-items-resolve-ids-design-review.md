# Design Review: `GET /v1/items/resolve-ids`

**Date:** 2026-09-07  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Review Complete  
**Target Spec:** [`2026-09-07-items-resolve-ids-design.md`](./2026-09-07-items-resolve-ids-design.md)  
**Slot:** HTTP Client Surfaces / Web Clipper (`nimbus-web-clipper` integration)  
**Related Routes:** `GET /v1/items/resolve`, `GET /v1/items/resolve-file`, `POST /v1/items/fetch`

---

## 1. Executive Summary

The target specification proposes a clean, necessary reverse-lookup endpoint (`GET /v1/items/resolve-ids`) to map indexed item IDs back to reference metadata (`id`, `service`, `type`, `title`, `url`, `modified_at`). This fills a critical capability gap for the browser client (`nimbus-web-clipper`), which currently renders dead-text titles for findings in four agent lanes (`expert`, `impact`, `catchup`, `why`).

Key strengths of the proposed design:

1. **Reduced Disclosure Security Posture (§ 3):** Requiring the `resolve` bearer scope and projecting only 6 metadata fields (excluding `body`, `metadata`, `author_id`, and `external_id`) provides strictly less disclosure than the existing unauthenticated `GET /v1/items/{id}` public route.
2. **Batched Arity (§ 5):** Supporting multi-ID resolution in a single round trip eliminates $N$ sequential HTTP polls on active agent views.
3. **Capability Signal via 404 (§ 7):** Treating route presence (404 on unmounted or older gateways) as the capability gate allows client-side graceful degradation without brittle version floors.
4. **Zero Egress & Zero Mutation (§ 6):** Pure read from local SQLite; appends no egress ledger rows and makes zero outbound network calls.

Below are architectural refinements, resolutions to open questions, and concrete implementation guidance.

---

## 2. Open Questions & Architectural Refinements

### Q2.1: Defining the Batch Cap Constant (`RESOLVE_IDS_MAX_BATCH`)

- **Context:**
  - § 5 proposes refusing requests with `400 { "error": "too_many_ids" }` when exceeding a cap, citing `RESOLVE_CANDIDATE_CAP` (5 in `resolve-by-url.ts`).
  - However, for reverse ID resolution, agent briefs regularly return 20 to 50 findings (e.g. `CatchupBrief` with `PER_SERVICE_QUOTA = 50`). A cap of 5 or 10 would cause legitimate agent brief resolutions to fail.
- **Recommendation:**
  - Define and export an explicit constant:

    ```ts
    export const RESOLVE_IDS_MAX_BATCH = 100;
    ```

  - `100` comfortably accommodates even dense briefs while remaining well within SQLite parameter binding limits (default `SQLITE_LIMIT_VARIABLE_NUMBER = 32766`) and HTTP URL query length ceilings.
  - If the client collects $>100$ IDs across multiple sections, the client should chunk requests in batches of $\le 100$.

---

### Q2.2: Parameter Parsing, Counting, and Query-String DoS Prevention

- **Context:**
  - In URL query parsing, a malicious or buggy client could submit thousands of repeated `?id=...` parameters, causing excessive CPU/memory consumption during string parsing and deduplication.
- **Recommendation:**
  - Extract IDs via `url.searchParams.getAll("id")`.
  - Validate bounds in three strict steps:
    1. **Raw Parameter Bound:** If `rawIds.length > RESOLVE_IDS_MAX_BATCH`, immediately refuse with `400 { "error": "too_many_ids" }`.
    2. **Blank Filter:** Trim IDs and discard empty strings (`id.trim() === ""`).
    3. **Missing ID Guard:** If filtered array is empty, refuse with `400 { "error": "missing_id" }`.
    4. **Deduplication:** Convert to unique set (`[...new Set(filteredIds)]`) before SQL parameter binding.

---

### Q2.3: Deterministic Ordering of the Returned `items` Array

- **Context:**
  - § 4 specifies returning `{ "items": [...] }`.
  - SQLite `WHERE id IN (?, ?)` does not guarantee preservation of input parameter order.
- **Recommendation:**
  - Order SQL results deterministically by `ORDER BY id ASC` (or `ORDER BY modified_at DESC, id ASC`).
  - Deterministic ordering ensures stable JSON wire responses and deterministic testing across platforms.
  - The client matches returned items by `item.id` via map/dictionary lookup rather than positional indexing.

---

### Q2.4: URL Precedence & SQL Query Construction

- **Context:**
  - The `item` table contains both `url` and `canonical_url` columns (both nullable).
  - § 4 specifies returning canonical URL over raw URL.
- **Recommendation:**
  - Use `COALESCE(canonical_url, url)` directly in the SQL projection:

    ```sql
    SELECT id, service, type, title,
           COALESCE(canonical_url, url) AS url,
           modified_at
      FROM item
     WHERE id IN (${placeholders})
     ORDER BY id ASC;
    ```

  - This avoids fetching extra columns into memory and applies the exact canonicalization precedence at the database layer.

---

## 3. Module Architecture & File Layout

To maintain modularity and isolation, the implementation should be structured as follows:

```text
packages/gateway/src/
├── index/
│   ├── resolve-by-id.ts          # Core SQL lookup and projection logic
│   └── resolve-by-id.test.ts     # Unit tests for query, deduplication, and bounds
├── ipc/
│   ├── http-route-auth.ts        # Add ROUTE_KEY_ITEMS_RESOLVE_IDS & scope binding
│   ├── http-route-auth.test.ts   # Verify route scanning & auth completeness
│   └── http-server.ts            # Wire handleItemsResolveIds in tryBearerAuthedGet
```

### 3.1 Type Definitions (`packages/gateway/src/index/resolve-by-id.ts`)

```ts
import type { Database } from "bun:sqlite";

export const RESOLVE_IDS_MAX_BATCH = 100;

export interface ResolvedItemRef {
  readonly id: string;
  readonly service: string;
  readonly type: string;
  readonly title: string;
  readonly url: string | null;
  readonly modified_at: number;
}

export function resolveItemsByIds(
  db: Database,
  ids: readonly string[],
): ResolvedItemRef[] {
  if (ids.length === 0) return [];
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length > RESOLVE_IDS_MAX_BATCH) {
    throw new Error(`resolveItemsByIds: batch size exceeds limit of ${RESOLVE_IDS_MAX_BATCH}`);
  }

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const sql = `
    SELECT id, service, type, title,
           COALESCE(canonical_url, url) AS url,
           modified_at
      FROM item
     WHERE id IN (${placeholders})
     ORDER BY id ASC
  `;

  const rows = db.query(sql).all(...uniqueIds) as Array<{
    id: string;
    service: string;
    type: string;
    title: string;
    url: string | null;
    modified_at: number;
  }>;

  // Exact projection: prevent internal table row leaks
  return rows.map((r) => ({
    id: r.id,
    service: r.service,
    type: r.type,
    title: r.title,
    url: r.url,
    modified_at: r.modified_at,
  }));
}
```

### 3.2 HTTP Route & Auth Integration (`packages/gateway/src/ipc/http-route-auth.ts`)

```ts
export const ROUTE_KEY_ITEMS_RESOLVE_IDS = "GET /v1/items/resolve-ids";

export const HTTP_ROUTE_AUTH = Object.freeze({
  // ...
  [ROUTE_KEY_ITEMS_RESOLVE_IDS]: { kind: "clip", scope: "resolve" },
});

export type ClipReadRouteKey =
  // ...
  | typeof ROUTE_KEY_ITEMS_RESOLVE_IDS;
```

---

## 4. Security & Invariants Audit

1. **Invariant I13 (Write Route Allowlist):** `GET /v1/items/resolve-ids` is a read-only endpoint, correctly staying off `WRITE_ROUTE_ALLOWLIST` and mounted in `tryBearerAuthedGet`.
2. **Invariant I29 / Egress Ledger:** No egress row is appended. `egress/egress-coverage.ts` documentation should be updated to list `GET /v1/items/resolve-ids` alongside `resolve` and `resolve-file` as local index reads that emit zero ledger rows.
3. **Scope Partitioning (`resolve` vs `fetch`):** A token with `resolve` scope can read metadata for existing indexed items, but cannot trigger remote provider requests (`POST /v1/items/fetch`).
4. **Exact Field Projection:** The handler constructs returned objects explicitly (`id`, `service`, `type`, `title`, `url`, `modified_at`), ensuring internal SQLite columns (`body`, `metadata`, `author_id`, `synced_at`) never leak over the wire.

---

## 5. Comprehensive Testing Strategy

### 5.1 Unit Tests (`packages/gateway/src/index/resolve-by-id.test.ts`)

- **Single ID hit:** Returns exact 6-field projection.
- **Multiple IDs hit:** Returns all matched items.
- **Partial hit:** Missing IDs omitted from `items` array without error.
- **URL fallback:** `canonical_url` prioritized over `url`; null when both absent.
- **Deduplication:** Duplicate input IDs query SQLite once and return single object.
- **Batch cap:** Throws when input array exceeds `RESOLVE_IDS_MAX_BATCH`.

### 5.2 HTTP Route & Auth Tests (`packages/gateway/src/ipc/http-route-auth.test.ts`)

- `HTTP_ROUTE_AUTH` scanner verifies `GET /v1/items/resolve-ids` is present and mapped to `{ kind: "clip", scope: "resolve" }`.
- Token without `resolve` scope receives `403 { "error": "insufficient_scope" }`.
- Legacy token (`clip`, `briefs`) receives 403.
- Unmounted clips vault receives `404 { "error": "resolve_disabled" }`.

### 5.3 HTTP Integration Tests (`packages/gateway/src/ipc/http-server.test.ts`)

- `GET /v1/items/resolve-ids` with valid token $\to$ `200 { "items": [...] }`.
- `GET /v1/items/resolve-ids` with no `id` query params $\to$ `400 { "error": "missing_id" }`.
- `GET /v1/items/resolve-ids` with $>100$ `id` query params $\to$ `400 { "error": "too_many_ids" }`.
- Exact key set assertion: `Object.keys(body.items[0]).sort()` strictly equals `["id", "modified_at", "service", "title", "type", "url"]`.
