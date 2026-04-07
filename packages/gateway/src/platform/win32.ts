/**
 * Windows 10+ platform implementation
 * IPC: Named Pipe \\.\pipe\nimbus-gateway
 * Secrets: Windows DPAPI (CryptProtectData)
 * Autostart: HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 * Config: %APPDATA%\Nimbus
 */

import type { PlatformServices } from "./index.ts";

export async function create(): Promise<PlatformServices> {
  // TODO Q1: Implement Windows platform services
  return {};
}
