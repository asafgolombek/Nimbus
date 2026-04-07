/**
 * Ubuntu 22.04+ platform implementation
 * IPC: Unix Domain Socket
 * Secrets: Secret Service API via libsecret (org.freedesktop.secrets)
 * Autostart: systemd user unit / XDG autostart
 * Config: ~/.config/nimbus (XDG Base Dir)
 */

import type { PlatformServices } from "./index.ts";

export async function create(): Promise<PlatformServices> {
  // TODO Q1: Implement Linux platform services
  return {};
}
