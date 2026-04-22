# Phase 4 / Section 2 — A.1 Graph-Aware Watcher Conditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Nimbus watcher conditions with a `graph` predicate that filters candidate items by relationship-graph membership (owned_by a person, upstream_of / downstream_of another entity), gated behind a `[automation].graph_conditions` TOML flag, and expose the preview + dropdown IPCs (`watcher.validateCondition`, `watcher.listCandidateRelations`) that Section 5's Watchers UI will consume.

**Architecture:**
- Storage: new nullable TEXT column `watcher.graph_predicate_json` added via SQLite migration V22 (spec originally said V20, but V20/V21 landed between spec authorship and now — see Task 13).
- Evaluator: new `packages/gateway/src/automation/graph-predicate.ts` parses + validates the predicate JSON and answers the point question "does this item satisfy the predicate?" by reusing `traverseGraph` (depth=1) from `packages/gateway/src/graph/relationship-graph.ts`.
- Integration: `watcher-engine.ts` applies the graph predicate as a post-filter on the existing alert-query candidates; the feature-flag check short-circuits evaluation when disabled.
- IPC: two new read-only handlers in `automation-rpc.ts` added to the existing `watcher.*` namespace.
- UI contract: Tauri `ALLOWED_METHODS` grows by two entries, preserving alphabetic order and updating the exact-size assertion.
- Config: new `[automation]` TOML section parsed and loaded following the established `[lan]` section pattern.

**Tech Stack:**
- TypeScript 6.x strict / Bun 1.2+ (`bun test`, `bun:sqlite`)
- Biome for lint + format
- Rust (Tauri bridge) — `cargo test` for allowlist assertions
- Existing graph schema from V7 (`graph_entity`, `graph_relation`) and V12 (`graph_relation_type`).

**Branch:** `dev/asafgolombek/phase4-s2-watcher-graph`

**Spec reference:** `docs/superpowers/specs/2026-04-21-phase-4-completion-design.md` §Section 2.

---

## Task 0: Branch Setup

**Files:** none (branching only).

- [ ] **Step 1: Confirm `main` is up-to-date and clean**

```bash
cd C:/gitrepo/Nimbus
git status
git fetch origin
git checkout main
git pull --ff-only origin main
```

Expected: working tree clean, `main` at or ahead of `origin/main`.

- [ ] **Step 2: Create the S2 feature branch**

```bash
git checkout -b dev/asafgolombek/phase4-s2-watcher-graph
```

Expected: `Switched to a new branch 'dev/asafgolombek/phase4-s2-watcher-graph'`.

- [ ] **Step 3: Quick sanity build**

```bash
bun install
bun run typecheck
```

Expected: `tsc` passes on every workspace.

---

## Task 1: V22 Migration SQL File

**Files:**
- Create: `packages/gateway/src/index/watcher-graph-v22-sql.ts`

- [ ] **Step 1: Write the migration SQL module**

Create `packages/gateway/src/index/watcher-graph-v22-sql.ts`:

```ts
/**
 * Phase 4 Section 2 — Graph-aware watcher conditions (user_version 22).
 *
 * Adds a nullable `graph_predicate_json` column to `watcher`. When non-null,
 * the watcher engine additionally filters candidate items through the graph
 * predicate evaluator (see `packages/gateway/src/automation/graph-predicate.ts`).
 *
 * Nullable by design — pre-existing watchers remain unchanged and continue to
 * evaluate using only their `condition_json` filter.
 */

export const WATCHER_GRAPH_V22_SQL = `
ALTER TABLE watcher ADD COLUMN graph_predicate_json TEXT;
`;
```

- [ ] **Step 2: Commit**

```bash
git add packages/gateway/src/index/watcher-graph-v22-sql.ts
git commit -m "feat(gateway): add V22 migration SQL for watcher.graph_predicate_json"
```

---

## Task 2: Wire V22 Into the Migration Runner

**Files:**
- Modify: `packages/gateway/src/index/migrations/runner.ts`

- [ ] **Step 1: Add the import**

In `packages/gateway/src/index/migrations/runner.ts`, add (alphabetical order with the other v-sql imports, near line 19):

```ts
import { WATCHER_GRAPH_V22_SQL } from "../watcher-graph-v22-sql.ts";
```

- [ ] **Step 2: Add the migration function**

After `migrateIndexedV20ToV21` (around line 313), add:

```ts
function migrateIndexedV21ToV22(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(WATCHER_GRAPH_V22_SQL);
    db.exec("PRAGMA user_version = 22");
    recordMigration(db, 22, "watcher.graph_predicate_json (graph-aware conditions)", now);
  })();
}
```

- [ ] **Step 3: Append to `INDEXED_SCHEMA_STEPS`**

Add as the last entry in the array (immediately after the `20 → 21` step):

```ts
  { fromVersion: 21, toVersion: 22, apply: migrateIndexedV21ToV22 },
```

- [ ] **Step 4: Append to `BACKFILL_LABELS`**

Add as the last entry in the array (string order mirrors schema step order):

```ts
  "watcher.graph_predicate_json (graph-aware conditions) (backfilled)",
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: passes — no `any`, no broken imports.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/index/migrations/runner.ts
git commit -m "feat(gateway): wire V22 watcher-graph migration into runner"
```

---

## Task 2b: Bump `CURRENT_SCHEMA_VERSION` to 22

**Why:** `LocalIndex.ensureSchema()` at `packages/gateway/src/index/local-index.ts:275` calls `runIndexedSchemaMigrations(db, LocalIndex.SCHEMA_VERSION, …)`. If `CURRENT_SCHEMA_VERSION` remains `21`, runtime DBs never step from 21 → 22 — the new column ships as dead code. The constant is also the single source of truth consumed by `data-import.ts` (version-compat gate), `data-rpc.ts` (export manifest), and `ipc/server.ts` (diag). Without the bump, exports record the wrong version.

**Files:**
- Modify: `packages/gateway/src/index/local-index.ts`

- [ ] **Step 1: Bump the constant**

In `packages/gateway/src/index/local-index.ts` line 267, change:

```ts
export const CURRENT_SCHEMA_VERSION = 21;
```

to:

```ts
export const CURRENT_SCHEMA_VERSION = 22;
```

- [ ] **Step 2: Run the full-chain migration test**

```bash
bun test packages/gateway/test/unit/db/migration-rollback.test.ts
```

Expected: `migrates a fresh in-memory db to SCHEMA_VERSION without backup` passes — confirms the full 0 → 22 chain works through `LocalIndex.ensureSchema`.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: green. Any consumer that did `=== 21` (none found during plan authorship, but re-verify via `rg "SCHEMA_VERSION" packages/ -n`) would need a follow-up.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/index/local-index.ts
git commit -m "feat(gateway): bump CURRENT_SCHEMA_VERSION to 22 for watcher-graph migration"
```

---

## Task 3: V22 Migration Tests

**Files:**
- Create: `packages/gateway/src/index/migrations/runner-v22.test.ts`

- [ ] **Step 1: Write failing tests (mirror the V21 style)**

Create `packages/gateway/src/index/migrations/runner-v22.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runIndexedSchemaMigrations } from "./runner.ts";

describe("V22 migration — watcher.graph_predicate_json", () => {
  test("adds nullable graph_predicate_json column", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 22);
    const cols = db.query(`PRAGMA table_info(watcher)`).all() as Array<{
      name: string;
      dflt_value: string | null;
      notnull: number;
      type: string;
    }>;
    const col = cols.find((c) => c.name === "graph_predicate_json");
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(0);
    expect(col?.dflt_value).toBeNull();
    expect(col?.type.toUpperCase()).toBe("TEXT");
  });

  test("pre-existing watchers default to NULL graph_predicate_json", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    db.run(
      `INSERT INTO watcher (id, name, enabled, condition_type, condition_json,
                            action_type, action_json, created_at)
       VALUES (?, ?, 1, 'alert_fired', '{}', 'notify', '{}', ?)`,
      ["w1", "legacy", 1_700_000_000_000],
    );
    runIndexedSchemaMigrations(db, 22);
    const row = db
      .query(`SELECT graph_predicate_json FROM watcher WHERE id = 'w1'`)
      .get() as { graph_predicate_json: string | null };
    expect(row.graph_predicate_json).toBeNull();
  });

  test("accepts an arbitrary JSON string", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 22);
    db.run(
      `INSERT INTO watcher (id, name, enabled, condition_type, condition_json,
                            action_type, action_json, created_at,
                            graph_predicate_json)
       VALUES (?, ?, 1, 'alert_fired', '{}', 'notify', '{}', ?, ?)`,
      [
        "w2",
        "gp",
        1_700_000_000_000,
        JSON.stringify({ relation: "owned_by", target: { type: "person", externalId: "u:1" } }),
      ],
    );
    const row = db
      .query(`SELECT graph_predicate_json FROM watcher WHERE id = 'w2'`)
      .get() as { graph_predicate_json: string | null };
    expect(row.graph_predicate_json).not.toBeNull();
    expect(JSON.parse(row.graph_predicate_json ?? "null")).toMatchObject({ relation: "owned_by" });
  });

  test("is idempotent when run twice", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 22);
    runIndexedSchemaMigrations(db, 22);
    const cols = db.query(`PRAGMA table_info(watcher)`).all() as Array<{ name: string }>;
    expect(cols.filter((c) => c.name === "graph_predicate_json")).toHaveLength(1);
  });

  test("records the ledger entry", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 22);
    const row = db
      .query(`SELECT description FROM _schema_migrations WHERE version = 22`)
      .get() as { description: string } | undefined;
    expect(row?.description).toContain("graph-aware");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
bun test packages/gateway/src/index/migrations/runner-v22.test.ts
```

Expected: all five tests green.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/index/migrations/runner-v22.test.ts
git commit -m "test(gateway): cover V22 watcher-graph migration"
```

---

## Task 4: Extend `WatcherRow` Type + Accessors

**Files:**
- Modify: `packages/gateway/src/automation/watcher-store.ts`

- [ ] **Step 1: Add the new column to the row type**

In `packages/gateway/src/automation/watcher-store.ts`, extend `WatcherRow` (replace the existing type literal):

```ts
export type WatcherRow = {
  id: string;
  name: string;
  enabled: number;
  condition_type: string;
  condition_json: string;
  action_type: string;
  action_json: string;
  created_at: number;
  last_checked_at: number | null;
  last_fired_at: number | null;
  graph_predicate_json: string | null;
};
```

- [ ] **Step 2: Extend `listWatchers` SELECT**

Replace the query body inside `listWatchers`:

```ts
  return db
    .query(
      `SELECT id, name, enabled, condition_type, condition_json, action_type, action_json,
              created_at, last_checked_at, last_fired_at, graph_predicate_json
       FROM watcher ORDER BY name`,
    )
    .all() as WatcherRow[];
```

- [ ] **Step 3: Extend `insertWatcher` to take an optional graph predicate**

Replace the existing `insertWatcher` function:

```ts
export function insertWatcher(
  db: Database,
  row: Omit<WatcherRow, "id" | "last_checked_at" | "last_fired_at" | "graph_predicate_json"> & {
    id?: string;
    graph_predicate_json?: string | null;
  },
): string {
  if (readIndexedUserVersion(db) < 8) {
    throw new Error("Watcher schema requires v8+");
  }
  const id = row.id ?? randomUUID();
  const now = row.created_at;
  const gpj = row.graph_predicate_json ?? null;
  db.run(
    `INSERT INTO watcher (id, name, enabled, condition_type, condition_json,
                          action_type, action_json, created_at, graph_predicate_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, row.name, row.enabled, row.condition_type, row.condition_json, row.action_type, row.action_json, now, gpj],
  );
  return id;
}
```

- [ ] **Step 4: Add a dedicated update helper for the predicate**

Append to the bottom of `packages/gateway/src/automation/watcher-store.ts`:

```ts
export function setWatcherGraphPredicate(
  db: Database,
  id: string,
  graphPredicateJson: string | null,
): boolean {
  if (readIndexedUserVersion(db) < 22) {
    return false;
  }
  const r = db.run(`UPDATE watcher SET graph_predicate_json = ? WHERE id = ?`, [
    graphPredicateJson,
    id,
  ]);
  return r.changes > 0;
}
```

- [ ] **Step 5: Run the existing watcher-store tests**

```bash
bun test packages/gateway/src/automation/watcher-store.test.ts
```

Expected: existing tests still green. Any test that constructs a bare `WatcherRow` literal will fail — if so, add `graph_predicate_json: null` to that literal; do NOT weaken the type.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/automation/watcher-store.ts packages/gateway/src/automation/watcher-store.test.ts
git commit -m "feat(gateway): extend watcher-store with graph_predicate_json column"
```

---

## Task 5: Graph Predicate Types + Parser

**Files:**
- Create: `packages/gateway/src/automation/graph-predicate.ts`
- Create: `packages/gateway/src/automation/graph-predicate.test.ts`

- [ ] **Step 1: Write the failing parser tests**

Create `packages/gateway/src/automation/graph-predicate.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  GRAPH_RELATION_KINDS,
  listCandidateGraphRelations,
  parseGraphPredicate,
} from "./graph-predicate.ts";

describe("parseGraphPredicate", () => {
  test("accepts a well-formed owned_by predicate with a person target", () => {
    const raw = JSON.stringify({
      relation: "owned_by",
      target: { type: "person", externalId: "gh:42" },
    });
    const parsed = parseGraphPredicate(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.predicate.relation).toBe("owned_by");
      expect(parsed.predicate.target).toEqual({ type: "person", externalId: "gh:42" });
    }
  });

  test("accepts upstream_of with a generic entity target", () => {
    const raw = JSON.stringify({
      relation: "upstream_of",
      target: { type: "repo", externalId: "github:acme/svc" },
    });
    const parsed = parseGraphPredicate(raw);
    expect(parsed.ok).toBe(true);
  });

  test("accepts downstream_of", () => {
    const raw = JSON.stringify({
      relation: "downstream_of",
      target: { type: "repo", externalId: "github:acme/svc" },
    });
    const parsed = parseGraphPredicate(raw);
    expect(parsed.ok).toBe(true);
  });

  test("rejects malformed JSON", () => {
    const parsed = parseGraphPredicate("not json");
    expect(parsed.ok).toBe(false);
  });

  test("rejects unknown relation kind", () => {
    const raw = JSON.stringify({
      relation: "bogus",
      target: { type: "person", externalId: "x" },
    });
    const parsed = parseGraphPredicate(raw);
    expect(parsed.ok).toBe(false);
  });

  test("rejects empty externalId", () => {
    const raw = JSON.stringify({
      relation: "owned_by",
      target: { type: "person", externalId: "" },
    });
    const parsed = parseGraphPredicate(raw);
    expect(parsed.ok).toBe(false);
  });

  test("rejects missing target", () => {
    const raw = JSON.stringify({ relation: "owned_by" });
    const parsed = parseGraphPredicate(raw);
    expect(parsed.ok).toBe(false);
  });

  test("rejects non-string target type", () => {
    const raw = JSON.stringify({
      relation: "owned_by",
      target: { type: 42, externalId: "x" },
    });
    const parsed = parseGraphPredicate(raw);
    expect(parsed.ok).toBe(false);
  });
});

describe("listCandidateGraphRelations", () => {
  test("returns exactly the three logical relation kinds", () => {
    const kinds = listCandidateGraphRelations();
    expect(kinds).toHaveLength(3);
    expect(kinds.map((k) => k.relation).sort()).toEqual(["downstream_of", "owned_by", "upstream_of"]);
  });

  test("exposes an underlying-relation-type mapping per kind", () => {
    const kinds = listCandidateGraphRelations();
    for (const k of kinds) {
      expect(k.underlyingRelationTypes.length).toBeGreaterThan(0);
      for (const t of k.underlyingRelationTypes) {
        expect(typeof t).toBe("string");
        expect(t.length).toBeGreaterThan(0);
      }
    }
  });

  test("GRAPH_RELATION_KINDS and listCandidateGraphRelations agree", () => {
    const listed = listCandidateGraphRelations().map((k) => k.relation).sort();
    const kinds = [...GRAPH_RELATION_KINDS].sort();
    expect(listed).toEqual(kinds);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/gateway/src/automation/graph-predicate.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the minimal parser implementation**

Create `packages/gateway/src/automation/graph-predicate.ts`:

```ts
/**
 * Phase 4 Section 2 — Graph-aware watcher predicates.
 *
 * Predicate JSON shape (stored in `watcher.graph_predicate_json`):
 *
 *   {
 *     "relation": "owned_by" | "upstream_of" | "downstream_of",
 *     "target":   { "type": string, "externalId": string }
 *   }
 *
 * Logical relation kinds map onto sets of concrete `graph_relation.type`
 * values emitted by `graph-populator.ts`:
 *
 *   owned_by       ← target PERSON → item via  authored | opened | posted
 *   upstream_of    ← item → target  via  any outgoing edge (belongs_to, targets, in_repo, defined_in, depends_on)
 *   downstream_of  ← target → item  via  any outgoing edge (same set, direction reversed)
 *
 * Predicate evaluation is a *filter*: a candidate item matches the watcher
 * iff its `graph_entity` row (resolved via `deterministicGraphEntityId`) has
 * a direct graph-edge to the target entity in the logical direction.
 */

import type { Database } from "bun:sqlite";
import { deterministicGraphEntityId, traverseGraph } from "../graph/relationship-graph.ts";

export const GRAPH_RELATION_KINDS = ["owned_by", "upstream_of", "downstream_of"] as const;
export type GraphRelationKind = (typeof GRAPH_RELATION_KINDS)[number];

export type GraphTarget = {
  type: string;
  externalId: string;
};

export type GraphPredicate = {
  relation: GraphRelationKind;
  target: GraphTarget;
};

export type ParseGraphPredicateResult =
  | { ok: true; predicate: GraphPredicate }
  | { ok: false; error: string };

const OWNED_BY_UNDERLYING = ["authored", "opened", "posted"] as const;
const UPSTREAM_UNDERLYING = [
  "belongs_to",
  "targets",
  "in_repo",
  "defined_in",
  "depends_on",
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isGraphRelationKind(v: unknown): v is GraphRelationKind {
  return typeof v === "string" && (GRAPH_RELATION_KINDS as readonly string[]).includes(v);
}

function validateTarget(raw: unknown): GraphTarget | string {
  if (!isRecord(raw)) {
    return "target must be an object";
  }
  const type = raw["type"];
  if (typeof type !== "string" || type.trim() === "") {
    return "target.type must be a non-empty string";
  }
  const externalId = raw["externalId"];
  if (typeof externalId !== "string" || externalId.trim() === "") {
    return "target.externalId must be a non-empty string";
  }
  return { type: type.trim(), externalId: externalId.trim() };
}

export function parseGraphPredicate(json: string): ParseGraphPredicateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "graph_predicate_json is not valid JSON" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "graph_predicate_json must be a JSON object" };
  }
  const relation = parsed["relation"];
  if (!isGraphRelationKind(relation)) {
    return {
      ok: false,
      error: `relation must be one of ${GRAPH_RELATION_KINDS.join(", ")}`,
    };
  }
  const targetResult = validateTarget(parsed["target"]);
  if (typeof targetResult === "string") {
    return { ok: false, error: targetResult };
  }
  return { ok: true, predicate: { relation, target: targetResult } };
}

export type CandidateRelation = {
  relation: GraphRelationKind;
  description: string;
  underlyingRelationTypes: readonly string[];
};

export function listCandidateGraphRelations(): readonly CandidateRelation[] {
  return [
    {
      relation: "owned_by",
      description: "Item was authored, opened, or posted by the target person.",
      underlyingRelationTypes: OWNED_BY_UNDERLYING,
    },
    {
      relation: "upstream_of",
      description: "Item has a direct outgoing edge to the target entity.",
      underlyingRelationTypes: UPSTREAM_UNDERLYING,
    },
    {
      relation: "downstream_of",
      description: "Target entity has a direct outgoing edge to the item.",
      underlyingRelationTypes: UPSTREAM_UNDERLYING,
    },
  ];
}

export type ItemMatchContext = {
  db: Database;
  itemEntityType: string;
  itemExternalId: string;
  predicate: GraphPredicate;
};

/**
 * Returns `true` iff the item referenced by (`itemEntityType`, `itemExternalId`)
 * has a **direct graph edge** (depth 1) to the predicate's target in the
 * direction implied by `predicate.relation`.
 */
export function itemMatchesGraphPredicate(ctx: ItemMatchContext): boolean {
  const { db, itemEntityType, itemExternalId, predicate } = ctx;
  const itemEntityId = deterministicGraphEntityId(itemEntityType, itemExternalId);
  const targetEntityId = deterministicGraphEntityId(
    predicate.target.type,
    predicate.target.externalId,
  );

  // Spec asks us to reuse `traverseGraph` — depth=1 gives us the direct edges
  // around the item. We then inspect the relation list for an edge to the
  // target in the correct direction and relation-type set.
  const ownedBy: readonly string[] = OWNED_BY_UNDERLYING;
  const upstream: readonly string[] = UPSTREAM_UNDERLYING;
  const typeFilter: readonly string[] =
    predicate.relation === "owned_by" ? ownedBy : upstream;
  const traversal = traverseGraph(db, itemEntityId, {
    depth: 1,
    relationTypes: [...typeFilter],
  });
  if ("error" in traversal) {
    return false;
  }

  for (const rel of traversal.relations) {
    if (predicate.relation === "owned_by") {
      // person → item edge
      if (rel.from_id === targetEntityId && rel.to_id === itemEntityId) {
        return true;
      }
    } else if (predicate.relation === "upstream_of") {
      // item → target edge
      if (rel.from_id === itemEntityId && rel.to_id === targetEntityId) {
        return true;
      }
    } else {
      // downstream_of: target → item edge
      if (rel.from_id === targetEntityId && rel.to_id === itemEntityId) {
        return true;
      }
    }
  }
  return false;
}

export type ValidateCountContext = {
  db: Database;
  predicate: GraphPredicate;
  /** `item.modified_at` lower bound (exclusive). Prevents unbounded scans. */
  sinceMs: number;
  /** Hard cap on scanned candidate items. Default 5_000. */
  maxScan?: number;
};

/**
 * Read-only preview count used by `watcher.validateCondition`. Scans at most
 * `maxScan` recent items and returns how many satisfy the predicate. Does
 * NOT leak item content or secrets — caller only sees the count.
 */
export function countItemsMatchingGraphPredicate(ctx: ValidateCountContext): number {
  const { db, predicate, sinceMs } = ctx;
  const maxScan = ctx.maxScan ?? 5_000;
  const candidates = db
    .query(
      `SELECT id, service, type, external_id FROM item
       WHERE modified_at > ?
       ORDER BY modified_at DESC
       LIMIT ?`,
    )
    .all(sinceMs, maxScan) as Array<{
    id: string;
    service: string;
    type: string;
    external_id: string;
  }>;
  let count = 0;
  for (const row of candidates) {
    if (
      itemMatchesGraphPredicate({
        db,
        itemEntityType: row.type,
        itemExternalId: row.external_id,
        predicate,
      })
    ) {
      count += 1;
    }
  }
  return count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/gateway/src/automation/graph-predicate.test.ts
```

Expected: 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/automation/graph-predicate.ts packages/gateway/src/automation/graph-predicate.test.ts
git commit -m "feat(gateway): add graph-predicate parser + evaluator for watcher conditions"
```

---

## Task 6: Integration Tests — `itemMatchesGraphPredicate` Against Seeded Graph

**Files:**
- Modify: `packages/gateway/src/automation/graph-predicate.test.ts` (append a new `describe` block)

- [ ] **Step 1: Add fixture-based matching tests**

Append to `packages/gateway/src/automation/graph-predicate.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { LocalIndex } from "../index/local-index.ts";
import {
  deterministicGraphEntityId,
  upsertGraphEntity,
  upsertGraphRelation,
} from "../graph/relationship-graph.ts";
import {
  countItemsMatchingGraphPredicate,
  itemMatchesGraphPredicate,
} from "./graph-predicate.ts";

function seededDb(): Database {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return db;
}

describe("itemMatchesGraphPredicate", () => {
  test("owned_by matches when person authored the item", () => {
    const db = seededDb();
    const now = 1_700_000_000_000;
    const personId = upsertGraphEntity(db, {
      type: "person",
      externalId: "gh:42",
      label: "Dev",
      service: "github",
    });
    const prId = upsertGraphEntity(db, {
      type: "pr",
      externalId: "pr-1",
      label: "Fix bug",
      service: "github",
    });
    upsertGraphRelation(db, personId, prId, "authored", now);

    const matched = itemMatchesGraphPredicate({
      db,
      itemEntityType: "pr",
      itemExternalId: "pr-1",
      predicate: {
        relation: "owned_by",
        target: { type: "person", externalId: "gh:42" },
      },
    });
    expect(matched).toBe(true);
  });

  test("owned_by rejects when relation type is not an ownership type", () => {
    const db = seededDb();
    const now = 1_700_000_000_000;
    const personId = upsertGraphEntity(db, {
      type: "person",
      externalId: "gh:42",
      label: "Dev",
      service: "github",
    });
    const prId = upsertGraphEntity(db, {
      type: "pr",
      externalId: "pr-1",
      label: "Fix bug",
      service: "github",
    });
    // Non-ownership relation type — predicate should not match.
    upsertGraphRelation(db, personId, prId, "reviewed", now);

    const matched = itemMatchesGraphPredicate({
      db,
      itemEntityType: "pr",
      itemExternalId: "pr-1",
      predicate: {
        relation: "owned_by",
        target: { type: "person", externalId: "gh:42" },
      },
    });
    expect(matched).toBe(false);
  });

  test("upstream_of matches an item → target outgoing edge", () => {
    const db = seededDb();
    const now = 1_700_000_000_000;
    const prId = upsertGraphEntity(db, {
      type: "pr",
      externalId: "pr-2",
      label: "PR",
      service: "github",
    });
    const repoId = upsertGraphEntity(db, {
      type: "repo",
      externalId: "github:acme/svc",
      label: "acme/svc",
      service: "github",
    });
    upsertGraphRelation(db, prId, repoId, "targets", now);

    const matched = itemMatchesGraphPredicate({
      db,
      itemEntityType: "pr",
      itemExternalId: "pr-2",
      predicate: {
        relation: "upstream_of",
        target: { type: "repo", externalId: "github:acme/svc" },
      },
    });
    expect(matched).toBe(true);
    // And "downstream_of" on the same pair is false — direction matters.
    expect(
      itemMatchesGraphPredicate({
        db,
        itemEntityType: "pr",
        itemExternalId: "pr-2",
        predicate: {
          relation: "downstream_of",
          target: { type: "repo", externalId: "github:acme/svc" },
        },
      }),
    ).toBe(false);
  });

  test("downstream_of matches a target → item edge", () => {
    const db = seededDb();
    const now = 1_700_000_000_000;
    const wsId = upsertGraphEntity(db, {
      type: "workspace",
      externalId: "filesystem:/repo",
      label: "/repo",
      service: "filesystem",
    });
    const depId = upsertGraphEntity(db, {
      type: "package",
      externalId: "npm:left-pad@1.0.0",
      label: "left-pad@1.0.0",
      service: "filesystem",
    });
    upsertGraphRelation(db, wsId, depId, "depends_on", now);

    const matched = itemMatchesGraphPredicate({
      db,
      itemEntityType: "package",
      itemExternalId: "npm:left-pad@1.0.0",
      predicate: {
        relation: "downstream_of",
        target: { type: "workspace", externalId: "filesystem:/repo" },
      },
    });
    expect(matched).toBe(true);
  });

  test("returns false when item entity is missing from the graph", () => {
    const db = seededDb();
    const matched = itemMatchesGraphPredicate({
      db,
      itemEntityType: "pr",
      itemExternalId: "does-not-exist",
      predicate: {
        relation: "owned_by",
        target: { type: "person", externalId: "gh:42" },
      },
    });
    expect(matched).toBe(false);
  });
});

describe("countItemsMatchingGraphPredicate", () => {
  test("returns zero when no items match", () => {
    const db = seededDb();
    const n = countItemsMatchingGraphPredicate({
      db,
      sinceMs: 0,
      predicate: {
        relation: "owned_by",
        target: { type: "person", externalId: "gh:unknown" },
      },
    });
    expect(n).toBe(0);
  });

  test("counts only items within the time window that match", () => {
    const db = seededDb();
    const t0 = 1_700_000_000_000;

    // Seed two PRs as items *and* as graph entities; only the newer PR is
    // within the since window.
    db.run(
      `INSERT INTO item (id, service, type, external_id, title, modified_at, synced_at)
       VALUES ('i1', 'github', 'pr', 'pr-old', 'old', ?, ?)`,
      [t0 - 10_000, t0 - 10_000],
    );
    db.run(
      `INSERT INTO item (id, service, type, external_id, title, modified_at, synced_at)
       VALUES ('i2', 'github', 'pr', 'pr-new', 'new', ?, ?)`,
      [t0 + 10_000, t0 + 10_000],
    );
    const personId = upsertGraphEntity(db, {
      type: "person",
      externalId: "gh:7",
      label: "Dev",
      service: "github",
    });
    const oldPrId = upsertGraphEntity(db, {
      type: "pr",
      externalId: "pr-old",
      label: "old",
      service: "github",
    });
    const newPrId = upsertGraphEntity(db, {
      type: "pr",
      externalId: "pr-new",
      label: "new",
      service: "github",
    });
    upsertGraphRelation(db, personId, oldPrId, "authored", t0);
    upsertGraphRelation(db, personId, newPrId, "authored", t0);

    const n = countItemsMatchingGraphPredicate({
      db,
      sinceMs: t0,
      predicate: {
        relation: "owned_by",
        target: { type: "person", externalId: "gh:7" },
      },
    });
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: Remove the duplicate top-level imports**

The `Database`, `describe`/`expect`/`test`, `parseGraphPredicate`/`listCandidateGraphRelations` imports now live both in the existing header and the appended block. Consolidate into a single import group at the top of the file — remove the duplicates from the appended block.

- [ ] **Step 3: Run tests to verify they pass**

```bash
bun test packages/gateway/src/automation/graph-predicate.test.ts
```

Expected: 18 tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/automation/graph-predicate.test.ts
git commit -m "test(gateway): cover graph-predicate matching against seeded graph fixtures"
```

---

## Task 7: Add `[automation]` TOML Section + Default

**Files:**
- Modify: `packages/gateway/src/config/nimbus-toml.ts`
- Create: `packages/gateway/src/config/nimbus-toml-automation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/config/nimbus-toml-automation.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NIMBUS_AUTOMATION_TOML,
  parseNimbusAutomationToml,
} from "./nimbus-toml.ts";

describe("parseNimbusAutomationToml", () => {
  test("returns defaults when [automation] absent", () => {
    expect(parseNimbusAutomationToml("")).toEqual(DEFAULT_NIMBUS_AUTOMATION_TOML);
  });

  test("defaults graph_conditions to true (Section 2 ships enabled for v0.1.0)", () => {
    expect(DEFAULT_NIMBUS_AUTOMATION_TOML.graphConditions).toBe(true);
  });

  test("parses graph_conditions = false", () => {
    const toml = `
[automation]
graph_conditions = false
`;
    const out = parseNimbusAutomationToml(toml);
    expect(out.graphConditions).toBe(false);
  });

  test("parses graph_conditions = true", () => {
    const toml = `
[automation]
graph_conditions = true
`;
    const out = parseNimbusAutomationToml(toml);
    expect(out.graphConditions).toBe(true);
  });

  test("ignores unknown keys in [automation]", () => {
    const toml = `
[automation]
unknown_key = "whatever"
graph_conditions = false
`;
    const out = parseNimbusAutomationToml(toml);
    expect(out.graphConditions).toBe(false);
  });

  test("ignores [automation] keys outside the section", () => {
    const toml = `
[other]
graph_conditions = false
[automation]
`;
    const out = parseNimbusAutomationToml(toml);
    expect(out).toEqual(DEFAULT_NIMBUS_AUTOMATION_TOML);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/gateway/src/config/nimbus-toml-automation.test.ts
```

Expected: FAIL — `parseNimbusAutomationToml` / `DEFAULT_NIMBUS_AUTOMATION_TOML` not exported.

- [ ] **Step 3: Add the automation section to `nimbus-toml.ts`**

Append to `packages/gateway/src/config/nimbus-toml.ts` (after the LAN section, before any trailing `export` barrels):

```ts
// ─── [automation] ───────────────────────────────────────────────────────────

export type NimbusAutomationToml = {
  /** When true (default), graph predicates on watchers are evaluated. Phase 4 Section 2. */
  graphConditions: boolean;
};

export const DEFAULT_NIMBUS_AUTOMATION_TOML: NimbusAutomationToml = {
  graphConditions: true,
};

function parseBoolLiteral(raw: string): boolean | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return undefined;
}

function parseNimbusTomlAutomationSection(source: string): Partial<NimbusAutomationToml> {
  const lines = source.split(/\r?\n/);
  let inSection = false;
  const out: Partial<NimbusAutomationToml> = {};
  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = trimmed === "[automation]";
      continue;
    }
    if (!inSection) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const valRaw = trimmed.slice(eq + 1).trim();
    if (key === "graph_conditions") {
      const b = parseBoolLiteral(valRaw);
      if (b !== undefined) out.graphConditions = b;
    }
  }
  return out;
}

export function parseNimbusAutomationToml(
  raw: string,
  defaults: NimbusAutomationToml = DEFAULT_NIMBUS_AUTOMATION_TOML,
): NimbusAutomationToml {
  return { ...defaults, ...parseNimbusTomlAutomationSection(raw) };
}

export function loadNimbusAutomationFromPath(tomlPath: string): NimbusAutomationToml {
  if (!existsSync(tomlPath)) {
    return structuredClone(DEFAULT_NIMBUS_AUTOMATION_TOML);
  }
  try {
    const raw = readFileSync(tomlPath, "utf8");
    return parseNimbusAutomationToml(raw);
  } catch {
    return structuredClone(DEFAULT_NIMBUS_AUTOMATION_TOML);
  }
}

export function loadNimbusAutomationFromConfigDir(configDir: string): NimbusAutomationToml {
  return loadNimbusAutomationFromPath(join(configDir, "nimbus.toml"));
}
```

Note: `stripComment`, `existsSync`, `readFileSync`, and `join` are already imported at the top of `nimbus-toml.ts`. Use the in-file `parseBoolLiteral` helper — if an equivalent helper already exists nearby (a similar `parseBool` is used by the `[lan].enabled` path), reuse it instead of defining a duplicate.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/gateway/src/config/nimbus-toml-automation.test.ts
bun run typecheck
```

Expected: 6 tests green; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/config/nimbus-toml.ts packages/gateway/src/config/nimbus-toml-automation.test.ts
git commit -m "feat(gateway): add [automation].graph_conditions TOML flag (default true)"
```

---

## Task 8: Integrate Graph Predicate Into `watcher-engine.ts`

**Files:**
- Modify: `packages/gateway/src/automation/watcher-engine.ts`
- Modify: `packages/gateway/src/automation/watcher-engine.test.ts`

- [ ] **Step 1: Write failing integration tests**

Append to `packages/gateway/src/automation/watcher-engine.test.ts` (inside the existing `describe("watcher-engine", …)` block):

```ts
  test("graph predicate filters alert matches — no match suppresses notify", async () => {
    const db = makeDb();
    const t0 = 4_000_000_000_000;
    insertWatcher(db, {
      name: "graph-filtered",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "sentry" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
      graph_predicate_json: JSON.stringify({
        relation: "owned_by",
        target: { type: "person", externalId: "gh:absent" },
      }),
    });
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "a1",
      title: "cpu",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    let calls = 0;
    evaluateWatchersAfterSync(
      db,
      "sentry",
      t0 + 2000,
      () => {
        calls += 1;
      },
      { graphConditionsEnabled: true },
    );
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("graph predicate filters alert matches — matching edge fires notify", async () => {
    const db = makeDb();
    const t0 = 4_100_000_000_000;
    insertWatcher(db, {
      name: "graph-matched",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "sentry" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
      graph_predicate_json: JSON.stringify({
        relation: "owned_by",
        target: { type: "person", externalId: "gh:7" },
      }),
    });
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "a2",
      title: "oom",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    // Seed the owning edge person → alert.
    const personId = upsertGraphEntity(db, {
      type: "person",
      externalId: "gh:7",
      label: "Dev",
      service: "github",
    });
    const alertId = upsertGraphEntity(db, {
      type: "alert",
      externalId: "a2",
      label: "oom",
      service: "sentry",
    });
    upsertGraphRelation(db, personId, alertId, "authored", t0);

    let calls = 0;
    evaluateWatchersAfterSync(
      db,
      "sentry",
      t0 + 2000,
      () => {
        calls += 1;
      },
      { graphConditionsEnabled: true },
    );
    expect(calls).toBe(1);
    await Promise.resolve();
  });

  test("graph predicate is ignored when graphConditionsEnabled = false", async () => {
    const db = makeDb();
    const t0 = 4_200_000_000_000;
    insertWatcher(db, {
      name: "graph-disabled",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "sentry" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
      graph_predicate_json: JSON.stringify({
        relation: "owned_by",
        target: { type: "person", externalId: "gh:absent" },
      }),
    });
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "a3",
      title: "disk",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    let calls = 0;
    evaluateWatchersAfterSync(
      db,
      "sentry",
      t0 + 2000,
      () => {
        calls += 1;
      },
      { graphConditionsEnabled: false },
    );
    // Flag off → predicate ignored → alert fires.
    expect(calls).toBe(1);
    await Promise.resolve();
  });
```

Add the new imports at the top of the test file if missing:

```ts
import { upsertGraphEntity, upsertGraphRelation } from "../graph/relationship-graph.ts";
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/gateway/src/automation/watcher-engine.test.ts
```

Expected: FAIL — either `insertWatcher` does not accept `graph_predicate_json` (it should now after Task 4) OR the engine does not apply the predicate yet.

- [ ] **Step 3: Update the engine signature and implementation**

Replace the relevant blocks in `packages/gateway/src/automation/watcher-engine.ts`:

a) Add imports at the top of the file (alphabetized):

```ts
import {
  itemMatchesGraphPredicate,
  parseGraphPredicate,
  type GraphPredicate,
} from "./graph-predicate.ts";
```

b) Add the options type and make it part of the public API:

```ts
export type WatcherEvalOptions = {
  /** When false, `watcher.graph_predicate_json` is not evaluated. Default true. */
  graphConditionsEnabled?: boolean;
};
```

c) Extend `evaluateWatchersAfterSync` and `evaluateWatchersStartupCatchUp` to accept an optional `WatcherEvalOptions` as the fourth argument and forward it into `evaluateOneWatcher`. Backward-compatible default (`{ graphConditionsEnabled: true }`).

```ts
export function evaluateWatchersAfterSync(
  db: Database,
  syncedServiceId: string,
  nowMs: number,
  notify: (title: string, body: string) => void | Promise<void>,
  opts: WatcherEvalOptions = {},
): void {
  if (readIndexedUserVersion(db) < 8) {
    return;
  }
  const graphEnabled = opts.graphConditionsEnabled ?? true;
  for (const w of listEnabledWatchers(db)) {
    const fired = evaluateOneWatcher(db, w, syncedServiceId, graphEnabled);
    updateWatcherLastChecked(db, w.id, nowMs);
    if (fired !== null) {
      insertWatcherEvent(db, w.id, nowMs, fired.snapshot, JSON.stringify({ ok: true }));
      void notify("Nimbus watcher", `${w.name}: ${fired.summary}`);
      updateWatcherLastFired(db, w.id, nowMs);
    }
  }
}

export function evaluateWatchersStartupCatchUp(
  db: Database,
  nowMs: number,
  notify: (title: string, body: string) => void | Promise<void>,
  opts: WatcherEvalOptions = {},
): void {
  if (readIndexedUserVersion(db) < 8) {
    return;
  }
  const graphEnabled = opts.graphConditionsEnabled ?? true;
  for (const w of listEnabledWatchers(db)) {
    const fired = evaluateOneWatcher(db, w, undefined, graphEnabled);
    updateWatcherLastChecked(db, w.id, nowMs);
    if (fired !== null) {
      insertWatcherEvent(db, w.id, nowMs, fired.snapshot, JSON.stringify({ ok: true }));
      void notify("Nimbus watcher", `${w.name}: ${fired.summary}`);
      updateWatcherLastFired(db, w.id, nowMs);
    }
  }
}
```

d) Extend `evaluateOneWatcher` with graph-predicate filtering:

```ts
function evaluateOneWatcher(
  db: Database,
  w: WatcherRow,
  syncedServiceId: string | undefined,
  graphEnabled: boolean,
): { summary: string; snapshot: string } | null {
  if (w.condition_type !== "alert_fired") {
    return null;
  }
  const cond = asRecord(w.condition_json);
  if (cond === undefined) {
    return null;
  }
  const filter = cond["filter"];
  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
    return null;
  }
  const f = filter as Record<string, unknown>;
  const service = typeof f["service"] === "string" ? f["service"] : undefined;
  if (syncedServiceId !== undefined && service !== undefined && service !== syncedServiceId) {
    return null;
  }

  const since = w.last_checked_at ?? w.created_at;
  const rows = db
    .query(
      `SELECT id, title, service, type, external_id, modified_at FROM item
       WHERE type = 'alert'
         AND modified_at > ?
         AND (? IS NULL OR service = ?)
       ORDER BY modified_at DESC
       LIMIT 5`,
    )
    .all(since, service ?? null, service ?? null) as Array<{
    id: string;
    title: string;
    service: string;
    type: string;
    external_id: string;
    modified_at: number;
  }>;

  if (rows.length === 0) {
    return null;
  }

  // Apply graph predicate if present and enabled. Invalid JSON or parse
  // errors drop the watcher to "no match" rather than firing — fail closed.
  // A console.error makes malformed stored predicates visible; the UI's
  // `watcher.validateCondition` is the first line of defence (users should
  // never reach this branch through normal flows).
  let predicate: GraphPredicate | null = null;
  if (graphEnabled && w.graph_predicate_json !== null && w.graph_predicate_json !== "") {
    const parsed = parseGraphPredicate(w.graph_predicate_json);
    if (!parsed.ok) {
      console.error(
        `watcher ${w.id} (${w.name}): graph_predicate_json parse failed — ${parsed.error}`,
      );
      return null;
    }
    predicate = parsed.predicate;
  }

  const filtered =
    predicate === null
      ? rows
      : rows.filter((r) =>
          itemMatchesGraphPredicate({
            db,
            itemEntityType: r.type,
            itemExternalId: r.external_id,
            // At this point predicate !== null.
            predicate: predicate as GraphPredicate,
          }),
        );

  if (filtered.length === 0) {
    return null;
  }

  const first = filtered[0];
  if (first === undefined) {
    return null;
  }
  const summary = `${first.service}: ${first.title}`;
  const snapshot = JSON.stringify({ matches: filtered, condition: w.condition_json });
  return { summary, snapshot };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/gateway/src/automation/watcher-engine.test.ts
```

Expected: existing tests + 3 new ones all green. If any existing test regresses because the engine's SELECT shape now includes `type` and `external_id`, update the affected test fixtures — do not narrow the SELECT.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/automation/watcher-engine.ts packages/gateway/src/automation/watcher-engine.test.ts
git commit -m "feat(gateway): apply graph predicate as post-filter in watcher engine"
```

---

## Task 9: Wire Config Flag Into Engine Caller

**Files:**
- Modify: whichever file currently invokes `evaluateWatchersAfterSync` / `evaluateWatchersStartupCatchUp` (discover via grep)

- [ ] **Step 1: Find the call sites**

```bash
bun x biome check --help > /dev/null 2>&1 || true
```

Use the Grep tool:

```
grep -rn "evaluateWatchersAfterSync\|evaluateWatchersStartupCatchUp" packages/gateway/src
```

Expected: 2-4 call sites (likely `sync/`, `server.ts`, startup init).

- [ ] **Step 2: Load `[automation]` config at the call-site layer and forward the flag**

At each call site:
1. Locate where `NimbusToml` / related config is already loaded for that module.
2. Additionally load the automation section via `loadNimbusAutomationFromConfigDir(configDir)` (or from the pre-parsed raw TOML if one is already in hand; prefer a single config load per module — do not re-read disk per call).
3. Pass `{ graphConditionsEnabled: automationConfig.graphConditions }` as the 4th argument.

Exact edit pattern per call site (adapt variable names to locals):

```ts
import { loadNimbusAutomationFromConfigDir } from "../config/nimbus-toml.ts";

// During module init (once):
const automation = loadNimbusAutomationFromConfigDir(configDir);

// At the call site:
evaluateWatchersAfterSync(db, serviceId, Date.now(), notify, {
  graphConditionsEnabled: automation.graphConditions,
});
```

If no call site can reasonably reach `configDir` (e.g., pure test harnesses), pass no options — the engine defaults to `true`, matching the TOML default.

- [ ] **Step 3: Typecheck + unit tests**

```bash
bun run typecheck
bun test packages/gateway/src/automation/ packages/gateway/src/config/
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add -p  # Stage only the call-site changes.
git commit -m "feat(gateway): forward [automation].graph_conditions into watcher-engine calls"
```

---

## Task 10: IPC Handlers — `watcher.validateCondition` + `watcher.listCandidateRelations`

**Files:**
- Modify: `packages/gateway/src/ipc/automation-rpc.ts`
- Modify: `packages/gateway/src/ipc/lan-rpc.ts` (extend forbidden-list metadata if required — see Step 5)
- Create: `packages/gateway/src/ipc/automation-rpc.test.ts` (only if no test file exists yet; check before creating)

- [ ] **Step 1: Decide where the dispatcher tests live**

```bash
ls packages/gateway/src/ipc/automation-rpc.test.ts 2>/dev/null || echo "missing"
ls packages/gateway/test/ipc/automation-rpc.test.ts 2>/dev/null || echo "missing"
```

If neither exists, create `packages/gateway/src/ipc/automation-rpc.test.ts`. Otherwise, append to the existing one.

- [ ] **Step 2: Write failing IPC tests**

In the test file (create or append), add:

```ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  deterministicGraphEntityId,
  upsertGraphEntity,
  upsertGraphRelation,
} from "../graph/relationship-graph.ts";
import { LocalIndex } from "../index/local-index.ts";
import { dispatchAutomationRpc } from "./automation-rpc.ts";

function seededDb(): Database {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return db;
}

describe("watcher.listCandidateRelations", () => {
  test("returns the three logical kinds with underlying relation types", () => {
    const db = seededDb();
    const out = dispatchAutomationRpc({
      method: "watcher.listCandidateRelations",
      params: {},
      db,
    });
    expect(out.kind).toBe("hit");
    if (out.kind !== "hit") return;
    const value = out.value as {
      relations: Array<{ relation: string; underlyingRelationTypes: string[] }>;
    };
    const kinds = value.relations.map((r) => r.relation).sort();
    expect(kinds).toEqual(["downstream_of", "owned_by", "upstream_of"]);
    for (const r of value.relations) {
      expect(r.underlyingRelationTypes.length).toBeGreaterThan(0);
    }
  });
});

describe("watcher.validateCondition", () => {
  test("returns matchCount = 0 when graph has no edges", () => {
    const db = seededDb();
    const out = dispatchAutomationRpc({
      method: "watcher.validateCondition",
      params: {
        graphPredicateJson: JSON.stringify({
          relation: "owned_by",
          target: { type: "person", externalId: "gh:unknown" },
        }),
        sinceMs: 0,
      },
      db,
    });
    expect(out.kind).toBe("hit");
    if (out.kind !== "hit") return;
    expect((out.value as { matchCount: number }).matchCount).toBe(0);
  });

  test("counts items matching the predicate within the since window", () => {
    const db = seededDb();
    const t0 = 1_700_000_000_000;
    db.run(
      `INSERT INTO item (id, service, type, external_id, title, modified_at, synced_at)
       VALUES ('i1', 'github', 'pr', 'pr-1', 'feature', ?, ?)`,
      [t0 + 1000, t0 + 1000],
    );
    const personId = upsertGraphEntity(db, {
      type: "person",
      externalId: "gh:7",
      label: "Dev",
      service: "github",
    });
    const prId = upsertGraphEntity(db, {
      type: "pr",
      externalId: "pr-1",
      label: "feature",
      service: "github",
    });
    upsertGraphRelation(db, personId, prId, "authored", t0);

    const out = dispatchAutomationRpc({
      method: "watcher.validateCondition",
      params: {
        graphPredicateJson: JSON.stringify({
          relation: "owned_by",
          target: { type: "person", externalId: "gh:7" },
        }),
        sinceMs: t0,
      },
      db,
    });
    expect(out.kind).toBe("hit");
    if (out.kind !== "hit") return;
    expect((out.value as { matchCount: number }).matchCount).toBe(1);
  });

  test("rejects malformed graphPredicateJson with RPC error -32602", () => {
    const db = seededDb();
    expect(() =>
      dispatchAutomationRpc({
        method: "watcher.validateCondition",
        params: { graphPredicateJson: "not-json", sinceMs: 0 },
        db,
      }),
    ).toThrow(/graph_predicate_json|JSON|relation/i);
  });

  test("does not leak item content in the response (matchCount only)", () => {
    const db = seededDb();
    db.run(
      `INSERT INTO item (id, service, type, external_id, title, modified_at, synced_at)
       VALUES ('i1', 'github', 'pr', 'pr-1', 'SECRET_TOKEN_xyz', ?, ?)`,
      [1_700_001_000_000, 1_700_001_000_000],
    );
    const personId = upsertGraphEntity(db, {
      type: "person",
      externalId: "gh:1",
      label: "x",
      service: "github",
    });
    const prId = upsertGraphEntity(db, {
      type: "pr",
      externalId: "pr-1",
      label: "SECRET_TOKEN_xyz",
      service: "github",
    });
    upsertGraphRelation(db, personId, prId, "authored", 1_700_000_000_000);
    const out = dispatchAutomationRpc({
      method: "watcher.validateCondition",
      params: {
        graphPredicateJson: JSON.stringify({
          relation: "owned_by",
          target: { type: "person", externalId: "gh:1" },
        }),
        sinceMs: 1_700_000_000_000,
      },
      db,
    });
    expect(out.kind).toBe("hit");
    const json = JSON.stringify(out.kind === "hit" ? out.value : {});
    expect(json).not.toContain("SECRET_TOKEN_xyz");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test packages/gateway/src/ipc/automation-rpc.test.ts
```

Expected: FAIL — methods return `{ kind: "miss" }`.

- [ ] **Step 4: Add the handlers**

In `packages/gateway/src/ipc/automation-rpc.ts`:

a) Add imports at the top (alphabetized with the existing imports):

```ts
import {
  countItemsMatchingGraphPredicate,
  listCandidateGraphRelations,
  parseGraphPredicate,
} from "../automation/graph-predicate.ts";
```

b) Add a `requireNumber` helper alongside `requireString`:

```ts
function requireNumber(rec: Record<string, unknown> | undefined, key: string): number {
  if (rec === undefined) {
    throw new AutomationRpcError(-32602, `Missing or invalid ${key}`);
  }
  const v = rec[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new AutomationRpcError(-32602, `Missing or invalid ${key}`);
  }
  return v;
}
```

c) Insert the two cases into the `switch (method)` block, just after `case "watcher.resume"`:

```ts
    case "watcher.listCandidateRelations":
      return {
        kind: "hit",
        value: { relations: listCandidateGraphRelations() },
      };

    case "watcher.validateCondition": {
      const graphPredicateJson = requireString(rec, "graphPredicateJson");
      const sinceMs = requireNumber(rec, "sinceMs");
      const parsed = parseGraphPredicate(graphPredicateJson);
      if (!parsed.ok) {
        throw new AutomationRpcError(-32602, parsed.error);
      }
      const matchCount = countItemsMatchingGraphPredicate({
        db,
        predicate: parsed.predicate,
        sinceMs,
      });
      return { kind: "hit", value: { matchCount } };
    }
```

- [ ] **Step 5: Review LAN RPC allow/forbid list**

Read `packages/gateway/src/ipc/lan-rpc.ts`. Both new methods are **read-only** and do not touch vault or audit. Leave them **allowed** for LAN peers — do NOT add them to the forbidden list. Confirm by skimming the surrounding context; if an allow/forbid doc-comment exists, follow its convention.

- [ ] **Step 6: Run tests**

```bash
bun test packages/gateway/src/ipc/
bun run typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/ipc/automation-rpc.ts packages/gateway/src/ipc/automation-rpc.test.ts
git commit -m "feat(gateway): add watcher.validateCondition + watcher.listCandidateRelations IPCs"
```

---

## Task 11: Tauri `ALLOWED_METHODS` — Add the Two IPCs

**Files:**
- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs`

- [ ] **Step 1: Insert the two methods in alphabetical order**

In `ALLOWED_METHODS` (currently starts at line 63), add:

```rust
    "watcher.listCandidateRelations",
    "watcher.validateCondition",
```

Placement: after `"updater.rollback"` and before the array closer `]`. Confirm alphabetic order is preserved.

- [ ] **Step 2: Update the exact-size assertion**

In the `allowlist_exact_size` test (line ~414), bump from 38 to 40 and update the rationale comment:

```rust
    #[test]
    fn allowlist_exact_size() {
        // Plan 2 added 37 methods (spec miscounted connector.listStatus as a new addition —
        // it was already in WS5-B). Plan 3 adds llm.getStatus → 38.
        // Phase 4 Section 2 adds watcher.validateCondition +
        // watcher.listCandidateRelations → 40.
        assert_eq!(ALLOWED_METHODS.len(), 40);
    }
```

- [ ] **Step 3: Run Rust tests**

```bash
cd packages/ui/src-tauri
cargo test --quiet gateway_bridge
cd ../../..
```

Expected: `allowlist_exact_size`, `allowlist_is_alphabetized`, `allowlist_has_no_duplicates` all green.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src-tauri/src/gateway_bridge.rs
git commit -m "feat(ui/tauri): allow watcher.validateCondition + watcher.listCandidateRelations"
```

---

## Task 12: Coverage Gate Verification

**Files:** none (verification only).

- [ ] **Step 1: Run the automation coverage gate**

Look up the command in `package.json`:

```bash
bun run | grep -i "coverage" | head -20
```

If there is no dedicated `test:coverage:automation` script, run the engine gate plus a targeted pass:

```bash
bun run test:coverage
```

Expected: `packages/gateway/src/automation/` coverage ≥ 80% lines / ≥ 80% branches (per spec).

- [ ] **Step 2: If coverage drops below 80%, extend tests**

Add tests for any uncovered branches surfaced in the coverage report. Common gaps:
- `parseGraphPredicate` error branches (already covered in Task 5, but double-check).
- `itemMatchesGraphPredicate` when `resolveStartEntityId` returns null.
- `countItemsMatchingGraphPredicate` with `maxScan` override.

Commit any added tests separately:

```bash
git add packages/gateway/src/automation/
git commit -m "test(gateway): restore ≥80% coverage on automation package after S2"
```

---

## Task 13: Amend the Phase 4 Completion Spec (Version-Drift Fix)

**Files:**
- Modify: `docs/superpowers/specs/2026-04-21-phase-4-completion-design.md`

- [ ] **Step 1: Update the S2 migration reference**

In Section 2 of the spec:
- Replace "Schema migration **V20:**" with "Schema migration **V22:**".
- Replace `packages/gateway/src/index/watchers-v20-sql.ts` with `packages/gateway/src/index/watcher-graph-v22-sql.ts` (also matches the singular table name `watcher`).

- [ ] **Step 2: Update the S3 migration reference (for the next section)**

In Section 3 of the spec:
- Replace "Schema migration **V21:**" with "Schema migration **V23:**".
- Replace `packages/gateway/src/index/workflow-v21-sql.ts` with `packages/gateway/src/index/workflow-branching-v23-sql.ts`.

- [ ] **Step 3: Add a brief changelog note**

At the end of Section 1 of the spec (or as a new "Spec Amendments" sub-heading just before Section 2), add:

```markdown
#### Spec Amendment 2026-04-22

Between spec authorship (2026-04-21) and Section 2 execution, migrations
V20 (`llm_task_defaults`) and V21 (`sync_state.depth`) landed on `main`.
S2's watcher-graph migration is therefore numbered **V22**; S3's workflow
branching migration will be **V23**. All other S2/S3 scope is unchanged.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-21-phase-4-completion-design.md
git commit -m "docs(spec): renumber S2/S3 migrations to V22/V23 (V20/V21 taken on main)"
```

---

## Task 14: Docs — Architecture, CLAUDE.md, GEMINI.md

**Files:**
- Modify: `docs/architecture.md`
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Add a graph-aware-watcher example to `docs/architecture.md`**

Find the Watchers subsystem section (grep for "Watchers" as a heading). Append a small example:

```markdown
#### Graph-aware watcher example (Phase 4 §2)

A watcher can additionally reference the relationship graph to narrow when it
fires. For example, "alert any PagerDuty incident *owned by me*":

```json
{
  "condition_type": "alert_fired",
  "condition_json": { "filter": { "service": "pagerduty" } },
  "graph_predicate_json": {
    "relation": "owned_by",
    "target": { "type": "person", "externalId": "gh:42" }
  }
}
```

Logical relation kinds map to concrete `graph_relation.type` edges:

- `owned_by`      → `authored` | `opened` | `posted`
- `upstream_of`   → item → target via `belongs_to` / `targets` / `in_repo` / `defined_in` / `depends_on`
- `downstream_of` → target → item via the same set (direction reversed)

The feature is gated by `[automation].graph_conditions = true` in `nimbus.toml`
(default enabled for v0.1.0).
```

- [ ] **Step 2: Update the key-files table in `CLAUDE.md`**

Add these rows (alphabetized with surrounding entries in the file):

```markdown
| `packages/gateway/src/automation/graph-predicate.ts` | Graph predicate types, parser, evaluator; `parseGraphPredicate` / `itemMatchesGraphPredicate` / `countItemsMatchingGraphPredicate` / `listCandidateGraphRelations` |
| `packages/gateway/src/automation/watcher-engine.ts` | Watcher evaluation loop; applies `graph_predicate_json` as a post-filter when `[automation].graph_conditions = true` |
| `packages/gateway/src/index/watcher-graph-v22-sql.ts` | V22 migration — `watcher.graph_predicate_json` column |
```

Update the Phase 4 status line near the top (search for "WS5-C ✅"). It becomes:

```
Phase 3.5 ✅ Complete; **Phase 4** — Presence 🔵 Active (WS1–4 ✅ · WS5-A ✅ · WS5-B ✅ · WS5-C ✅ · S2 graph-aware watchers ✅)
```

Update the bun-scripts section only if you added a new coverage script; otherwise leave alone.

- [ ] **Step 3: Mirror the `CLAUDE.md` changes into `GEMINI.md`**

Apply the exact same edits to `GEMINI.md` — the file is a byte-level mirror of `CLAUDE.md` except for the Gemini-specific header.

- [ ] **Step 4: Update `docs/roadmap.md`**

In the Phase 4 / WS-automation row, add a line item:

```markdown
- [x] A.1 — Graph-aware watcher conditions (Phase 4 S2): `owned_by` / `upstream_of` / `downstream_of` logical relations; `[automation].graph_conditions` flag; V22 migration.
```

Update the "Last updated" date line at the top of the file to today's date (`2026-04-22`).

- [ ] **Step 5: Commit docs**

```bash
git add docs/architecture.md CLAUDE.md GEMINI.md docs/roadmap.md
git commit -m "docs: document graph-aware watcher conditions (Phase 4 S2)"
```

---

## Task 15: Pre-PR Quality Gates

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + lint**

```bash
bun run typecheck
bun run lint
```

Expected: both green. If `lint` produces warnings in files you touched, fix them; don't suppress.

- [ ] **Step 2: Full unit suite**

```bash
bun test
```

Expected: all tests green.

- [ ] **Step 3: Rust-side test**

```bash
cd packages/ui/src-tauri
cargo test --quiet
cd ../../..
```

Expected: green. (Tauri build itself is NOT required for this PR — only `cargo test`.)

- [ ] **Step 4: Push branch + confirm CI is green**

```bash
git push -u origin dev/asafgolombek/phase4-s2-watcher-graph
```

Wait for GitHub Actions `pr-quality` + 3-OS matrix to finish. Expected: green on Ubuntu (blocking) and all three OSes on push.

---

## Task 16: Open Pull Request

**Files:** none (GitHub only).

- [ ] **Step 1: Open the PR**

Use `gh pr create` with the body below:

```bash
gh pr create --title "feat: Phase 4 §S2 — A.1 graph-aware watcher conditions" --body "$(cat <<'EOF'
## Summary

- Add `watcher.graph_predicate_json` column (V22 migration) and a typed `GraphPredicate` evaluator (`owned_by` / `upstream_of` / `downstream_of`) wired into `watcher-engine.ts` as a post-filter.
- New IPC handlers: `watcher.validateCondition` (preview count, no content leak) and `watcher.listCandidateRelations` (UI dropdown source). Exposed via Tauri allowlist (38 → 40, assertion updated).
- Feature flag `[automation].graph_conditions` (default `true` for v0.1.0) loaded via a new TOML section.
- Spec amended inline: S2 migration renumbered **V20 → V22**, S3 flagged **V21 → V23**, because V20/V21 landed on main between spec authorship (2026-04-21) and execution.

## Test plan

- [x] `bun test packages/gateway/src/index/migrations/runner-v22.test.ts`
- [x] `bun test packages/gateway/src/automation/graph-predicate.test.ts`
- [x] `bun test packages/gateway/src/automation/watcher-engine.test.ts`
- [x] `bun test packages/gateway/src/ipc/automation-rpc.test.ts`
- [x] `bun test packages/gateway/src/config/nimbus-toml-automation.test.ts`
- [x] `cd packages/ui/src-tauri && cargo test gateway_bridge`
- [x] `bun run typecheck && bun run lint`
- [x] Manual smoke: watcher with `graph_predicate_json` fires when seeded person-authored alert appears; does not fire for unrelated authors.
- [x] Secret-leak assertion: `watcher.validateCondition` response contains no item content (only `matchCount`).

Closes the S2 row of `docs/superpowers/specs/2026-04-21-phase-4-completion-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Capture it in your clipboard for the user.

- [ ] **Step 2: Paste the PR URL into the session**

Return the PR URL to the user for review.

---

## Self-Review Notes (post-authorship)

The author (Claude) ran a fresh-eyes pass over this plan against the Section 2 spec. Results:

- **Spec coverage:** ✅ Every S2 spec bullet has a corresponding task. Migration renumbered V20→V22 explicitly (Task 13). IPC methods, feature flag, new files, modified files, acceptance criteria (≥80% automation coverage, migration reversibility via existing backup path, no-secret-leak) all present.
- **Placeholder scan:** ✅ No "TBD" / "similar to above" / bare "add appropriate …" steps. Every code step contains runnable code.
- **Type consistency:** ✅ `GraphPredicate` / `GraphTarget` / `CandidateRelation` / `WatcherEvalOptions` names used identically across tasks. `graph_predicate_json` column / `graphPredicateJson` param name distinction is intentional (SQL snake_case vs. IPC camelCase — matches existing Nimbus conventions).
- **Ambiguity check:** ✅ Every task either edits in a specific spot or provides a code block copy-pasteable into the file. The only deliberately under-specified step is Task 9 Step 2 ("pass no options" when `configDir` is unreachable) — that escape hatch is explicit and justified.

No inline fixes required.

---

## Open Decisions (none blocking)

None. The plan follows the spec verbatim apart from the mandatory V20→V22 / V21→V23 version-number fix.

---

## Review Response — 2026-04-22 (external review `2026-04-22-phase4-s2-watcher-graph-review.md`)

Claims were verified against `main` before accepting or deferring. Each disposition is justified below.

### Fixed inline

- **Sugg 4 — "update verify.ts / schema snapshot":** partial valid core. The reviewer named the wrong file (`verify.ts` is already parameterised — it takes `expectedVersion` from the caller), but the underlying concern was real: `CURRENT_SCHEMA_VERSION = 21` in `local-index.ts:267` is the load-bearing constant. Without bumping it, `LocalIndex.ensureSchema()` stops at V21 and V22 becomes dead code at runtime. **Added Task 2b.** This is the single most important review outcome — omitting it would have been a latent bug.

- **Sugg 3 — "log on predicate parse failure":** accepted as a minimal `console.error` in Task 8 Step 3d. No new logger, no new `watcher_event` row. Primary defence remains UI preflight via `watcher.validateCondition`.

### Deferred with justification

- **Q1 / Q2 — perf, SQL-level JOIN, checkDirectEdge helper:** Deferred.
  - Candidate scan is hard-capped at 5 alerts per watcher per sync (existing `LIMIT 5` in the engine SELECT).
  - `graph_relation` has indexes on both `from_id` and `to_id` (graph-v7-sql.ts:32-33). Each `traverseGraph(depth=1)` call becomes ~2 indexed lookups.
  - Worst-case for 50 enabled watchers is ~500 indexed edge reads per sync cycle — well below user-perceptible thresholds.
  - The spec explicitly says "reuse existing `traverseGraph`" (Section 2 scope). A `checkDirectEdge` helper is a valid future optimisation but violates the spec as written. If profiling ever shows this as hot, it's a ~20-line follow-up.

- **Q3 — "return sample titles from `watcher.validateCondition`":** Deferred to Section 5 (Watchers UI). The spec acceptance criterion is `matchCount`; sample titles are a UI-driven nice-to-have that should be designed together with the Condition Builder preview panel. Adding them now would also invalidate the schema-boundary assertion in Task 10 Step 2 test (`json not to contain item content`) — that assertion is deliberately narrow to catch accidental schema growth, and we'd want a UI spec in hand before relaxing it.

- **Q4 — "stale graph entities between sync and watcher eval":** Not an issue on verification.
  - `item-store.ts:105` calls `syncGraphFromIndexedItem` synchronously inside `upsertIndexedItem`.
  - `platform/assemble.ts:191` calls `evaluateWatchersAfterSync` only after the sync pass completes.
  - Ordering is naturally guaranteed at the "all items in this sync pass have their graph edges written before watcher eval" level. No delay or re-check needed.
  - Separate (pre-existing) gap surfaced during verification: `graph-populator.ts` has no handler for `alert` type even though `alert` is in `ITEM_LINKED_ENTITY_TYPES`. This means `owned_by` predicates on alerts will return `matchCount = 0` until alert-graph population is added. This is out of scope for S2 (watcher-layer plumbing only); captured as a post-v0.1.0 follow-up.

- **Sugg 1 — "checkDirectEdge helper":** Duplicate of Q1/Q2. Deferred with the same justification.

- **Sugg 2 — "add a `version` discriminator to `graph_predicate_json`":** Deferred. YAGNI under the project's "no hypothetical future requirements" rule (`CLAUDE.md` system prompt). The column stores arbitrary JSON, so future `v2` predicates (AND/OR/NOT) can add a `version` discriminator at that time — no schema migration required. Adding it prophylactically now does nothing concrete except expand test surface.

### Not accepted

None. Every claim was either addressed or justifiably deferred.

### Summary

- **1 real fix** (Task 2b — schema constant bump) — load-bearing, would have been a latent bug.
- **1 small hardening** (Task 8 — `console.error` on parse failure) — low cost, improves operator UX.
- **6 deferred items** — either scope creep beyond spec, YAGNI, or verified-false on the code.

Plan remains aligned with the spec's "ship as spec'd" directive.
