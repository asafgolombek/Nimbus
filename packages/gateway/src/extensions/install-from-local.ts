import type { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

/** Windows PATH often lists Git's GNU tar before the inbox BSD tar; GNU tar mishandles Win32 paths here. */
export function resolveSystemTarCommand(): string {
  if (process.platform !== "win32") {
    return "tar";
  }
  const root = process.env["SystemRoot"] ?? process.env["windir"];
  if (root !== undefined && root !== "") {
    return join(root, "System32", "tar.exe");
  }
  return join("C:", "Windows", "System32", "tar.exe");
}

import { insertExtensionRow } from "../automation/extension-store.ts";
import {
  type ExtensionManifest,
  parseExtensionManifestJson,
  resolveExtensionManifestPath,
} from "./manifest.ts";

function sha256HexOfBytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Reject ids that could escape the extensions directory when joined. */
export function assertSafeExtensionId(extensionId: string): void {
  if (extensionId.trim() === "" || extensionId.includes("\0")) {
    throw new Error("invalid extension id");
  }
  const normalized = extensionId.replaceAll("\\", "/");
  const parts = normalized.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0) {
    throw new Error("invalid extension id");
  }
  for (const p of parts) {
    if (p === "..") {
      throw new Error("invalid extension id");
    }
  }
}

export function extensionInstallDirectory(extensionsDir: string, extensionId: string): string {
  assertSafeExtensionId(extensionId);
  const normalized = extensionId.replaceAll("\\", "/");
  const parts = normalized.split("/").filter((p) => p !== "" && p !== ".");
  return join(extensionsDir, ...parts);
}

function completeExtensionInstallAfterCopy(options: {
  db: Database;
  dest: string;
  manifest: ExtensionManifest;
}): InstallExtensionFromLocalResult {
  const destManifestPath = resolveExtensionManifestPath(options.dest);
  if (destManifestPath === undefined) {
    throw new Error("extension manifest missing after copy");
  }
  const destManifestBytes = readFileSync(destManifestPath);
  const manifestHex = sha256HexOfBytes(destManifestBytes);
  const destManifest = parseExtensionManifestJson(destManifestBytes.toString("utf8"));
  if (
    destManifest.id !== options.manifest.id ||
    destManifest.version !== options.manifest.version
  ) {
    throw new Error("manifest id/version changed across copy");
  }

  const entryRelRaw =
    destManifest.entry !== undefined && destManifest.entry !== ""
      ? destManifest.entry
      : "dist/index.js";
  if (entryRelRaw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entryRelRaw)) {
    throw new Error("extension entry must be a relative path");
  }
  const entryPath = assertEntryInsideInstall(options.dest, entryRelRaw);
  if (!existsSync(entryPath)) {
    throw new Error(`extension entry file missing: ${entryRelRaw}`);
  }
  const entryBytes = readFileSync(entryPath);
  const entryHex = sha256HexOfBytes(entryBytes);

  const now = Date.now();
  insertExtensionRow(options.db, {
    id: options.manifest.id,
    version: options.manifest.version,
    install_path: options.dest,
    manifest_hash: manifestHex,
    entry_hash: entryHex,
    enabled: 1,
    installed_at: now,
    last_verified_at: now,
  });

  return {
    id: options.manifest.id,
    version: options.manifest.version,
    installPath: options.dest,
    manifestHash: manifestHex,
    entryHash: entryHex,
  };
}

function extractTarGzToDirectory(archivePath: string, destDir: string): void {
  const cmd = resolveSystemTarCommand();
  const r = spawnSync(cmd, ["-xzf", archivePath, "-C", destDir], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) {
    const output = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim();
    const detail = output || `exit ${String(r.status)}`;
    throw new Error(`failed to extract archive: ${detail}`);
  }
}

function installExtensionFromArchive(options: {
  db: Database;
  extensionsDir: string;
  archivePath: string;
}): InstallExtensionFromLocalResult {
  const tmp = mkdtempSync(join(tmpdir(), "nimbus-ext-tgz-"));
  try {
    extractTarGzToDirectory(options.archivePath, tmp);
    const root = findExtensionSourceRootInTree(tmp);
    return installExtensionFromLocalDirectory({
      db: options.db,
      extensionsDir: options.extensionsDir,
      sourcePath: root,
    });
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

function findExtensionSourceRootInTree(extractedRoot: string): string {
  if (resolveExtensionManifestPath(extractedRoot) !== undefined) {
    return extractedRoot;
  }
  for (const ent of readdirSync(extractedRoot, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      const sub = join(extractedRoot, ent.name);
      if (resolveExtensionManifestPath(sub) !== undefined) {
        return sub;
      }
    }
  }
  throw new Error(
    "archive does not contain nimbus.extension.json (at root or one subdirectory deep)",
  );
}

function assertEntryInsideInstall(installRoot: string, entryRel: string): string {
  const absRoot = resolve(installRoot);
  const absEntry = resolve(join(installRoot, entryRel));
  const rel = relative(absRoot, absEntry);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || rel.split(sep).includes("..")) {
    throw new Error("extension entry path escapes install directory");
  }
  return absEntry;
}

export type InstallExtensionFromLocalResult = {
  id: string;
  version: string;
  installPath: string;
  manifestHash: string;
  entryHash: string;
};

/**
 * Copies a local extension directory (or extracts `.tar.gz` / `.tgz`) into `extensionsDir`,
 * computes manifest/entry hashes, inserts DB row. Rolls back the copy if the DB insert fails.
 */
export function installExtensionFromLocalDirectory(options: {
  db: Database;
  extensionsDir: string;
  sourcePath: string;
}): InstallExtensionFromLocalResult {
  const sourceResolved = resolve(options.sourcePath);
  if (!existsSync(sourceResolved)) {
    throw new Error("extension source path does not exist");
  }
  const st = statSync(sourceResolved);
  if (st.isFile()) {
    const lower = sourceResolved.toLowerCase();
    if (!lower.endsWith(".tar.gz") && !lower.endsWith(".tgz")) {
      throw new Error("extension source file must be a .tar.gz or .tgz archive");
    }
    return installExtensionFromArchive({
      db: options.db,
      extensionsDir: options.extensionsDir,
      archivePath: sourceResolved,
    });
  }
  if (!st.isDirectory()) {
    throw new Error("extension source path must be a directory or .tar.gz archive");
  }

  const srcManifestPath = resolveExtensionManifestPath(sourceResolved);
  if (srcManifestPath === undefined) {
    throw new Error(
      "extension manifest not found (expected nimbus.extension.json or nimbus-extension.json)",
    );
  }

  const manifestBytes = readFileSync(srcManifestPath);
  const manifest = parseExtensionManifestJson(manifestBytes.toString("utf8"));

  const dest = extensionInstallDirectory(options.extensionsDir, manifest.id);
  if (existsSync(dest)) {
    throw new Error(`extension already installed at ${dest}`);
  }

  mkdirSync(options.extensionsDir, { recursive: true });

  try {
    cpSync(sourceResolved, dest, { recursive: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`extension copy failed: ${msg}`);
  }

  try {
    return completeExtensionInstallAfterCopy({ db: options.db, dest, manifest });
  } catch (e) {
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      /* best-effort rollback */
    }
    throw e;
  }
}
