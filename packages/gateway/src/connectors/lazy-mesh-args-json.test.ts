/**
 * S8-F8 — verify MCPClient ids use crypto.randomUUID() (not Date.now()).
 * S8-F9 — verify malformed args_json transitions connector health to
 * persistent_error and emits a warn log line.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalIndex } from "../index/local-index.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { getConnectorHealth } from "./health.ts";
import { LazyConnectorMesh, type MeshLogger } from "./lazy-mesh.ts";

function makePaths(): PlatformPaths {
  const root = mkdtempSync(join(tmpdir(), "nimbus-lazy-mesh-test-"));
  return {
    configDir: root,
    dataDir: join(root, "data"),
    logDir: join(root, "logs"),
    socketPath: join(root, "sock"),
    extensionsDir: join(root, "ext"),
    tempDir: join(root, "tmp"),
  };
}

const stubVault: NimbusVault = {
  async get(): Promise<string | null> {
    return null;
  },
  async set(): Promise<void> {},
  async delete(): Promise<void> {},
  async listKeys(): Promise<string[]> {
    return [];
  },
};

describe("LazyConnectorMesh — args_json failure (S8-F9)", () => {
  test("malformed args_json (parse error) logs warn and transitions health to persistent_error", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);

    const warns: Array<{ bindings: Record<string, unknown>; msg: string | undefined }> = [];
    const logger: MeshLogger = {
      warn: (b, m) => warns.push({ bindings: b, msg: m }),
    };

    const mesh = new LazyConnectorMesh(makePaths(), stubVault, {
      listUserMcpConnectors: () => [
        {
          service_id: "broken-svc",
          command: "/bin/echo",
          args_json: "not-json",
          created_at: 0,
        },
      ],
      healthDb: db,
      logger,
    });

    await mesh.ensureUserMcpRunning("broken-svc");
    await mesh.disconnect();

    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]?.bindings["serviceId"]).toBe("broken-svc");

    const snap = getConnectorHealth(db, "broken-svc");
    expect(snap.state).toBe("error");
    expect(snap.lastError ?? "").toMatch(/args_json/);
  });

  test("malformed args_json (non-string-array) logs warn and transitions health", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);

    const warns: Array<{ bindings: Record<string, unknown>; msg: string | undefined }> = [];
    const logger: MeshLogger = {
      warn: (b, m) => warns.push({ bindings: b, msg: m }),
    };

    const mesh = new LazyConnectorMesh(makePaths(), stubVault, {
      listUserMcpConnectors: () => [
        {
          service_id: "non-array-svc",
          command: "/bin/echo",
          args_json: '{"not":"an array"}',
          created_at: 0,
        },
      ],
      healthDb: db,
      logger,
    });

    await mesh.ensureUserMcpRunning("non-array-svc");
    await mesh.disconnect();

    expect(warns.length).toBeGreaterThan(0);
    const snap = getConnectorHealth(db, "non-array-svc");
    expect(snap.state).toBe("error");
    expect(snap.lastError ?? "").toMatch(/args_json/);
  });

  test("S8-F9 — silent path when no logger / healthDb is wired (legacy callers)", async () => {
    const mesh = new LazyConnectorMesh(makePaths(), stubVault, {
      listUserMcpConnectors: () => [
        {
          service_id: "broken-svc",
          command: "/bin/echo",
          args_json: "not-json",
          created_at: 0,
        },
      ],
    });
    // Should not throw, even without db / logger.
    await mesh.ensureUserMcpRunning("broken-svc");
    await mesh.disconnect();
  });
});

describe("LazyConnectorMesh — UUID ids (S8-F8)", () => {
  test("source has no Date.now() in MCPClient id literals", () => {
    const src = readFileSync(join(import.meta.dir, "lazy-mesh.ts"), "utf8");
    // Every `id:` template literal that previously used Date.now() should now use randomUUID().
    expect(src.includes("Date.now()")).toBe(false);
    // randomUUID is imported and used.
    expect(src.includes("randomUUID")).toBe(true);
  });
});
