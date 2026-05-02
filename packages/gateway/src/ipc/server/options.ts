import type { ProfileManager } from "../../config/profiles.ts";
import type { LazyConnectorMesh } from "../../connectors/lazy-mesh/index.ts";
import type { LocalIndex } from "../../index/local-index.ts";
import type { LlmRegistry } from "../../llm/registry.ts";
import type { SessionMemoryStore } from "../../memory/session-memory-store.ts";
import type { SyncScheduler } from "../../sync/scheduler.ts";
import type { Updater } from "../../updater/updater.ts";
import type { NimbusVault } from "../../vault/nimbus-vault.ts";
import type { VoiceService } from "../../voice/service.ts";
import type { AgentInvokeHandler } from "../agent-invoke.ts";
import type { PairingWindow } from "../lan-pairing.ts";
import type { LanServer } from "../lan-server.ts";
import type { ClientSession } from "../session.ts";
import type { WorkflowRunHandler } from "../workflow-invoke.ts";

export type BunSessionData = { session: ClientSession };

export type CreateIpcServerOptions = {
  listenPath: string;
  vault: NimbusVault;
  version: string;
  /** When set, `audit.list` reads from the local index; otherwise returns []. */
  localIndex?: LocalIndex;
  /** Host path for `extension.install` copies; same as platform `extensionsDir`. */
  extensionsDir?: string;
  /** Opens URLs for OAuth (`connector.auth`). */
  openUrl?: (url: string) => Promise<void>;
  /** Background sync; required for `connector.sync` force runs. */
  syncScheduler?: SyncScheduler;
  /** Required for `connector.addMcp`. */
  connectorMesh?: LazyConnectorMesh;
  /** Merged into `gateway.ping` (e.g. embedding backfill progress). */
  getEmbeddingStatus?: () => Record<string, unknown>;
  /** Monotonic gateway start time (ms) for ping.uptime */
  startedAtMs?: number;
  /** Initial `agent.invoke` handler; may be replaced via {@link IPCServer.setAgentInvokeHandler}. */
  agentInvoke?: AgentInvokeHandler;
  /** Handles `workflow.run` (sequential agent steps); set via {@link IPCServer.setWorkflowRunHandler}. */
  workflowRun?: WorkflowRunHandler;
  /** RAG session chunks (schema v10+); requires embedding runtime + sqlite-vec. */
  sessionMemoryStore?: SessionMemoryStore;
  /**
   * Data directory (`paths.dataDir`) for `db.*` / snapshot listing RPCs.
   * Required when exposing diagnostics methods that touch the filesystem.
   */
  dataDir?: string;
  /** Config directory (`paths.configDir`) for `config.validate` and related RPCs. */
  configDir?: string;
  /**
   * Optional hook when a client connects (tests, diagnostics).
   * Not part of the JSON-RPC surface.
   */
  onClientConnected?: (clientId: string) => void;
  /** LLM model registry for llm.* RPCs (Phase 4 WS1). */
  llmRegistry?: LlmRegistry;
  /** Voice service for voice.* RPCs (Phase 4 WS2). */
  voiceService?: VoiceService;
  /** Auto-updater for updater.* RPCs (Phase 4 WS4). */
  updater?: Updater;
  /** LAN server instance for lan.* RPCs (Phase 4 WS4). */
  lanServer?: LanServer;
  /** Pairing window shared with the LAN server (Phase 4 WS4). */
  lanPairingWindow?: PairingWindow;
  /** Profile manager for profile.* RPCs (Phase 4 WS5-C). */
  profileManager?: ProfileManager;
};
