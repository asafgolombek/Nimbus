import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LocalIndex } from "../index/local-index.ts";
import { dispatchReindexRpc, ReindexRpcError } from "./reindex-rpc.ts";

function makeIdx(): LocalIndex {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return new LocalIndex(db);
}

describe("dispatchReindexRpc", () => {
  test("returns miss for non-reindex method", async () => {
    const out = await dispatchReindexRpc("foo.bar", {}, { index: makeIdx() });
    expect(out.kind).toBe("miss");
  });

  test("connector.reindex forwards to reindexConnector", async () => {
    const idx = makeIdx();
    const out = await dispatchReindexRpc(
      "connector.reindex",
      { service: "github", depth: "metadata_only" },
      { index: idx },
    );
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const value = out.value as { itemsAffected: number };
      expect(value.itemsAffected).toBe(0);
    }
  });

  test("throws ReindexRpcError when service param missing", async () => {
    const idx = makeIdx();
    await expect(
      dispatchReindexRpc("connector.reindex", { depth: "metadata_only" }, { index: idx }),
    ).rejects.toBeInstanceOf(ReindexRpcError);
  });
});
