import { describe, expect, test } from "bun:test";

describe("cli integration smoke", () => {
  test("ipc-client module loads", async () => {
    const mod = await import("../../src/ipc-client/index.ts");
    expect(mod.IPCClient).toBeDefined();
  });
});
