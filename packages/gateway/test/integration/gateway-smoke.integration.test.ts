import { describe, expect, test } from "bun:test";

/**
 * Integration smoke — uses real module graph; avoids importing the Gateway entry
 * (which runs main()). Expand with SQLite + subprocess tests in Q1.
 */
describe("gateway integration smoke", () => {
  test("PAL module loads", async () => {
    const { createPlatformServices } = await import("../../src/platform/index.ts");
    expect(typeof createPlatformServices).toBe("function");
  });
});
