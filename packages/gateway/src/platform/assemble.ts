import { Database } from "bun:sqlite";
import { join } from "node:path";
import pino from "pino";
import { evaluateWatchersAfterSync } from "../automation/watcher-engine.ts";
import { loadNimbusFilesystemRootsFromConfigDir } from "../config/filesystem-toml.ts";
import { loadNimbusEmbeddingFromConfigDir } from "../config/nimbus-toml.ts";
import { loadNimbusSessionFromConfigDir } from "../config/session-toml.ts";
import { Config } from "../config.ts";
import { defaultSyncIntervalMsForService } from "../connectors/connector-catalog.ts";
import { createFilesystemV2Syncable } from "../connectors/filesystem-v2-sync.ts";
import { createLazyConnectorMesh } from "../connectors/lazy-mesh.ts";
import { listUserMcpConnectors } from "../connectors/user-mcp-store.ts";
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
import { AnomalyDetectorStub } from "../watcher/anomaly-detector.ts";
import { registerConnectorMeshSyncables } from "./assemble-sync-registrations.ts";
import { openUrlInDefaultBrowser } from "./browser.ts";
import { ensurePlatformDirectories } from "./dirs.ts";
import { processEnvGet } from "./env-access.ts";
import type { PlatformPaths } from "./paths.ts";
import { registerUserMcpSyncablesFromDatabase } from "./register-user-mcp-sync.ts";
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
  {
    const pat = await vault.get("github.pat");
    localIndex.ensureGithubActionsSchedulerCompanionIfNeeded({
      githubPatPresent: pat !== null && pat !== "",
      now: Date.now(),
      intervalMs: defaultSyncIntervalMsForService("github_actions"),
    });
    const cciTok = await vault.get("circleci.api_token");
    localIndex.ensureCircleciSchedulerCompanionIfNeeded({
      circleciTokenPresent: cciTok !== null && cciTok !== "",
      now: Date.now(),
      intervalMs: defaultSyncIntervalMsForService("circleci"),
    });
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

  const syncAnomaly = new AnomalyDetectorStub({
    windowSize: 64,
    onNotify: (e) => {
      syncLogger.warn(
        { seriesId: e.seriesId, value: e.value, score: e.score, atMs: e.atMs },
        "sync telemetry anomaly (stub — no automated remediation)",
      );
    },
  });

  const syncScheduler = new SyncScheduler(syncContext, undefined, {
    notify: async (title, body) => {
      await notifications.show(title, body);
    },
    onConnectorSyncSuccess: (serviceId, result, durationMs) => {
      const at = Date.now();
      syncAnomaly.recordSample(`sync:duration_ms:${serviceId}`, durationMs, at);
      syncAnomaly.recordSample(`sync:items_upserted:${serviceId}`, result.itemsUpserted, at);
      evaluateWatchersAfterSync(db, serviceId, at, (t, b) => notifications.show(t, b));
    },
  });
  const fsV2Roots = loadNimbusFilesystemRootsFromConfigDir(paths.configDir);
  if (fsV2Roots.length > 0) {
    localIndex.ensureConnectorSchedulerRegistration("filesystem", 10 * 60 * 1000, Date.now());
    syncScheduler.register(createFilesystemV2Syncable({ roots: fsV2Roots }));
  }
  const connectorMesh = await createLazyConnectorMesh(paths, vault, {
    listUserMcpConnectors: () => listUserMcpConnectors(db),
  });
  registerConnectorMeshSyncables(syncScheduler, connectorMesh);
  registerUserMcpSyncablesFromDatabase(db, syncScheduler, connectorMesh);
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
    connectorMesh,
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
