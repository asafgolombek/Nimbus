import { describe, expect, test } from "bun:test";
import { checkLanMethodAllowed, LanError } from "./lan-rpc.ts";

describe("checkLanMethodAllowed", () => {
  test("allows read methods without grant-write", () => {
    expect(() =>
      checkLanMethodAllowed("index.search", { peerId: "p", writeAllowed: false }),
    ).not.toThrow();
  });

  test("rejects forbidden namespaces regardless of grant-write", () => {
    for (const method of ["vault.list", "updater.checkNow", "lan.grantWrite", "profile.create"]) {
      expect(() => checkLanMethodAllowed(method, { peerId: "p", writeAllowed: true })).toThrow(
        LanError,
      );
    }
  });

  test("rejects write method without grant — rpcCode -32603", () => {
    try {
      checkLanMethodAllowed("engine.ask", { peerId: "p", writeAllowed: false });
      throw new Error("expected");
    } catch (err) {
      expect(err).toBeInstanceOf(LanError);
      expect((err as LanError).rpcCode).toBe(-32603);
      expect((err as LanError).message).toMatch(/ERR_LAN_WRITE_FORBIDDEN/);
    }
  });

  test("allows write method with grant", () => {
    expect(() =>
      checkLanMethodAllowed("engine.ask", { peerId: "p", writeAllowed: true }),
    ).not.toThrow();
  });
});
