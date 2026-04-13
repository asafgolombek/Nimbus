import { describe, expect, test } from "bun:test";

import { parseExtensionManifestJson } from "./manifest.ts";

describe("parseExtensionManifestJson", () => {
  test("parses minimal manifest", () => {
    const m = parseExtensionManifestJson(JSON.stringify({ id: "x", version: "1.0.0" }));
    expect(m).toEqual({ id: "x", version: "1.0.0" });
  });

  test("rejects invalid JSON", () => {
    expect(() => parseExtensionManifestJson("{")).toThrow(/not valid JSON/);
  });

  test("rejects non-object", () => {
    expect(() => parseExtensionManifestJson("[]")).toThrow(/JSON object/);
  });

  test("rejects missing id or version", () => {
    expect(() => parseExtensionManifestJson(JSON.stringify({ id: "" }))).toThrow(/id and version/);
  });
});
