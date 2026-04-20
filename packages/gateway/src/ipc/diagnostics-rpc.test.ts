import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagnosticsRpcContext } from "./diagnostics-rpc.ts";
import { dispatchDiagnosticsRpc } from "./diagnostics-rpc.ts";

function makeCtx(dataDir: string): DiagnosticsRpcContext {
  return {
    dataDir,
    configDir: dataDir,
    consent: { pendingCount: () => 0 } as never,
    gatewayVersion: "0.0.0-test",
    startedAtMs: Date.now(),
  };
}

describe("telemetry.getStatus", () => {
  test("returns enabled:true when marker file absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-diag-"));
    try {
      const r = dispatchDiagnosticsRpc("telemetry.getStatus", null, makeCtx(dir));
      expect(r.kind).toBe("hit");
      expect((r as { kind: "hit"; value: { enabled: boolean } }).value.enabled).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns enabled:false when marker file present", () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-diag-"));
    try {
      writeFileSync(join(dir, ".nimbus-telemetry-disabled"), `${Date.now()}\n`);
      const r = dispatchDiagnosticsRpc("telemetry.getStatus", null, makeCtx(dir));
      expect(r.kind).toBe("hit");
      expect((r as { kind: "hit"; value: { enabled: boolean } }).value.enabled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("telemetry.setEnabled", () => {
  test("setEnabled(false) writes the disable marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-diag-"));
    try {
      dispatchDiagnosticsRpc("telemetry.setEnabled", { enabled: false }, makeCtx(dir));
      expect(existsSync(join(dir, ".nimbus-telemetry-disabled"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("setEnabled(true) removes the disable marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-diag-"));
    try {
      writeFileSync(join(dir, ".nimbus-telemetry-disabled"), `${Date.now()}\n`);
      dispatchDiagnosticsRpc("telemetry.setEnabled", { enabled: true }, makeCtx(dir));
      expect(existsSync(join(dir, ".nimbus-telemetry-disabled"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects missing enabled param", () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-diag-"));
    try {
      expect(() => dispatchDiagnosticsRpc("telemetry.setEnabled", null, makeCtx(dir))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("diag.getVersion", () => {
  test("returns gateway version string", () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-diag-ver-"));
    try {
      const r = dispatchDiagnosticsRpc("diag.getVersion", null, makeCtx(dir));
      expect(r.kind).toBe("hit");
      const v = (r as { kind: "hit"; value: { version: string; uptimeMs: number } }).value;
      expect(typeof v.version).toBe("string");
      expect(v.version.length).toBeGreaterThan(0);
      expect(typeof v.uptimeMs).toBe("number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
