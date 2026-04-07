import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PlatformPaths } from "./paths.ts";

function isWindowsNamedPipe(socketPath: string): boolean {
  return socketPath.toLowerCase().startsWith("\\\\.\\pipe\\");
}

/** Creates configured dirs (and Unix socket parent) before services use them. */
export async function ensurePlatformDirectories(paths: PlatformPaths): Promise<void> {
  const dirs = [paths.configDir, paths.dataDir, paths.logDir, paths.extensionsDir, paths.tempDir];
  if (!isWindowsNamedPipe(paths.socketPath)) {
    dirs.push(dirname(paths.socketPath));
  }
  for (const d of dirs) {
    await mkdir(d, { recursive: true });
  }
}
