import { createIpcServer } from "../ipc/index.ts";
import { createNimbusVault } from "../vault/factory.ts";
import { ensurePlatformDirectories } from "./dirs.ts";
import type { PlatformPaths } from "./paths.ts";
import type { AutostartManager, NotificationService, PlatformServices } from "./types.ts";

function createStubAutostart(): AutostartManager {
  return {
    async isEnabled(): Promise<boolean> {
      return false;
    },
    async enable(): Promise<void> {},
    async disable(): Promise<void> {},
  };
}

function createStubNotifications(): NotificationService {
  return {
    async show(_title: string, _body: string): Promise<void> {},
  };
}

export async function assemblePlatformServices(paths: PlatformPaths): Promise<PlatformServices> {
  await ensurePlatformDirectories(paths);
  const vault = await createNimbusVault(paths);
  return {
    vault,
    ipc: createIpcServer({
      listenPath: paths.socketPath,
      vault,
      version: "0.1.0",
    }),
    paths,
    autostart: createStubAutostart(),
    notifications: createStubNotifications(),
  };
}
