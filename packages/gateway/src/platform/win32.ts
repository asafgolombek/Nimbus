/**
 * Windows 10+ platform implementation
 * IPC: Named Pipe \\.\pipe\nimbus-gateway
 * Secrets: Windows DPAPI (CryptProtectData) — vault wired in Stage 2
 * Autostart: HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 * Config: %APPDATA%\Nimbus
 */

import { assemblePlatformServices } from "./assemble.ts";
import { createWindowsPaths } from "./paths.ts";
import type { PlatformServices } from "./types.ts";

export async function create(): Promise<PlatformServices> {
  const paths = createWindowsPaths();
  return assemblePlatformServices(paths);
}
