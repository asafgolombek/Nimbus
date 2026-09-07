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

type Row = {
  id: string;
  service: string;
  type: string;
  title: string;
  url: string | null;
  modified_at: number;
};

/**
 * Map item ids to their references. Ids the index does not hold are ABSENT from
 * the result — not null entries. "Not indexed" and "indexed with no source URL"
 * are different facts and a caller renders them differently.
 *
 * Throws above `RESOLVE_IDS_MAX_BATCH`; the HTTP layer turns that into a 400
 * rather than clamping, because silently dropping ids drops links. The raw
 * (pre-de-duplication) count is what is checked against the cap — a post-dedup
 * check is cheap for a caller sending many copies of one id and not for the
 * gateway.
 */
export function resolveItemsByIds(db: Database, ids: readonly string[]): ResolvedItemRef[] {
  if (ids.length > RESOLVE_IDS_MAX_BATCH) {
    throw new Error(`resolveItemsByIds: ${ids.length} ids exceeds ${RESOLVE_IDS_MAX_BATCH}`);
  }
  const unique = [...new Set(ids)];
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
    .all(...unique) as Row[];
  return rows;
}
