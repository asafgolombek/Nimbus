import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalIndex } from "../index/local-index.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { DataRpcError, dispatchDataRpc } from "./data-rpc.ts";

function newIndex(): LocalIndex {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return new LocalIndex(db);
}

function memVault(): NimbusVault {
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

const testKdf = { t: 1, m: 1024, p: 1 } as const;

describe("dispatchDataRpc", () => {
  test("returns miss for non-data method", async () => {
    const out = await dispatchDataRpc(
      "foo.bar",
      {},
      {
        index: newIndex(),
        vault: memVault(),
        platform: "linux",
        nimbusVersion: "0.1.0",
        kdfParams: testKdf,
      },
    );
    expect(out.kind).toBe("miss");
  });

  test("data.export returns a path and a recovery seed", async () => {
    const out = await dispatchDataRpc(
      "data.export",
      {
        output: join(mkdtempSync(join(tmpdir(), "nimbus-rpc-")), "b.tar.gz"),
        passphrase: "pw",
        includeIndex: false,
      },
      {
        index: newIndex(),
        vault: memVault(),
        platform: "linux",
        nimbusVersion: "0.1.0",
        kdfParams: testKdf,
      },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const value = out.value as { outputPath: string; recoverySeed: string };
      expect(value.outputPath).toMatch(/b\.tar\.gz$/);
      expect(value.recoverySeed.split(" ")).toHaveLength(24);
    }
  });

  test("data.delete with dryRun=true returns preflight and does not delete", async () => {
    const idx = newIndex();
    idx.rawDb.run(
      `INSERT INTO item (id, service, type, external_id, title, modified_at, synced_at, pinned)
       VALUES ('github-1', 'github', 'test', 'ext-1', 't', ?, ?, 0)`,
      [Date.now(), Date.now()],
    );
    const out = await dispatchDataRpc(
      "data.delete",
      { service: "github", dryRun: true },
      {
        index: idx,
        vault: memVault(),
        platform: "linux",
        nimbusVersion: "0.1.0",
        kdfParams: testKdf,
      },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const value = out.value as { deleted: boolean; preflight: { itemsToDelete: number } };
      expect(value.deleted).toBe(false);
      expect(value.preflight.itemsToDelete).toBe(1);
    }
    expect(
      idx.rawDb.query(`SELECT COUNT(*) AS c FROM item WHERE service = 'github'`).get(),
    ).toEqual({ c: 1 });
  });

  test("throws DataRpcError when service param missing on data.delete", async () => {
    await expect(
      dispatchDataRpc(
        "data.delete",
        {},
        {
          index: newIndex(),
          vault: memVault(),
          platform: "linux",
          nimbusVersion: "0.1.0",
          kdfParams: testKdf,
        },
      ),
    ).rejects.toBeInstanceOf(DataRpcError);
  });
});
