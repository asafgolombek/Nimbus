import { describe, expect, it } from "bun:test";
import { platform } from "node:os";
import { dirname, join } from "node:path";

import { processEnvDelete, processEnvGet, processEnvSet } from "./env-access.ts";
import { PlatformInitError } from "./errors.ts";
import { createDarwinPaths, createLinuxPaths, createWindowsPaths } from "./paths.ts";

const gatewayRoot = join(import.meta.dirname, "..", "..");

describe("Platform Abstraction Layer", () => {
  it("createPlatformServices is exported", async () => {
    const { createPlatformServices } = await import("./index.ts");
    expect(typeof createPlatformServices).toBe("function");
  });

  it("returns a full PlatformServices shape for the current OS", async () => {
    const { createPlatformServices } = await import("./index.ts");
    const services = await createPlatformServices();

    expect(services.vault).toBeDefined();
    expect(typeof services.vault.get).toBe("function");
    expect(services.ipc).toBeDefined();
    expect(typeof services.ipc.start).toBe("function");
    expect(services.paths).toBeDefined();
    expect(services.localIndex).toBeDefined();
    expect(typeof services.localIndex.listAudit).toBe("function");
    expect(services.autostart).toBeDefined();
    expect(services.notifications).toBeDefined();
    expect(typeof services.openUrl).toBe("function");

    const { paths } = services;
    for (const key of [
      "configDir",
      "dataDir",
      "logDir",
      "socketPath",
      "extensionsDir",
      "tempDir",
    ] as const) {
      expect(typeof paths[key]).toBe("string");
      expect(paths[key].length).toBeGreaterThan(0);
    }
  });

  it("uses the documented IPC path pattern per OS", async () => {
    const { createPlatformServices } = await import("./index.ts");
    const { paths } = await createPlatformServices();
    const os = platform();
    if (os === "win32") {
      expect(paths.socketPath.toLowerCase()).toBe(
        String.raw`\\.\pipe\nimbus-gateway`.toLowerCase(),
      );
    } else {
      expect(paths.socketPath).toContain("nimbus-gateway.sock");
    }
  });

  it("throws PlatformInitError for missing Linux secret-tool (subprocess)", () => {
    if (platform() !== "linux") {
      return;
    }
    const result = Bun.spawnSync({
      cmd: ["bun", "run", join(gatewayRoot, "test/fixtures/linux-secret-tool-probe.ts")],
      cwd: gatewayRoot,
      env: {
        ...process.env,
        PATH: dirname(process.execPath),
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    const errText = new TextDecoder().decode(result.stderr);
    expect(errText).toContain("secret-tool not found");
    expect(errText).toContain("PlatformInitError");
  });

  it("createWindowsPaths throws PlatformInitError without APPDATA", () => {
    if (platform() !== "win32") {
      return;
    }
    const prev = processEnvGet("APPDATA");
    processEnvDelete("APPDATA");
    try {
      expect(() => createWindowsPaths()).toThrow(PlatformInitError);
    } finally {
      processEnvSet("APPDATA", prev);
    }
  });
});

describe("PlatformPaths factories", () => {
  it("darwin paths share config and data roots per Q1 plan", () => {
    if (platform() !== "darwin") {
      return;
    }
    const paths = createDarwinPaths();
    expect(paths.configDir).toBe(paths.dataDir);
  });

  it("linux paths are under XDG-style directories", () => {
    if (platform() !== "linux") {
      return;
    }
    const paths = createLinuxPaths();
    expect(paths.configDir).toContain("nimbus");
    expect(paths.dataDir).toContain("nimbus");
  });
});
