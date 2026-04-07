import { platform } from "node:os";

// TODO Q1: Add vault, ipc, paths, autostart, notifications members
export type PlatformServices = Record<string, never>;

export async function createPlatformServices(): Promise<PlatformServices> {
  switch (platform()) {
    case "win32":
      return (await import("./win32.ts")).create();
    case "darwin":
      return (await import("./darwin.ts")).create();
    case "linux":
      return (await import("./linux.ts")).create();
    default:
      throw new Error(`Unsupported platform: ${platform()}`);
  }
}
