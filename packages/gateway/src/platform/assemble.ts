import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Logger } from "pino";
import {
  evaluateWatchersAfterSync,
  evaluateWatchersStartupCatchUp,
} from "../automation/watcher-engine.ts";
import { loadNimbusFilesystemRootsFromConfigDir } from "../config/filesystem-toml.ts";
import { loadNimbusEmbeddingFromPath, resolveNimbusTomlForProfile } from "../config/nimbus-toml.ts";
import { loadNimbusSessionFromPath } from "../config/session-toml.ts";
import { Config } from "../config.ts";
import { defaultSyncIntervalMsForService } from "../connectors/connector-catalog.ts";
import { createFilesystemV2Syncable } from "../connectors/filesystem-v2-sync.ts";
import { createLazyConnectorMesh, type LazyConnectorMesh } from "../connectors/lazy-mesh.ts";
import { listUserMcpConnectors } from "../connectors/user-mcp-store.ts";
import { startLatencyFlushScheduler } from "../db/latency-ring-buffer.ts";
import { createEmbeddingRuntime } from "../embedding/create-embedding-runtime.ts";
import { verifyExtensionsBestEffort } from "../extensions/verify-extensions.ts";
import {
  LocalIndex,
  type LocalIndexOptions,
  type SemanticSearchDeps,
} from "../index/local-index.ts";
import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { startReadOnlyHttpServer } from "../ipc/http-server.ts";
import { createIpcServer } from "../ipc/index.ts";
import { startMetricsServer } from "../ipc/metrics-server.ts";
import { SessionMemoryStore } from "../memory/session-memory-store.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import { SyncScheduler } from "../sync/scheduler.ts";
import type { SyncContext } from "../sync/types.ts";
import { startTelemetryFlushScheduler } from "../telemetry/flush-scheduler.ts";
import { createNimbusVault } from "../vault/factory.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { AnomalyDetectorStub } from "../watcher/anomaly-detector.ts";
import { registerConnectorMeshSyncables } from "./assemble-sync-registrations.ts";
import { openUrlInDefaultBrowser } from "./browser.ts";
import { ensurePlatformDirectories } from "./dirs.ts";
import { processEnvGet } from "./env-access.ts";
import { createGatewayPinoLogger } from "./gateway-log-file.ts";
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

type EmbeddingRuntime = Awaited<ReturnType<typeof createEmbeddingRuntime>>;

function openGatewaySqlite(dataDir: string): Database {
  const dbPath = join(dataDir, "nimbus.db");
  const db = new Database(dbPath);
  LocalIndex.ensureSchema(db, { backupDir: join(dataDir, "backups"), dbPath });
  startLatencyFlushScheduler(db);
  db.run("PRAGMA busy_timeout = 8000");
  return db;
}

async function createLocalIndexWithEmbeddingRuntime(
  db: Database,
  paths: PlatformPaths,
  vault: NimbusVault,
  syncLogger: Logger,
  activeTomlPath: string,
): Promise<{
  localIndex: LocalIndex;
  scheduleItemEmbedding: ((itemId: string) => void) | undefined;
  rt: EmbeddingRuntime;
}> {
  const tomlEmbedding = loadNimbusEmbeddingFromPath(activeTomlPath);
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
  const localIndex = hasEmbeddingIndexOpts
    ? new LocalIndex(db, localIndexOpts)
    : new LocalIndex(db);
  return { localIndex, scheduleItemEmbedding, rt };
}

async function ensureGithubCircleCiSchedulerCompanions(
  localIndex: LocalIndex,
  vault: NimbusVault,
): Promise<void> {
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

function maybeAttachSessionMemoryStore(
  db: Database,
  rt: EmbeddingRuntime,
  sessionToml: ReturnType<typeof loadNimbusSessionFromPath>,
): SessionMemoryStore | undefined {
  if (rt == null || readIndexedUserVersion(db) < 10) {
    return undefined;
  }
  const embeddingRt = rt;
  const sessionMemoryStore = new SessionMemoryStore({
    db,
    dims: embeddingRt.getEmbeddingDims(),
    embedText: (t) => embeddingRt.embedQuery(t),
  });
  const ttlMs = Math.max(1, sessionToml.memoryTtlHours) * 3_600_000;
  setInterval(() => {
    try {
      sessionMemoryStore.pruneExpired(ttlMs, Date.now());
    } catch {
      /* ignore */
    }
  }, 3_600_000);
  return sessionMemoryStore;
}

async function createSchedulerWithMesh(
  paths: PlatformPaths,
  vault: NimbusVault,
  db: Database,
  syncContext: SyncContext,
  localIndex: LocalIndex,
  notifications: NotificationService,
  syncLogger: Logger,
): Promise<{ syncScheduler: SyncScheduler; connectorMesh: LazyConnectorMesh }> {
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
  evaluateWatchersStartupCatchUp(db, Date.now(), (t, b) => notifications.show(t, b));
  return { syncScheduler, connectorMesh };
}

function collectSidecarsFromEnv(db: Database, paths: PlatformPaths): Array<() => void> {
  const sidecarStops: Array<() => void> = [];
  const httpPortRaw = processEnvGet("NIMBUS_HTTP_PORT");
  if (httpPortRaw !== undefined && httpPortRaw.trim() !== "") {
    const hp = Number.parseInt(httpPortRaw.trim(), 10);
    if (Number.isFinite(hp) && hp > 0) {
      sidecarStops.push(startReadOnlyHttpServer(join(paths.dataDir, "nimbus.db"), hp).stop);
    }
  }
  const metricsPortRaw = processEnvGet("NIMBUS_METRICS_PORT");
  if (metricsPortRaw !== undefined && metricsPortRaw.trim() !== "") {
    const mp = Number.parseInt(metricsPortRaw.trim(), 10);
    if (Number.isFinite(mp) && mp > 0) {
      sidecarStops.push(startMetricsServer(() => db, mp).stop);
    }
  }
  return sidecarStops;
}

export async function assemblePlatformServices(paths: PlatformPaths): Promise<PlatformServices> {
  const assemblyStartedMs = performance.now();
  await ensurePlatformDirectories(paths);
  const vault = await createNimbusVault(paths);
  const db = openGatewaySqlite(paths.dataDir);
  const notifications = createStubNotifications();
  const syncLogger: Logger = createGatewayPinoLogger(paths.logDir);
  const rateLimiter = new ProviderRateLimiter();
  const activeTomlPath = resolveNimbusTomlForProfile(paths.configDir);
  const sessionToml = loadNimbusSessionFromPath(activeTomlPath);

  const { localIndex, scheduleItemEmbedding, rt } = await createLocalIndexWithEmbeddingRuntime(
    db,
    paths,
    vault,
    syncLogger,
    activeTomlPath,
  );
  await ensureGithubCircleCiSchedulerCompanions(localIndex, vault);

  const syncBase: SyncContext = { vault, db, logger: syncLogger, rateLimiter };
  const syncContext: SyncContext = scheduleItemEmbedding
    ? { ...syncBase, scheduleItemEmbedding }
    : syncBase;

  const sessionMemoryStore = maybeAttachSessionMemoryStore(db, rt, sessionToml);

  verifyExtensionsBestEffort(db, syncLogger);

  const { syncScheduler, connectorMesh } = await createSchedulerWithMesh(
    paths,
    vault,
    db,
    syncContext,
    localIndex,
    notifications,
    syncLogger,
  );
  rt?.startBackgroundJobs();
  const ipcOpts: Parameters<typeof createIpcServer>[0] = {
    listenPath: paths.socketPath,
    vault,
    version: "0.1.0",
    localIndex,
    dataDir: paths.dataDir,
    configDir: paths.configDir,
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

  const sidecarStops = collectSidecarsFromEnv(db, paths);
  const gatewayAssemblyMs = Math.max(0, Math.round(performance.now() - assemblyStartedMs));
  const telemetryStop = startTelemetryFlushScheduler({
    dataDir: paths.dataDir,
    activeTomlPath,
    getDatabase: () => db,
    gatewayVersion: "0.1.0",
    logger: syncLogger,
    coldStartMs: gatewayAssemblyMs,
  });
  sidecarStops.push(telemetryStop.stop);

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
    ...(sidecarStops.length === 0
      ? {}
      : {
          disposeSidecars(): void {
            for (const s of sidecarStops) {
              try {
                s();
              } catch {
                /* ignore */
              }
            }
          },
        }),
  };
}
