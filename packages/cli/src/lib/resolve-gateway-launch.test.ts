import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  findNimbusRepoRootFromDirs,
  isNimbusWorkspaceRoot,
  resolveGatewayLaunch,
  walkUpDirs,
} from "./resolve-gateway-launch.ts";

const rootPkg = `{
  "name": "nimbus",
  "version": "0.0.0",
  "private": true,
  "workspaces": ["packages/gateway"]
}
`;

function writeRepoLayout(root: string, options: { distBinary?: boolean; source?: boolean }): void {
  mkdirSync(join(root, "packages", "gateway", "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), rootPkg, "utf8");
  if (options.source !== false) {
    writeFileSync(join(root, "packages", "gateway", "src", "index.ts"), "// gateway\n", "utf8");
  }
  if (options.distBinary === true) {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "nimbus-gateway"), "", "utf8");
  }
}

function cliLibMetaHref(repoRoot: string): string {
  return pathToFileURL(join(repoRoot, "packages", "cli", "src", "lib", "x.ts")).href;
}

describe("walkUpDirs", () => {
  test("includes start then parents until filesystem root", () => {
    const root = mkdtempSync(join(tmpdir(), "nimbus-walk-"));
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    const dirs = walkUpDirs(deep);
    expect(dirs[0]).toBe(resolve(deep));
    expect(dirs).toContain(resolve(root));
  });
});

describe("isNimbusWorkspaceRoot", () => {
  test("returns true for workspace root package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "nimbus-root-"));
    writeFileSync(join(root, "package.json"), rootPkg, "utf8");
    expect(isNimbusWorkspaceRoot(root, existsSync)).toBe(true);
  });

  test("returns false without workspaces", () => {
    const root = mkdtempSync(join(tmpdir(), "nimbus-other-"));
    writeFileSync(join(root, "package.json"), '{"name":"nimbus","version":"1"}', "utf8");
    expect(isNimbusWorkspaceRoot(root, existsSync)).toBe(false);
  });
});

describe("findNimbusRepoRootFromDirs", () => {
  test("finds root from nested cli path", () => {
    const repo = mkdtempSync(join(tmpdir(), "nimbus-repo-"));
    writeRepoLayout(repo, {});
    const cliDist = join(repo, "packages", "cli", "dist");
    mkdirSync(cliDist, { recursive: true });
    const found = findNimbusRepoRootFromDirs([cliDist], existsSync);
    expect(found).toBe(repo);
  });
});

const ENV_GATEWAY_EXECUTABLE = "NIMBUS_GATEWAY_EXECUTABLE";

describe("resolveGatewayLaunch", () => {
  let prevExecutable: string | undefined;

  beforeEach(() => {
    prevExecutable = process.env[ENV_GATEWAY_EXECUTABLE];
    Reflect.deleteProperty(process.env, ENV_GATEWAY_EXECUTABLE);
  });

  afterEach(() => {
    if (prevExecutable === undefined) {
      Reflect.deleteProperty(process.env, ENV_GATEWAY_EXECUTABLE);
    } else {
      process.env[ENV_GATEWAY_EXECUTABLE] = prevExecutable;
    }
  });

  test("uses NIMBUS_GATEWAY_EXECUTABLE when file exists", () => {
    const gw = join(mkdtempSync(join(tmpdir(), "nimbus-gw-")), "custom-gateway");
    writeFileSync(gw, "", "utf8");
    process.env[ENV_GATEWAY_EXECUTABLE] = gw;
    const binDir = mkdtempSync(join(tmpdir(), "nimbus-bin-"));
    const sibling = join(binDir, "nimbus-gateway");
    writeFileSync(sibling, "", "utf8");
    const r = resolveGatewayLaunch(
      join(binDir, "nimbus"),
      pathToFileURL(join(binDir, "x.ts")).href,
    );
    expect(r).toEqual({ ok: true, cmd: [gw] });
  });

  test("prefers sibling binary over repo dist", () => {
    const repo = mkdtempSync(join(tmpdir(), "nimbus-repo2-"));
    writeRepoLayout(repo, { distBinary: true });
    const cliDist = join(repo, "packages", "cli", "dist");
    mkdirSync(cliDist, { recursive: true });
    const sibling = join(cliDist, "nimbus-gateway");
    writeFileSync(sibling, "", "utf8");

    const r = resolveGatewayLaunch(join(cliDist, "nimbus"), cliLibMetaHref(repo), "linux");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cmd).toEqual([sibling]);
      expect(r.cwd).toBeUndefined();
    }
  });

  test("uses dist binary when sibling missing", () => {
    const repo = mkdtempSync(join(tmpdir(), "nimbus-repo3-"));
    writeRepoLayout(repo, { distBinary: true });
    const cliDist = join(repo, "packages", "cli", "dist");
    mkdirSync(cliDist, { recursive: true });
    const distGw = join(repo, "dist", "nimbus-gateway");
    const r = resolveGatewayLaunch(join(cliDist, "nimbus"), cliLibMetaHref(repo), "linux");
    expect(r).toEqual({ ok: true, cmd: [distGw] });
  });

  test("prefers newer dist/nimbus-gateway.js over dist binary when both exist", () => {
    const repo = mkdtempSync(join(tmpdir(), "nimbus-repo-js-"));
    writeRepoLayout(repo, { distBinary: false });
    mkdirSync(join(repo, "dist"), { recursive: true });
    const distJs = join(repo, "dist", "nimbus-gateway.js");
    const distGw = join(repo, "dist", "nimbus-gateway");
    writeFileSync(distJs, "// bundle\n", "utf8");
    writeFileSync(distGw, "", "utf8");
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    utimesSync(distGw, older, older);
    utimesSync(distJs, newer, newer);
    const cliDist = join(repo, "packages", "cli", "dist");
    mkdirSync(cliDist, { recursive: true });
    const bunPath = process.execPath;
    const r = resolveGatewayLaunch(join(cliDist, "nimbus"), cliLibMetaHref(repo), "linux", {
      whichBun: () => bunPath,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cmd).toEqual([bunPath, distJs]);
      expect(r.cwd).toBe(repo);
    }
  });

  test("prefers dist binary when newer than nimbus-gateway.js", () => {
    const repo = mkdtempSync(join(tmpdir(), "nimbus-repo-exe-"));
    writeRepoLayout(repo, { distBinary: false });
    mkdirSync(join(repo, "dist"), { recursive: true });
    const distJs = join(repo, "dist", "nimbus-gateway.js");
    const distGw = join(repo, "dist", "nimbus-gateway");
    writeFileSync(distJs, "// old bundle\n", "utf8");
    writeFileSync(distGw, "", "utf8");
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    utimesSync(distJs, older, older);
    utimesSync(distGw, newer, newer);
    const cliDist = join(repo, "packages", "cli", "dist");
    mkdirSync(cliDist, { recursive: true });
    const bunPath = process.execPath;
    const r = resolveGatewayLaunch(join(cliDist, "nimbus"), cliLibMetaHref(repo), "linux", {
      whichBun: () => bunPath,
    });
    expect(r).toEqual({ ok: true, cmd: [distGw] });
  });

  test("uses bun run source when dist missing and bun on PATH", () => {
    const repo = mkdtempSync(join(tmpdir(), "nimbus-repo4-"));
    writeRepoLayout(repo, { distBinary: false });
    const cliDist = join(repo, "packages", "cli", "dist");
    mkdirSync(cliDist, { recursive: true });
    const bunPath = process.execPath;
    const r = resolveGatewayLaunch(join(cliDist, "nimbus"), cliLibMetaHref(repo), "linux", {
      whichBun: () => bunPath,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cmd[0]).toBe(bunPath);
      expect(r.cmd[1]).toBe("run");
      expect(r.cmd[2]).toBe("packages/gateway/src/index.ts");
      expect(r.cwd).toBe(repo);
    }
  });

  test("uses win32 dist filename when platform is win32", () => {
    const repo = mkdtempSync(join(tmpdir(), "nimbus-repo5-"));
    writeRepoLayout(repo, { distBinary: false });
    mkdirSync(join(repo, "dist"), { recursive: true });
    const distGw = join(repo, "dist", "nimbus-gateway.exe");
    writeFileSync(distGw, "", "utf8");
    const cliDist = join(repo, "packages", "cli", "dist");
    mkdirSync(cliDist, { recursive: true });
    const r = resolveGatewayLaunch(join(cliDist, "nimbus.exe"), cliLibMetaHref(repo), "win32");
    expect(r).toEqual({ ok: true, cmd: [distGw] });
  });

  test("fails when only source exists and bun is unavailable", () => {
    const repo = mkdtempSync(join(tmpdir(), "nimbus-repo6-"));
    writeRepoLayout(repo, { distBinary: false });
    const cliDist = join(repo, "packages", "cli", "dist");
    mkdirSync(cliDist, { recursive: true });
    const r = resolveGatewayLaunch(join(cliDist, "nimbus"), cliLibMetaHref(repo), "linux", {
      whichBun: () => undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("Bun is not on PATH");
    }
  });

  test("fails when override path missing", () => {
    process.env[ENV_GATEWAY_EXECUTABLE] = join(tmpdir(), "nonexistent-gateway-xyz");
    const r = resolveGatewayLaunch(
      "/bin/nimbus",
      pathToFileURL(join(tmpdir(), `nimbus-resolve-test-${randomUUID()}.ts`)).href,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("not found");
    }
  });
});
