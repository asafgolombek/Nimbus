import { platform } from "node:os";

import { PlatformInitError } from "./errors.ts";

export { PlatformInitError } from "./errors.ts";
export type { PlatformPaths } from "./paths.ts";
export type {
  AutostartManager,
  NotificationService,
  PlatformServices,
} from "./types.ts";

export async function createPlatformServices(): Promise<import("./types.ts").PlatformServices> {
  const p = platform();
  try {
    switch (p) {
      case "win32":
        return await (await import("./win32.ts")).create();
      case "darwin":
        return await (await import("./darwin.ts")).create();
      case "linux":
        return await (await import("./linux.ts")).create();
      default:
        throw new PlatformInitError(`Unsupported platform: ${p}`);
    }
  } catch (err) {
    if (err instanceof PlatformInitError) {
      throw err;
    }
    throw new PlatformInitError(
      `Failed to initialize platform services on ${p}. ` +
        `Ensure all OS dependencies are available. Cause: ${String(err)}`,
    );
  }
}
