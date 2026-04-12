import { Database } from "bun:sqlite";
import { join } from "node:path";
import pino from "pino";
import { evaluateWatchersAfterSync } from "../automation/watcher-engine.ts";
import { loadNimbusEmbeddingFromConfigDir } from "../config/nimbus-toml.ts";
import { loadNimbusSessionFromConfigDir } from "../config/session-toml.ts";
import { Config } from "../config.ts";
import { createLazyConnectorMesh } from "../connectors/lazy-mesh.ts";
import { createEmbeddingRuntime } from "../embedding/create-embedding-runtime.ts";
import { verifyExtensionsBestEffort } from "../extensions/verify-extensions.ts";
import {
  LocalIndex,
  type LocalIndexOptions,
  type SemanticSearchDeps,
} from "../index/local-index.ts";
import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { createIpcServer } from "../ipc/index.ts";
import { SessionMemoryStore } from "../memory/session-memory-store.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import { SyncScheduler } from "../sync/scheduler.ts";
import type { SyncContext } from "../sync/types.ts";
import { createNimbusVault } from "../vault/factory.ts";
import { registerConnectorMeshSyncables } from "./assemble-sync-registrations.ts";
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
  db.run("PRAGMA busy_timeout = 8000");
  const notifications = createStubNotifications();
  const syncLogger = pino({ level: processEnvGet("NIMBUS_LOG_LEVEL") ?? "warn" });
  const rateLimiter = new ProviderRateLimiter();
  const tomlEmbedding = loadNimbusEmbeddingFromConfigDir(paths.configDir);
  const sessionToml = loadNimbusSessionFromConfigDir(paths.configDir);
  const embeddingRuntime = await createEmbeddingRuntime(
    db,
    paths,
    syncLogger,
    tomlEmbedding,
    Config.embeddingsEnabled,
    vault,
  );
  const rt = embeddingRuntime;
  let scheduleItemEmbedding: ((itemId: string) => void) | undefined;
  let semanticSearch: SemanticSearchDeps | undefined;
  if (rt) {
    scheduleItemEmbedding = rt.scheduleItemEmbedding.bind(rt);
    semanticSearch = {
      model: rt.getEmbeddingModel(),
      embedQuery: (text: string) => rt.embedQuery(text),
    };
  }
  const localIndexOpts: LocalIndexOptions = {};
  if (scheduleItemEmbedding !== undefined) {
    localIndexOpts.scheduleItemEmbedding = scheduleItemEmbedding;
  }
  if (semanticSearch !== undefined) {
    localIndexOpts.semanticSearch = semanticSearch;
  }
  const hasEmbeddingIndexOpts = scheduleItemEmbedding !== undefined || semanticSearch !== undefined;
  let localIndex: LocalIndex;
  if (hasEmbeddingIndexOpts) {
    localIndex = new LocalIndex(db, localIndexOpts);
  } else {
    localIndex = new LocalIndex(db);
  }
  const syncBase: SyncContext = { vault, db, logger: syncLogger, rateLimiter };
  let syncContext: SyncContext;
  if (scheduleItemEmbedding) {
    syncContext = { ...syncBase, scheduleItemEmbedding };
  } else {
    syncContext = syncBase;
  }

  let sessionMemoryStore: SessionMemoryStore | undefined;
  if (rt != null && readIndexedUserVersion(db) >= 10) {
    const embeddingRt = rt;
    sessionMemoryStore = new SessionMemoryStore({
      db,
      dims: embeddingRt.getEmbeddingDims(),
      embedText: (t) => embeddingRt.embedQuery(t),
    });
    const ttlMs = Math.max(1, sessionToml.memoryTtlHours) * 3_600_000;
    setInterval(() => {
      try {
        sessionMemoryStore?.pruneExpired(ttlMs, Date.now());
      } catch {
        /* ignore */
      }
    }, 3_600_000);
  }

  verifyExtensionsBestEffort(db, syncLogger);

  const syncScheduler = new SyncScheduler(syncContext, undefined, {
    notify: async (title, body) => {
      await notifications.show(title, body);
    },
    onConnectorSyncSuccess: (serviceId) => {
      evaluateWatchersAfterSync(db, serviceId, Date.now(), (t, b) => notifications.show(t, b));
    },
  });
  const connectorMesh = await createLazyConnectorMesh(paths, vault);
  registerConnectorMeshSyncables(syncScheduler, connectorMesh);
  syncScheduler.start();
  rt?.startBackgroundJobs();
  const ipcOpts: Parameters<typeof createIpcServer>[0] = {
    listenPath: paths.socketPath,
    vault,
    version: "0.1.0",
    localIndex,
    extensionsDir: paths.extensionsDir,
    openUrl: openUrlInDefaultBrowser,
    syncScheduler,
  };
  if (sessionMemoryStore !== undefined) {
    ipcOpts.sessionMemoryStore = sessionMemoryStore;
  }
  if (rt) {
    ipcOpts.getEmbeddingStatus = () => ({
      embeddingBackfill: rt.getBackfillProgress(),
    });
  }
  return {
    vault,
    ipc: createIpcServer(ipcOpts),
    paths,
    localIndex,
    connectorMesh,
    syncScheduler,
    autostart: createStubAutostart(),
    notifications,
    openUrl: openUrlInDefaultBrowser,
    ...(sessionMemoryStore === undefined ? {} : { sessionMemoryStore }),
  };
}
