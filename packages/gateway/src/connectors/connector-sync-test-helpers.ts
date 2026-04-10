import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";

import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export const EMPTY_NIMBUS_VAULT: NimbusVault = {
  set: async () => {},
  get: async () => null,
  delete: async () => {},
  listKeys: async () => [],
};

export function createMemoryIndexDb(): Database {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return db;
}

export function createStubVault(entries: Readonly<Record<string, string | null>>): NimbusVault {
  return {
    set: async () => {},
    get: async (k: string) => (Object.hasOwn(entries, k) ? (entries[k] ?? null) : null),
    delete: async () => {},
    listKeys: async () => [],
  };
}

export function silentSyncContextExtras(): Pick<SyncContext, "logger" | "rateLimiter"> {
  return {
    logger: pino({ level: "silent" }),
    rateLimiter: new ProviderRateLimiter(),
  };
}

export function expectSyncNoopResult(
  r: Pick<SyncResult, "itemsUpserted" | "itemsDeleted" | "cursor">,
): void {
  expect(r.itemsUpserted).toBe(0);
  expect(r.itemsDeleted).toBe(0);
  expect(r.cursor).toBeNull();
}

export function expectServiceItemCount(db: Database, service: string, count: number): void {
  const row = db.prepare("SELECT COUNT(*) AS c FROM item WHERE service = ?").get(service) as {
    c: number;
  };
  expect(row.c).toBe(count);
}

/** Shared “missing credential → empty sync” case for connector sync unit tests. */
export function testConnectorSyncNoop(
  name: string,
  createSyncable: () => Syncable,
  noopVault: NimbusVault,
): void {
  test(name, async () => {
    const db = createMemoryIndexDb();
    const sync = createSyncable();
    const r = await sync.sync({ vault: noopVault, db, ...silentSyncContextExtras() }, null);
    expectSyncNoopResult(r);
  });
}

/** Alias for `fetch` handler typing in connector sync tests. */
export type SyncTestFetchParams = Parameters<typeof fetch>;

export function urlFromFetchInput(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

/** Connector tests that stub `globalThis.fetch` — restores the original after each case. */
export function describeWithFetchRestore(name: string, fn: () => void): void {
  describe(name, () => {
    const origFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = origFetch;
    });
    fn();
  });
}
