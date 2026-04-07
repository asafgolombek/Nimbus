import { describe, expect, test } from "bun:test";
import { NimbusExtensionServer } from "./server";

describe("@nimbus-dev/sdk", () => {
  test("NimbusExtensionServer is constructible", () => {
    const server = new NimbusExtensionServer({
      manifest: {
        id: "test.ext",
        displayName: "Test",
        version: "0.0.1",
        description: "test",
        author: "test",
        entrypoint: "dist/server.js",
        runtime: "bun",
        permissions: ["read"],
        hitlRequired: [],
        minNimbusVersion: "0.1.0",
      },
    });
    expect(server).toBeDefined();
  });
});
