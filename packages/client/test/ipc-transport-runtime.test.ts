import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ipc-transport runtime detection", () => {
  test("source contains both Bun and Node Unix branches", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "src", "ipc-transport.ts"),
      "utf8",
    );
    expect(src).toContain("connectUnixBun");
    expect(src).toContain("connectUnixNode");
    expect(src).toContain("HAS_BUN");
  });
});
