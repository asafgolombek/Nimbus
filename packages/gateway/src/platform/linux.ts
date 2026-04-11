/**
 * Ubuntu 22.04+ platform implementation
 * IPC: Unix Domain Socket under XDG_RUNTIME_DIR
 * Secrets: Secret Service via secret-tool — vault wired in Stage 2
 * Autostart: systemd user unit / XDG autostart
 * Config: XDG Base Dir
 */

import { resolveSecretToolExecutable } from "../vault/linux.ts";
import { assemblePlatformServices } from "./assemble.ts";
import { PlatformInitError } from "./errors.ts";
import { createLinuxPaths } from "./paths.ts";
import type { PlatformServices } from "./types.ts";

const SECRET_TOOL_INSTALL_HINT =
  "secret-tool not found. Install libsecret-tools (Debian/Ubuntu) or libsecret (Fedora/Arch) to use Nimbus on Linux.";

/**
 * Probes Linux vault dependency; exported for subprocess contract tests.
 * When {@link process.env.NIMBUS_LINUX_VAULT_PROBE_STRICT_PATH} is `"1"`, only `PATH` is
 * consulted (no FHS fallback) so fixtures can simulate a missing `secret-tool`.
 */
export function assertLinuxSecretToolAvailable(): void {
  if (process.env["NIMBUS_LINUX_VAULT_PROBE_STRICT_PATH"] === "1") {
    if (Bun.which("secret-tool") === null) {
      throw new PlatformInitError(SECRET_TOOL_INSTALL_HINT);
    }
    return;
  }
  if (resolveSecretToolExecutable() === null) {
    throw new PlatformInitError(SECRET_TOOL_INSTALL_HINT);
  }
}

export async function create(): Promise<PlatformServices> {
  assertLinuxSecretToolAvailable();
  const paths = createLinuxPaths();
  return assemblePlatformServices(paths);
}
