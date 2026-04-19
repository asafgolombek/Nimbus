import { describe, expect, test } from "bun:test";
import { createScopedAuditLogger } from "./audit-logger.ts";

describe("createScopedAuditLogger", () => {
  test("prefixes action with extension ID", async () => {
    const calls: Array<{ action: string; payload: Record<string, unknown> }> = [];
    const emit = async (action: string, payload: Record<string, unknown>): Promise<void> => {
      calls.push({ action, payload });
    };
    const logger = createScopedAuditLogger("ext.my-connector", emit);
    await logger.log("sync.completed", { items: 42 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe("ext.my-connector:sync.completed");
    expect(calls[0]?.payload).toEqual({ items: 42 });
  });

  test("rejects action IDs that already contain a colon", async () => {
    const logger = createScopedAuditLogger("ext.foo", async () => {});
    await expect(logger.log("already:scoped", {})).rejects.toThrow(/colon/);
  });

  test("rejects empty action ID", async () => {
    const logger = createScopedAuditLogger("ext.foo", async () => {});
    await expect(logger.log("", {})).rejects.toThrow(/empty/);
  });

  test("propagates emit errors unchanged", async () => {
    const logger = createScopedAuditLogger("ext.foo", async () => {
      throw new Error("downstream");
    });
    await expect(logger.log("x", {})).rejects.toThrow("downstream");
  });
});
