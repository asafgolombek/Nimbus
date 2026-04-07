import { describe, expect, it } from "bun:test";

/**
 * Placeholder test — verifies the PAL module loads without errors.
 * Replace with real platform tests in Q1.
 */
describe("Platform Abstraction Layer", () => {
  it("createPlatformServices is exported", async () => {
    const { createPlatformServices } = await import("./index.ts");
    expect(typeof createPlatformServices).toBe("function");
  });
});
