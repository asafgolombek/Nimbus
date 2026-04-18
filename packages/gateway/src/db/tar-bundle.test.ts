import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packBundle, unpackBundle } from "./tar-bundle.ts";

describe("tar bundle", () => {
  test("packs and unpacks a directory round-trip", async () => {
    const src = mkdtempSync(join(tmpdir(), "nimbus-bundle-src-"));
    writeFileSync(join(src, "a.txt"), "hello");
    writeFileSync(join(src, "b.json"), '{"x":1}');
    const out = join(mkdtempSync(join(tmpdir(), "nimbus-bundle-out-")), "bundle.tar.gz");
    await packBundle(src, out);
    expect(existsSync(out)).toBe(true);

    const extractTo = mkdtempSync(join(tmpdir(), "nimbus-bundle-extract-"));
    await unpackBundle(out, extractTo);
    expect(readFileSync(join(extractTo, "a.txt"), "utf8")).toBe("hello");
    expect(readFileSync(join(extractTo, "b.json"), "utf8")).toBe('{"x":1}');
  });
});
