import { Database } from "bun:sqlite";
import { join } from "node:path";
import pino from "pino";

import { createBitbucketSyncable } from "../connectors/bitbucket-sync.ts";
import { createConfluenceSyncable } from "../connectors/confluence-sync.ts";
import { createGithubSyncable } from "../connectors/github-sync.ts";
import { createGitlabSyncable } from "../connectors/gitlab-sync.ts";
import { createGmailSyncable } from "../connectors/gmail-sync.ts";
import { createGoogleDriveSyncable } from "../connectors/google-drive-sync.ts";
import { createGooglePhotosSyncable } from "../connectors/google-photos-sync.ts";
import { createJiraSyncable } from "../connectors/jira-sync.ts";
import { createLazyConnectorMesh } from "../connectors/lazy-mesh.ts";
import { createLinearSyncable } from "../connectors/linear-sync.ts";
import { createNotionSyncable } from "../connectors/notion-sync.ts";
import { createOneDriveSyncable } from "../connectors/onedrive-sync.ts";
import { createOutlookSyncable } from "../connectors/outlook-sync.ts";
import { createSlackSyncable } from "../connectors/slack-sync.ts";
import { createTeamsSyncable } from "../connectors/teams-sync.ts";
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
  syncScheduler.register(
    createGmailSyncable({
      ensureGoogleMcpRunning: () => connectorMesh.ensureGoogleDriveRunning(),
    }),
  );
  syncScheduler.register(
    createGooglePhotosSyncable({
      ensureGoogleMcpRunning: () => connectorMesh.ensureGoogleDriveRunning(),
    }),
  );
  syncScheduler.register(
    createOneDriveSyncable({
      ensureMicrosoftMcpRunning: () => connectorMesh.ensureMicrosoftBundleRunning(),
    }),
  );
  syncScheduler.register(
    createOutlookSyncable({
      ensureMicrosoftMcpRunning: () => connectorMesh.ensureMicrosoftBundleRunning(),
    }),
  );
  syncScheduler.register(
    createGithubSyncable({
      ensureGithubMcpRunning: () => connectorMesh.ensureGithubRunning(),
    }),
  );
  syncScheduler.register(
    createGitlabSyncable({
      ensureGitlabMcpRunning: () => connectorMesh.ensureGitlabRunning(),
    }),
  );
  syncScheduler.register(
    createBitbucketSyncable({
      ensureBitbucketMcpRunning: () => connectorMesh.ensureBitbucketRunning(),
    }),
  );
  syncScheduler.register(
    createSlackSyncable({
      ensureSlackMcpRunning: () => connectorMesh.ensureSlackRunning(),
    }),
  );
  syncScheduler.register(
    createTeamsSyncable({
      ensureMicrosoftMcpRunning: () => connectorMesh.ensureMicrosoftBundleRunning(),
    }),
  );
  syncScheduler.register(
    createLinearSyncable({
      ensureLinearMcpRunning: () => connectorMesh.ensureLinearRunning(),
    }),
  );
  syncScheduler.register(
    createJiraSyncable({
      ensureJiraMcpRunning: () => connectorMesh.ensureJiraRunning(),
    }),
  );
  syncScheduler.register(
    createNotionSyncable({
      ensureNotionMcpRunning: () => connectorMesh.ensureNotionRunning(),
    }),
  );
  syncScheduler.register(
    createConfluenceSyncable({
      ensureConfluenceMcpRunning: () => connectorMesh.ensureConfluenceRunning(),
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
