import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LocalIndex } from "../index/local-index.ts";
import type { ConnectorRpcHandlerContext } from "./connector-rpc-handlers.ts";
import { handleConnectorSetConfig } from "./connector-rpc-handlers.ts";
import { ConnectorRpcError } from "./connector-rpc-shared.ts";

function makeIndex(): { db: Database; idx: LocalIndex } {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  const idx = new LocalIndex(db);
  // Register "github" so requireRegisteredSchedulerServiceId can find it.
  idx.ensureConnectorSchedulerRegistration("github", 300_000, Date.now());
  return { db, idx };
}

function makeCtx(
  rec: Record<string, unknown>,
  idx: LocalIndex,
  syncScheduler?: ConnectorRpcHandlerContext["syncScheduler"],
): ConnectorRpcHandlerContext {
  return {
    rec,
    vault: {} as ConnectorRpcHandlerContext["vault"],
    localIndex: idx,
    openUrl: async () => {},
    syncScheduler,
    connectorMesh: undefined,
  };
}

describe("handleConnectorSetConfig — depth parameter", () => {
  test("depth: 'full' is persisted in the index", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", depth: "full" }, idx);
    const result = handleConnectorSetConfig(ctx);
    expect(result.kind).toBe("hit");
    expect((result.value as Record<string, unknown>)["depth"]).toBe("full");
    expect(idx.getConnectorDepth("github")).toBe("full");
  });

  test("depth: 'metadata_only' is persisted in the index", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", depth: "metadata_only" }, idx);
    const result = handleConnectorSetConfig(ctx);
    expect(result.kind).toBe("hit");
    expect(idx.getConnectorDepth("github")).toBe("metadata_only");
  });

  test("depth: 'summary' is persisted in the index", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", depth: "summary" }, idx);
    const result = handleConnectorSetConfig(ctx);
    expect(result.kind).toBe("hit");
    expect(idx.getConnectorDepth("github")).toBe("summary");
  });

  test("depth: 'bogus' throws ConnectorRpcError with code -32602", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", depth: "bogus" }, idx);
    expect(() => handleConnectorSetConfig(ctx)).toThrow(ConnectorRpcError);
    try {
      handleConnectorSetConfig(ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectorRpcError);
      expect((e as ConnectorRpcError).rpcCode).toBe(-32602);
    }
  });
});

describe("handleConnectorSetConfig — intervalMs enforcement", () => {
  test("intervalMs: 30_000 (< 60s) throws ConnectorRpcError referencing 60 seconds", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", intervalMs: 30_000 }, idx);
    expect(() => handleConnectorSetConfig(ctx)).toThrow(ConnectorRpcError);
    try {
      handleConnectorSetConfig(ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectorRpcError);
      expect((e as ConnectorRpcError).rpcCode).toBe(-32602);
      expect((e as ConnectorRpcError).message).toMatch(/60.*seconds|60000/);
    }
  });

  test("intervalMs: 59_999 (< 60s) throws ConnectorRpcError", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", intervalMs: 59_999 }, idx);
    expect(() => handleConnectorSetConfig(ctx)).toThrow(ConnectorRpcError);
  });

  test("intervalMs: 60_000 (exactly 60s) succeeds", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", intervalMs: 60_000 }, idx);
    const result = handleConnectorSetConfig(ctx);
    expect(result.kind).toBe("hit");
    expect((result.value as Record<string, unknown>)["intervalMs"]).toBe(60_000);
  });

  test("intervalMs: 120_000 (> 60s) succeeds", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", intervalMs: 120_000 }, idx);
    const result = handleConnectorSetConfig(ctx);
    expect(result.kind).toBe("hit");
    expect((result.value as Record<string, unknown>)["intervalMs"]).toBe(120_000);
  });

  test("intervalMs: Infinity throws ConnectorRpcError", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", intervalMs: Infinity }, idx);
    expect(() => handleConnectorSetConfig(ctx)).toThrow(ConnectorRpcError);
  });
});

describe("handleConnectorSetConfig — enabled parameter", () => {
  test("enabled: false without scheduler calls localIndex.pauseConnectorSync", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", enabled: false }, idx);
    // Should not throw; pause is applied via localIndex directly (no scheduler)
    const result = handleConnectorSetConfig(ctx);
    expect(result.kind).toBe("hit");
    expect((result.value as Record<string, unknown>)["enabled"]).toBe(false);
  });

  test("enabled: true without scheduler calls localIndex.resumeConnectorSync", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github", enabled: true }, idx);
    const result = handleConnectorSetConfig(ctx);
    expect(result.kind).toBe("hit");
    expect((result.value as Record<string, unknown>)["enabled"]).toBe(true);
  });
});

describe("handleConnectorSetConfig — no-op omitted fields", () => {
  test("omitting all optional fields returns nulls in value", () => {
    const { idx } = makeIndex();
    const ctx = makeCtx({ serviceId: "github" }, idx);
    const result = handleConnectorSetConfig(ctx);
    expect(result.kind).toBe("hit");
    const val = result.value as Record<string, unknown>;
    expect(val["intervalMs"]).toBeNull();
    expect(val["depth"]).toBeNull();
    expect(val["enabled"]).toBeNull();
  });
});
