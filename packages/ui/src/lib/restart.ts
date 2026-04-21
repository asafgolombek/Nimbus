import { invoke } from "@tauri-apps/api/core";

/**
 * Tear down the whole Tauri process and relaunch it. Used on `profile.switched`
 * because the profile change alters the Vault key prefix, which invalidates MCP
 * client singletons, IPC subscription channels, and any module-scope cache —
 * `window.location.reload()` is insufficient because secondary windows (HITL popup,
 * Quick Query, onboarding) would keep serving stale profile data.
 *
 * In the Vitest jsdom environment there is no Tauri runtime; we swallow the error
 * and fall back to `window.location.reload()`. Most tests stub this module entirely.
 */
export async function restartApp(): Promise<void> {
  try {
    await invoke("plugin:app|restart");
  } catch {
    if (globalThis.location !== undefined) {
      globalThis.location.reload();
    }
  }
}
