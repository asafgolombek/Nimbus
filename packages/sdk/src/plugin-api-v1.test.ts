import { describe, expect, test } from "bun:test";
import type {
  AuditEmit,
  AuditLogger,
  ExtensionManifest,
  HitlRequest,
  NimbusItem,
} from "./index.ts";
import {
  createScopedAuditLogger,
  ExtensionContractError,
  isHitlRequest,
  MockGateway,
  NimbusExtensionServer,
  runContractTests,
} from "./index.ts";

describe("Plugin API v1 — stable surface", () => {
  test("every v1 export is reachable from the package root", () => {
    expect(typeof createScopedAuditLogger).toBe("function");
    expect(typeof isHitlRequest).toBe("function");
    expect(typeof runContractTests).toBe("function");
    expect(typeof NimbusExtensionServer).toBe("function");
    expect(typeof MockGateway).toBe("function");
    expect(typeof ExtensionContractError).toBe("function");
  });

  test("v1 types can be used in user code", () => {
    const manifest: ExtensionManifest = {
      id: "ext.example",
      displayName: "Example",
      version: "0.1.0",
      description: "Example extension",
      author: "Nimbus",
      entrypoint: "index.ts",
      runtime: "bun",
      permissions: [],
      hitlRequired: [],
      minNimbusVersion: "0.1.0",
    };
    const item: NimbusItem = { id: "x", service: "test", itemType: "file", name: "n" };
    const emit: AuditEmit = async () => {};
    const logger: AuditLogger = createScopedAuditLogger(manifest.id, emit);
    const hitl: HitlRequest = { actionId: "delete", summary: "Delete one file" };
    expect(manifest.id).toBe("ext.example");
    expect(item.service).toBe("test");
    expect(logger).toBeDefined();
    expect(isHitlRequest(hitl)).toBe(true);
  });
});
