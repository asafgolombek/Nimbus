import { describe, expect, test } from "bun:test";

import { ExtensionContractError, runContractTests } from "./contract-tests.ts";
import type { ExtensionManifest } from "./types.ts";

const base = (): ExtensionManifest => ({
  id: "demo.ext",
  displayName: "Demo",
  version: "0.1.0",
  description: "Demo extension",
  author: "nimbus",
  entrypoint: "dist/index.js",
  runtime: "bun",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "0.1.0",
});

describe("runContractTests", () => {
  test("accepts a minimal valid manifest", () => {
    expect(() => runContractTests(base())).not.toThrow();
  });

  test("rejects invalid permission", () => {
    const m = base();
    m.permissions = ["read", "admin"] as ExtensionManifest["permissions"];
    expect(() => runContractTests(m)).toThrow(ExtensionContractError);
  });
});

describe("runContractTests — v1 additions", () => {
  test("v1 contract passes against a minimal extension manifest", () => {
    expect(() =>
      runContractTests({
        id: "ext.v1-smoke",
        displayName: "V1 Smoke",
        version: "0.1.0",
        description: "Smoke test extension",
        author: "Nimbus",
        entrypoint: "index.ts",
        runtime: "bun",
        permissions: [],
        hitlRequired: [],
        minNimbusVersion: "0.1.0",
      }),
    ).not.toThrow();
  });
});
