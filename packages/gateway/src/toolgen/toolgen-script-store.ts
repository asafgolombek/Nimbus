import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STORE_DIR = "toolgen";
const EPHEMERAL_DIR = "ephemeral";
const SCRIPT_FILE = "index.ts";

/**
 * A tool id is minted by the gateway, never supplied by a caller — but it is validated anyway,
 * because it is interpolated into a filesystem path AND into a `//` comment in the emitted script
 * (`toolgen-stub.ts`). A newline-bearing id would corrupt that script, and a separator-bearing one
 * would escape this store. Exported so the gate can assert it at MINT time rather than leaving the
 * guarantee to depend on `toolScriptDir` happening to be called first.
 */
export function assertSafeToolId(toolId: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(toolId)) {
    throw new Error(`unsafe tool id for a path segment: ${JSON.stringify(toolId)}`);
  }
}

/**
 * Where a generated tool's approved body lives (spec § 4.6).
 *
 * PURE — derivable before anything is written, which is what lets `buildGeneratedManifest` grant
 * read to this directory while the file itself is written only AFTER the owner approves.
 */
export function toolScriptDir(configDir: string, toolId: string): string {
  assertSafeToolId(toolId);
  return join(configDir, STORE_DIR, EPHEMERAL_DIR, toolId);
}

/**
 * Owner-only (`0o600` for the file, `0o700` for the directory). On Windows these modes are
 * advisory only — Node emulates a subset of the POSIX mode bits and the OS does not enforce them;
 * the real control there is the directory ACL, not the mode.
 */
export async function writeToolScript(
  configDir: string,
  toolId: string,
  source: string,
): Promise<string> {
  const dir = toolScriptDir(configDir, toolId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, SCRIPT_FILE);
  await writeFile(file, source, { encoding: "utf8", mode: 0o600 });
  return file;
}

/** Idempotent: revoking a tool that never wrote a script must not throw. */
export async function removeToolScript(configDir: string, toolId: string): Promise<void> {
  await rm(toolScriptDir(configDir, toolId), { recursive: true, force: true });
}

/** Shutdown drain — the store is ephemeral, so nothing may survive a restart. */
export async function removeAllToolScripts(configDir: string): Promise<void> {
  await rm(join(configDir, STORE_DIR, EPHEMERAL_DIR), { recursive: true, force: true });
}
