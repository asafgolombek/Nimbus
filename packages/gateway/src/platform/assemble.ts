import { Database } from "bun:sqlite";
import { join } from "node:path";
import pino from "pino";

import { createGoogleDriveSyncable } from "../connectors/google-drive-sync.ts";
import { createLazyConnectorMesh } from "../connectors/lazy-mesh.ts";
import { LocalIndex } from "../index/local-index.ts";
import { createIpcServer } from "../ipc/index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import { SyncScheduler } from "../sync/scheduler.ts";
import { createNimbusVault } from "../vault/factory.ts";
import { openUrlInDefaultBrowser } from "./browser.ts";
import { ensurePlatformDirectories } from "./dirs.ts";
import { processEnvGet } from "./env-access.ts";
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
  const db = new Database(join(paths.dataDir, "nimbus.db"));
  LocalIndex.ensureSchema(db);
  const localIndex = new LocalIndex(db);
  const notifications = createStubNotifications();
  const syncLogger = pino({ level: processEnvGet("NIMBUS_LOG_LEVEL") ?? "warn" });
  const rateLimiter = new ProviderRateLimiter();
  const syncScheduler = new SyncScheduler(
    { vault, db, logger: syncLogger, rateLimiter },
    undefined,
    {
      notify: async (title, body) => {
        await notifications.show(title, body);
      },
    },
  );
  const connectorMesh = await createLazyConnectorMesh(paths, vault);
  syncScheduler.register(
    createGoogleDriveSyncable({
      ensureGoogleDriveRunning: () => connectorMesh.ensureGoogleDriveRunning(),
    }),
  );
  syncScheduler.start();
  return {
    vault,
    ipc: createIpcServer({
      listenPath: paths.socketPath,
      vault,
      version: "0.1.0",
      localIndex,
      openUrl: openUrlInDefaultBrowser,
      syncScheduler,
    }),
    paths,
    localIndex,
    connectorMesh,
    syncScheduler,
    autostart: createStubAutostart(),
    notifications,
    openUrl: openUrlInDefaultBrowser,
  };
}
