/**
 * Ubuntu 22.04+ platform implementation
 * IPC: Unix Domain Socket under XDG_RUNTIME_DIR
 * Secrets: Secret Service via secret-tool — vault wired in Stage 2
 * Autostart: systemd user unit / XDG autostart
 * Config: XDG Base Dir
 */

import { assemblePlatformServices } from "./assemble.ts";
import { PlatformInitError } from "./errors.ts";
import { createLinuxPaths } from "./paths.ts";
import type { PlatformServices } from "./types.ts";

/** Probes Linux vault dependency; exported for subprocess contract tests. */
export function assertLinuxSecretToolAvailable(): void {
  if (Bun.which("secret-tool") === null) {
    throw new PlatformInitError(
      "secret-tool not found. Install libsecret-tools (Debian/Ubuntu) or libsecret (Fedora/Arch) to use Nimbus on Linux.",
    );
  }
}

export async function create(): Promise<PlatformServices> {
  assertLinuxSecretToolAvailable();
  const paths = createLinuxPaths();
  return assemblePlatformServices(paths);
}
