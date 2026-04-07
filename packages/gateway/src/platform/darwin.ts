/**
 * macOS 13+ platform implementation
 * IPC: Unix Domain Socket under $TMPDIR
 * Secrets: Keychain Services — vault wired in Stage 2
 * Autostart: ~/Library/LaunchAgents/dev.nimbus.plist
 * Config: ~/Library/Application Support/Nimbus
 */

import { assemblePlatformServices } from "./assemble.ts";
import { createDarwinPaths } from "./paths.ts";
import type { PlatformServices } from "./types.ts";

export async function create(): Promise<PlatformServices> {
  const paths = createDarwinPaths();
  return assemblePlatformServices(paths);
}
