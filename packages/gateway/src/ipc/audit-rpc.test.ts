import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LocalIndex } from "../index/local-index.ts";
import { AuditRpcError, dispatchAuditRpc } from "./audit-rpc.ts";

function seededIndex(): LocalIndex {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  const idx = new LocalIndex(db);
  idx.recordAudit({ actionType: "x", hitlStatus: "approved", actionJson: "{}", timestamp: 1 });
  return idx;
}

describe("dispatchAuditRpc", () => {
  test("returns miss for non-audit method", async () => {
    const out = await dispatchAuditRpc("foo.bar", {}, { index: seededIndex() });
    expect(out.kind).toBe("miss");
  });

  test("audit.verify returns { ok: true, verifiedRows: 1 }", async () => {
    const idx = seededIndex();
    const out = await dispatchAuditRpc("audit.verify", {}, { index: idx });
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const value = out.value as { ok: boolean; verifiedRows: number };
      expect(value.ok).toBe(true);
      expect(value.verifiedRows).toBe(1);
    }
  });

  test("audit.verify --full reruns from 0 regardless of cursor", async () => {
    const idx = seededIndex();
    idx.setAuditVerifiedThroughId(999);
    const out = await dispatchAuditRpc("audit.verify", { full: true }, { index: idx });
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      expect((out.value as { verifiedRows: number }).verifiedRows).toBe(1);
    }
  });

  test("audit.exportAll returns every row with chain fields", async () => {
    const out = await dispatchAuditRpc("audit.exportAll", {}, { index: seededIndex() });
    expect(out.kind).toBe("hit");
    if (out.kind === "hit") {
      const rows = out.value as Array<{ rowHash: string; prevHash: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rowHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("throws AuditRpcError when index not configured", async () => {
    await expect(dispatchAuditRpc("audit.verify", {}, { index: undefined })).rejects.toBeInstanceOf(
      AuditRpcError,
    );
  });
});
