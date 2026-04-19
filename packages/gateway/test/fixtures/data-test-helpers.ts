import { Database } from "bun:sqlite";
import { LocalIndex } from "../../src/index/local-index.ts";
import type { NimbusVault } from "../../src/vault/nimbus-vault.ts";

export function memVault(): NimbusVault {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    },
    listKeys: async (prefix) =>
      [...m.keys()].filter((k) => (prefix === undefined ? true : k.startsWith(prefix))),
  };
}

export function newIndex(): LocalIndex {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return new LocalIndex(db);
}
