import { beforeEach, describe, expect, test } from "bun:test";
import { memVault, newIndex } from "../../test/fixtures/data-test-helpers.ts";
import type { LocalIndex } from "../index/local-index.ts";
import { runDataDelete } from "./data-delete.ts";

function seed(idx: LocalIndex, service: string, count: number): void {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    idx.rawDb.run(
      `INSERT INTO item (id, service, type, external_id, title, modified_at, synced_at, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${service}-${String(i)}`,
        service,
        "test",
        `ext-${String(i)}`,
        `item-${String(i)}`,
        now,
        now,
        0,
      ],
    );
  }
}

describe("data delete", () => {
  let vault: NimbusVault;
  let idx: LocalIndex;
  beforeEach(() => {
    vault = memVault();
    idx = newIndex();
  });

  test("--dry-run reports counts and does not delete", async () => {
    seed(idx, "github", 3);
    seed(idx, "slack", 2);
    await vault.set("github.pat", "secret_value_xyz");

    const result = await runDataDelete({
      service: "github",
      dryRun: true,
      vault,
      index: idx,
    });
    expect(result.preflight.itemsToDelete).toBe(3);
    expect(result.preflight.vaultEntriesToDelete).toBe(1);
    expect(result.deleted).toBe(false);
    expect(
      idx.rawDb.query(`SELECT COUNT(*) AS c FROM item WHERE service = 'github'`).get(),
    ).toEqual({ c: 3 });
  });

  test("confirmed deletion removes items + vault keys for the service only", async () => {
    seed(idx, "github", 3);
    seed(idx, "slack", 2);
    await vault.set("github.pat", "secret_value_xyz");
    await vault.set("slack.token", "keep_this");

    const result = await runDataDelete({
      service: "github",
      dryRun: false,
      vault,
      index: idx,
    });
    expect(result.deleted).toBe(true);
    expect(
      idx.rawDb.query(`SELECT COUNT(*) AS c FROM item WHERE service = 'github'`).get(),
    ).toEqual({ c: 0 });
    expect(idx.rawDb.query(`SELECT COUNT(*) AS c FROM item WHERE service = 'slack'`).get()).toEqual(
      { c: 2 },
    );
    expect(await vault.get("github.pat")).toBeNull();
    expect(await vault.get("slack.token")).toBe("keep_this");
  });

  test("writes a signed deletion record to audit_log", async () => {
    seed(idx, "github", 1);
    await runDataDelete({ service: "github", dryRun: false, vault, index: idx });
    const rows = idx.listAuditWithChain(10);
    expect(rows.some((r) => r.actionType === "data.delete")).toBe(true);
  });
});
