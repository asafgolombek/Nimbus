import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import net from "node:net";
import { platform } from "node:os";
import { Config } from "../config.ts";
import type { LazyConnectorMesh } from "../connectors/lazy-mesh.ts";
import { asRecord } from "../connectors/unknown-record.ts";
import { type AgentRequestContext, agentRequestContext } from "../engine/agent-request-context.ts";
import { GatewayAgentUnavailableError } from "../engine/gateway-agent-error.ts";
import { driftHintsFromIndex } from "../index/drift-hints.ts";
import type { IndexSearchQuery, LocalIndex } from "../index/local-index.ts";
import type { LlmRegistry } from "../llm/registry.ts";
import type { SessionMemoryStore } from "../memory/session-memory-store.ts";
import type { SyncScheduler } from "../sync/scheduler.ts";
import { validateVaultKeyOrThrow } from "../vault/key-format.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import type { AgentInvokeContext, AgentInvokeHandler } from "./agent-invoke.ts";
import { AutomationRpcError, dispatchAutomationRpc } from "./automation-rpc.ts";
import { ConnectorRpcError, dispatchConnectorRpc } from "./connector-rpc.ts";
import { ConsentCoordinatorImpl } from "./consent.ts";
import { DiagnosticsRpcError, dispatchDiagnosticsRpc } from "./diagnostics-rpc.ts";
import {
  errorResponse,
  isRequest,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from "./jsonrpc.ts";
import { dispatchLlmRpc, LlmRpcError } from "./llm-rpc.ts";
import { dispatchPeopleRpc, PeopleRpcError } from "./people-rpc.ts";
import { ClientSession, type SessionWrite } from "./session.ts";
import { dispatchSessionRpc, SessionRpcError } from "./session-rpc.ts";
import type { IPCServer } from "./types.ts";
import type { WorkflowRunContext, WorkflowRunHandler } from "./workflow-invoke.ts";

class RpcMethodError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "RpcMethodError";
  }
}

function assertWellFormedVaultKey(key: string): void {
  try {
    validateVaultKeyOrThrow(key);
  } catch {
    throw new RpcMethodError(-32602, "Invalid vault key format");
  }
}

function removeStaleUnixSocketIfPresent(listenPath: string): void {
  if (!existsSync(listenPath)) {
    return;
  }
  try {
    unlinkSync(listenPath);
  } catch {
    /* stale or race — bind will surface EADDRINUSE */
  }
}

function chmodListenSocketBestEffort(listenPath: string): void {
  try {
    chmodSync(listenPath, 0o600);
  } catch {
    /* best-effort — platform-specific */
  }
}

type VaultDispatchHit = { readonly kind: "hit"; readonly value: unknown };
type VaultDispatchMiss = { readonly kind: "miss" };
type VaultDispatchOutcome = VaultDispatchHit | VaultDispatchMiss;

async function dispatchVaultIfPresent(
  vault: NimbusVault,
  method: string,
  params: unknown,
): Promise<VaultDispatchOutcome> {
  switch (method) {
    case "vault.set": {
      const rec = asRecord(params);
      if (rec === undefined || typeof rec["key"] !== "string" || typeof rec["value"] !== "string") {
        throw new RpcMethodError(-32602, "Invalid params");
      }
      assertWellFormedVaultKey(rec["key"]);
      await vault.set(rec["key"], rec["value"]);
      return { kind: "hit", value: { ok: true } };
    }
    case "vault.get": {
      const rec = asRecord(params);
      if (rec === undefined || typeof rec["key"] !== "string") {
        throw new RpcMethodError(-32602, "Invalid params");
      }
      assertWellFormedVaultKey(rec["key"]);
      return { kind: "hit", value: await vault.get(rec["key"]) };
    }
    case "vault.delete": {
      const rec = asRecord(params);
      if (rec === undefined || typeof rec["key"] !== "string") {
        throw new RpcMethodError(-32602, "Invalid params");
      }
      assertWellFormedVaultKey(rec["key"]);
      await vault.delete(rec["key"]);
      return { kind: "hit", value: { ok: true } };
    }
    case "vault.listKeys": {
      const rec = asRecord(params);
      const prefix =
        rec !== undefined && typeof rec["prefix"] === "string" ? rec["prefix"] : undefined;
      return { kind: "hit", value: await vault.listKeys(prefix) };
    }
    default:
      return { kind: "miss" };
  }
}

type BunSessionData = { session: ClientSession };

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
};

function requireNonEmptyRpcString(rec: Record<string, unknown> | undefined, key: string): string {
  if (rec === undefined) {
    throw new RpcMethodError(-32602, `Missing or invalid ${key}`);
  }
  const v = rec[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new RpcMethodError(-32602, `Missing or invalid ${key}`);
  }
  return v.trim();
}

function assertDiagnosticsRpcAccess(
  method: string,
  wantsConfig: boolean,
  wantsTelemetry: boolean,
  wantsDiagnostics: boolean,
  opts: Pick<CreateIpcServerOptions, "configDir" | "dataDir" | "localIndex">,
): void {
  if (wantsConfig) {
    if (opts.configDir === undefined) {
      throw new RpcMethodError(-32603, "configDir is required for config.* RPCs");
    }
    return;
  }
  if (wantsTelemetry) {
    if (opts.dataDir === undefined) {
      throw new RpcMethodError(-32603, "dataDir is required for telemetry.* RPCs");
    }
    if (method === "telemetry.preview" && opts.localIndex === undefined) {
      throw new RpcMethodError(-32603, "telemetry.preview requires local index");
    }
    return;
  }
  if (wantsDiagnostics && (opts.localIndex === undefined || opts.dataDir === undefined)) {
    throw new RpcMethodError(-32603, "Diagnostics require local index and dataDir");
  }
}

export function createIpcServer(options: CreateIpcServerOptions): IPCServer {
  const startedAtMs = options.startedAtMs ?? Date.now();
  let agentInvokeHandler: AgentInvokeHandler | undefined = options.agentInvoke;
  let workflowRunHandler: WorkflowRunHandler | undefined = options.workflowRun;
  const sessions = new Map<string, ClientSession>();
  const consentImpl = new ConsentCoordinatorImpl((clientId) => {
    const session = sessions.get(clientId);
    return session === undefined ? undefined : (n) => session.writeNotification(n);
  });

  let bunListener: ReturnType<typeof Bun.listen<BunSessionData>> | undefined;
  let netServer: net.Server | undefined;
  const winSockets = new Set<net.Socket>();

  async function handleRpc(
    clientId: string,
    msg: JsonRpcRequest | JsonRpcNotification,
  ): Promise<void> {
    const session = sessions.get(clientId);
    if (session === undefined) {
      return;
    }

    if (!isRequest(msg)) {
      return;
    }

    const req = msg;
    const id: JsonRpcId = req.id;

    try {
      const result = await dispatchMethod(clientId, session, req);
      session.writeOutbound({ jsonrpc: "2.0", id, result });
    } catch (e) {
      if (e instanceof RpcMethodError) {
        session.writeOutbound(errorResponse(id, e.rpcCode, e.message));
      } else {
        const message = e instanceof Error ? e.message : "Internal error";
        session.writeOutbound(errorResponse(id, -32603, message));
      }
    }
  }

  function sendAgentChunkIfStreaming(session: ClientSession, stream: boolean, text: string): void {
    if (!stream) {
      return;
    }
    session.writeNotification({
      jsonrpc: "2.0",
      method: "agent.chunk",
      params: { text },
    });
  }

  async function dispatchAgentInvoke(
    clientId: string,
    session: ClientSession,
    params: unknown,
  ): Promise<unknown> {
    const rec = asRecord(params);
    const input = rec !== undefined && typeof rec["input"] === "string" ? rec["input"] : "";
    const stream = rec?.["stream"] === true;
    const sessionIdRaw = rec?.["sessionId"];
    const sessionId =
      typeof sessionIdRaw === "string" && sessionIdRaw.trim() !== ""
        ? sessionIdRaw.trim()
        : undefined;
    const agentRaw = rec?.["agent"];
    const agent =
      typeof agentRaw === "string" && agentRaw.trim() !== "" ? agentRaw.trim() : undefined;
    const handler = agentInvokeHandler;
    if (handler === undefined) {
      return {
        reply: `Agent invoke is not configured (no handler). Echo: ${input.slice(0, 500)}`,
        stream,
      };
    }
    try {
      const requestStore: AgentRequestContext = {};
      if (sessionId !== undefined) {
        requestStore.sessionId = sessionId;
      }
      return await agentRequestContext.run(requestStore, async () => {
        const payload: AgentInvokeContext = {
          clientId,
          input,
          stream,
          sendChunk: (text: string) => {
            sendAgentChunkIfStreaming(session, stream, text);
          },
        };
        if (sessionId !== undefined) {
          payload.sessionId = sessionId;
        }
        if (agent !== undefined) {
          payload.agent = agent;
        }
        return handler(payload);
      });
    } catch (e) {
      if (e instanceof GatewayAgentUnavailableError) {
        throw new RpcMethodError(-32000, e.message);
      }
      throw e;
    }
  }

  const connectorRpcSkipped = Symbol("connectorRpcSkipped");
  const peopleRpcSkipped = Symbol("peopleRpcSkipped");
  const sessionRpcSkipped = Symbol("sessionRpcSkipped");
  const automationRpcSkipped = Symbol("automationRpcSkipped");
  const llmRpcSkipped = Symbol("llmRpcSkipped");

  async function tryDispatchLlmRpc(method: string, params: unknown): Promise<unknown> {
    if (!method.startsWith("llm.") || options.llmRegistry === undefined) {
      return llmRpcSkipped;
    }
    try {
      const out = await dispatchLlmRpc(method, params, { registry: options.llmRegistry });
      if (out.kind === "hit") return out.value;
    } catch (e) {
      if (e instanceof LlmRpcError) {
        throw new RpcMethodError(e.rpcCode, e.message);
      }
      throw e;
    }
    throw new RpcMethodError(-32601, `Method not found: ${method}`);
  }

  async function tryDispatchSessionRpc(method: string, params: unknown): Promise<unknown> {
    if (!method.startsWith("session.")) {
      return sessionRpcSkipped;
    }
    if (options.sessionMemoryStore === undefined) {
      throw new RpcMethodError(-32603, "Session memory is not available on this gateway");
    }
    try {
      const out = await dispatchSessionRpc({
        method,
        params,
        store: options.sessionMemoryStore,
      });
      if (out.kind === "hit") {
        return out.value;
      }
    } catch (e) {
      if (e instanceof SessionRpcError) {
        throw new RpcMethodError(e.rpcCode, e.message);
      }
      throw e;
    }
    throw new RpcMethodError(-32601, `Method not found: ${method}`);
  }

  async function dispatchWorkflowRunRpc(
    clientId: string,
    session: ClientSession,
    params: unknown,
  ): Promise<unknown> {
    if (options.localIndex === undefined) {
      throw new RpcMethodError(-32603, "Local index is not available");
    }
    const handler = workflowRunHandler;
    if (handler === undefined) {
      throw new RpcMethodError(-32603, "Workflow runner is not configured");
    }
    const rec = asRecord(params);
    const workflowName = requireNonEmptyRpcString(rec, "name");
    const triggeredBy =
      rec !== undefined &&
      typeof rec["triggeredBy"] === "string" &&
      rec["triggeredBy"].trim() !== ""
        ? rec["triggeredBy"].trim()
        : clientId;
    const dryRun = rec?.["dryRun"] === true;
    const stream = rec?.["stream"] === true;
    const sessionIdRaw = rec?.["sessionId"];
    const sessionId =
      typeof sessionIdRaw === "string" && sessionIdRaw.trim() !== ""
        ? sessionIdRaw.trim()
        : undefined;
    const agentRaw = rec?.["agent"];
    const agent =
      typeof agentRaw === "string" && agentRaw.trim() !== "" ? agentRaw.trim() : undefined;

    const ctx: WorkflowRunContext = {
      clientId,
      workflowName,
      triggeredBy,
      dryRun,
      stream,
      sendChunk: (text: string) => {
        sendAgentChunkIfStreaming(session, stream, text);
      },
    };
    if (sessionId !== undefined) {
      ctx.sessionId = sessionId;
    }
    if (agent !== undefined) {
      ctx.agent = agent;
    }

    try {
      const requestStore: AgentRequestContext = {};
      if (sessionId !== undefined) {
        requestStore.sessionId = sessionId;
      }
      return await agentRequestContext.run(requestStore, async () => handler(ctx));
    } catch (e) {
      if (e instanceof GatewayAgentUnavailableError) {
        throw new RpcMethodError(-32000, e.message);
      }
      throw e;
    }
  }

  async function tryDispatchAutomationRpc(
    clientId: string,
    session: ClientSession,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    if (method === "workflow.run") {
      return dispatchWorkflowRunRpc(clientId, session, params);
    }

    if (
      method.startsWith("watcher.") ||
      method.startsWith("workflow.") ||
      method.startsWith("extension.")
    ) {
      if (options.localIndex === undefined) {
        throw new RpcMethodError(-32603, "Local index is not available");
      }
      try {
        const out = dispatchAutomationRpc({
          method,
          params,
          db: options.localIndex.getDatabase(),
          ...(options.extensionsDir === undefined ? {} : { extensionsDir: options.extensionsDir }),
        });
        if (out.kind === "hit") {
          return out.value;
        }
      } catch (e) {
        if (e instanceof AutomationRpcError) {
          throw new RpcMethodError(e.rpcCode, e.message);
        }
        throw e;
      }
      throw new RpcMethodError(-32601, `Method not found: ${method}`);
    }

    return automationRpcSkipped;
  }

  function tryDispatchPeopleRpc(method: string, params: unknown): unknown {
    if (!method.startsWith("people.") || options.localIndex === undefined) {
      return peopleRpcSkipped;
    }
    try {
      const out = dispatchPeopleRpc({
        method,
        params,
        localIndex: options.localIndex,
      });
      if (out.kind === "hit") {
        return out.value;
      }
    } catch (e) {
      if (e instanceof PeopleRpcError) {
        throw new RpcMethodError(e.rpcCode, e.message);
      }
      throw e;
    }
    return peopleRpcSkipped;
  }

  async function tryDispatchConnectorRpc(method: string, params: unknown): Promise<unknown> {
    if (!method.startsWith("connector.") || options.localIndex === undefined) {
      return connectorRpcSkipped;
    }
    const openUrl = options.openUrl;
    if (openUrl === undefined && method === "connector.auth") {
      throw new RpcMethodError(-32603, "Gateway is not configured for OAuth (missing openUrl)");
    }
    try {
      const out = await dispatchConnectorRpc({
        method,
        params,
        vault: options.vault,
        localIndex: options.localIndex,
        openUrl: openUrl ?? (async () => {}),
        syncScheduler: options.syncScheduler,
        ...(options.connectorMesh === undefined ? {} : { connectorMesh: options.connectorMesh }),
      });
      if (out.kind === "hit") {
        return out.value;
      }
    } catch (e) {
      if (e instanceof ConnectorRpcError) {
        throw new RpcMethodError(e.rpcCode, e.message);
      }
      throw e;
    }
    return connectorRpcSkipped;
  }

  function rpcGatewayPing(params: unknown): unknown {
    const extra = options.getEmbeddingStatus?.() ?? {};
    const base: Record<string, unknown> = {
      version: options.version,
      uptime: Date.now() - startedAtMs,
      agentLimits: {
        maxAgentDepth: Config.maxAgentDepth,
        maxToolCallsPerSession: Config.maxToolCallsPerSession,
      },
      ...extra,
    };
    const rec = asRecord(params);
    if (rec?.["includeDrift"] !== true) {
      return base;
    }
    if (options.localIndex === undefined) {
      return { ...base, drift: { lines: ["Local index is not available."] as const } };
    }
    const lines = driftHintsFromIndex(options.localIndex.getDatabase());
    return { ...base, drift: { lines } };
  }

  const diagnosticsRpcSkipped = Symbol("diagnosticsRpcSkipped");

  function tryDispatchDiagnosticsRpc(
    method: string,
    params: unknown,
  ): typeof diagnosticsRpcSkipped | object {
    const wantsConfig = method.startsWith("config.");
    const wantsTelemetry = method.startsWith("telemetry.");
    const wantsDiagnostics =
      method.startsWith("db.") ||
      method.startsWith("diag.") ||
      method === "index.metrics" ||
      method === "index.queryItems" ||
      method === "index.querySql";
    if (!wantsConfig && !wantsTelemetry && !wantsDiagnostics) {
      return diagnosticsRpcSkipped;
    }
    assertDiagnosticsRpcAccess(method, wantsConfig, wantsTelemetry, wantsDiagnostics, options);
    try {
      const ctxBase = {
        dataDir: options.dataDir ?? "",
        configDir: options.configDir ?? "",
        consent: consentImpl,
        gatewayVersion: options.version,
        startedAtMs,
      };
      const diagCtx =
        options.localIndex === undefined ? ctxBase : { ...ctxBase, localIndex: options.localIndex };
      const out = dispatchDiagnosticsRpc(method, params, diagCtx);
      if (out.kind === "hit") {
        return out.value as object;
      }
    } catch (e) {
      if (e instanceof DiagnosticsRpcError) {
        throw new RpcMethodError(e.rpcCode, e.message);
      }
      throw e;
    }
    return diagnosticsRpcSkipped;
  }

  async function rpcIndexSearchRanked(params: unknown): Promise<unknown> {
    if (options.localIndex === undefined) {
      throw new RpcMethodError(-32603, "Local index is not available");
    }
    const rec = asRecord(params);
    if (rec === undefined) {
      throw new RpcMethodError(-32602, "Invalid params");
    }
    const name = typeof rec["name"] === "string" ? rec["name"] : "";
    const service = typeof rec["service"] === "string" ? rec["service"] : undefined;
    const itemType = typeof rec["itemType"] === "string" ? rec["itemType"] : undefined;
    const limit =
      typeof rec["limit"] === "number" && Number.isFinite(rec["limit"])
        ? Math.min(500, Math.max(1, Math.floor(rec["limit"])))
        : 20;
    const semantic = rec["semantic"] !== false;
    const contextChunks =
      typeof rec["contextChunks"] === "number" && Number.isFinite(rec["contextChunks"])
        ? Math.min(8, Math.max(0, Math.floor(rec["contextChunks"])))
        : 2;
    const query: IndexSearchQuery = { limit };
    if (name !== "") {
      query.name = name;
    }
    if (service !== undefined) {
      query.service = service;
    }
    if (itemType !== undefined) {
      query.itemType = itemType;
    }
    return await options.localIndex.searchRankedAsync(query, {
      semantic,
      contextChunks,
    });
  }

  function rpcConsentRespond(clientId: string, params: unknown): unknown {
    const err = consentImpl.handleRespond(clientId, params);
    if (err !== null) {
      throw new RpcMethodError(err.code, err.message);
    }
    return { ok: true };
  }

  function rpcAuditList(params: unknown): unknown {
    const rec = asRecord(params);
    let limit = 100;
    if (rec !== undefined && typeof rec["limit"] === "number" && Number.isFinite(rec["limit"])) {
      limit = Math.min(1000, Math.max(1, Math.floor(rec["limit"])));
    }
    if (options.localIndex === undefined) {
      return [];
    }
    return options.localIndex.listAudit(limit);
  }

  async function rpcVaultOrMethodNotFound(method: string, params: unknown): Promise<unknown> {
    const vaultOutcome = await dispatchVaultIfPresent(options.vault, method, params);
    if (vaultOutcome.kind === "hit") {
      return vaultOutcome.value;
    }
    throw new RpcMethodError(-32601, `Method not found: ${method}`);
  }

  async function dispatchMethod(
    clientId: string,
    session: ClientSession,
    req: JsonRpcRequest,
  ): Promise<unknown> {
    const { method } = req;
    const params = req.params;

    const sessionOutcome = await tryDispatchSessionRpc(method, params);
    if (sessionOutcome !== sessionRpcSkipped) {
      return sessionOutcome;
    }

    const automationOutcome = await tryDispatchAutomationRpc(clientId, session, method, params);
    if (automationOutcome !== automationRpcSkipped) {
      return automationOutcome;
    }

    const connectorOutcome = await tryDispatchConnectorRpc(method, params);
    if (connectorOutcome !== connectorRpcSkipped) {
      return connectorOutcome;
    }

    const diagnosticsHit = tryDispatchDiagnosticsRpc(method, params);
    if (diagnosticsHit !== diagnosticsRpcSkipped) {
      return diagnosticsHit;
    }

    const peopleOutcome = tryDispatchPeopleRpc(method, params);
    if (peopleOutcome !== peopleRpcSkipped) {
      return peopleOutcome;
    }

    const llmOutcome = await tryDispatchLlmRpc(method, params);
    if (llmOutcome !== llmRpcSkipped) {
      return llmOutcome;
    }

    switch (method) {
      case "gateway.ping":
        return rpcGatewayPing(params);

      case "index.searchRanked":
        return await rpcIndexSearchRanked(params);

      case "agent.invoke":
        return await dispatchAgentInvoke(clientId, session, params);

      case "consent.respond":
        return rpcConsentRespond(clientId, params);

      case "audit.list":
        return rpcAuditList(params);

      case "engine.askStream": {
        const rec = asRecord(params);
        const input = rec !== undefined && typeof rec["input"] === "string" ? rec["input"] : "";
        const sessionIdRaw = rec?.["sessionId"];
        const sessionId =
          typeof sessionIdRaw === "string" && sessionIdRaw.trim() !== ""
            ? sessionIdRaw.trim()
            : undefined;
        const streamId = randomUUID();

        const handler = agentInvokeHandler;
        if (handler === undefined) {
          throw new RpcMethodError(-32603, "No agent handler configured for engine.askStream");
        }

        // Return streamId immediately so caller can track this stream
        void (async () => {
          try {
            const requestStore: AgentRequestContext = {};
            if (sessionId !== undefined) requestStore.sessionId = sessionId;
            await agentRequestContext.run(requestStore, async () => {
              const payload: AgentInvokeContext = {
                clientId,
                input,
                stream: true,
                sendChunk: (text: string) => {
                  session.writeNotification({
                    jsonrpc: "2.0",
                    method: "engine.streamToken",
                    params: { streamId, text },
                  });
                },
              };
              if (sessionId !== undefined) payload.sessionId = sessionId;
              await handler(payload);
            });
            session.writeNotification({
              jsonrpc: "2.0",
              method: "engine.streamDone",
              params: {
                streamId,
                meta: { modelUsed: "default", isLocal: false, provider: "remote" },
              },
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : "Stream error";
            session.writeNotification({
              jsonrpc: "2.0",
              method: "engine.streamError",
              params: { streamId, error: message },
            });
          }
        })();

        return { streamId };
      }

      default:
        return await rpcVaultOrMethodNotFound(method, params);
    }
  }

  function attachSession(write: SessionWrite): ClientSession {
    const clientId = randomUUID();
    const session = new ClientSession(clientId, write, handleRpc, (cid) => {
      sessions.delete(cid);
      consentImpl.onClientDisconnect(cid);
    });
    sessions.set(clientId, session);
    options.onClientConnected?.(clientId);
    return session;
  }

  function attachWin32Socket(sock: net.Socket): void {
    winSockets.add(sock);
    const session = attachSession((line) => {
      sock.write(line);
    });
    sock.on("data", (buf: Buffer) => {
      session.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    sock.on("end", () => {
      session.endInput();
    });
    sock.on("close", () => {
      winSockets.delete(sock);
      session.dispose();
    });
    sock.on("error", () => {
      winSockets.delete(sock);
      session.dispose();
    });
  }

  async function startWin32NetServer(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer(attachWin32Socket);
      netServer = server;
      server.listen(options.listenPath, () => {
        resolve();
      });
      (server as unknown as EventEmitter).on("error", (err: Error) => {
        reject(err);
      });
    });
  }

  function startBunUnixListener(): void {
    bunListener = Bun.listen<BunSessionData>({
      unix: options.listenPath,
      socket: {
        open(socket) {
          const session = attachSession((line) => {
            socket.write(line);
          });
          socket.data = { session };
        },
        data(socket, data: Uint8Array) {
          socket.data.session.push(data);
        },
        close(socket) {
          const s = socket.data.session;
          s.endInput();
          s.dispose();
        },
        error(socket) {
          socket.data.session?.dispose();
        },
      },
    });
  }

  return {
    listenPath: options.listenPath,
    consent: consentImpl,
    setAgentInvokeHandler(handler: AgentInvokeHandler | undefined): void {
      agentInvokeHandler = handler;
    },
    setWorkflowRunHandler(handler: WorkflowRunHandler | undefined): void {
      workflowRunHandler = handler;
    },
    async start(): Promise<void> {
      if (platform() === "win32") {
        await startWin32NetServer();
        return;
      }

      removeStaleUnixSocketIfPresent(options.listenPath);
      startBunUnixListener();
      chmodListenSocketBestEffort(options.listenPath);
    },

    async stop(): Promise<void> {
      consentImpl.rejectAllPending("Gateway shutting down", "gateway shutting down");
      if (netServer !== undefined) {
        const s = netServer;
        netServer = undefined;
        for (const sock of winSockets) {
          sock.destroy();
        }
        winSockets.clear();
        await new Promise<void>((resolve) => {
          s.close(() => resolve());
        });
        return;
      }

      if (bunListener !== undefined) {
        const l = bunListener;
        bunListener = undefined;
        for (const sess of sessions.values()) {
          sess.dispose();
        }
        sessions.clear();
        l.stop(true);
        if (existsSync(options.listenPath)) {
          try {
            unlinkSync(options.listenPath);
          } catch {
            /* ignore */
          }
        }
      }
    },
  };
}
