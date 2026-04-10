import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import net from "node:net";
import { platform } from "node:os";
import { asRecord } from "../connectors/unknown-record.ts";
import { GatewayAgentUnavailableError } from "../engine/gateway-agent-error.ts";
import type { LocalIndex } from "../index/local-index.ts";
import type { SyncScheduler } from "../sync/scheduler.ts";
import { validateVaultKeyOrThrow } from "../vault/key-format.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import type { AgentInvokeHandler } from "./agent-invoke.ts";
import { ConnectorRpcError, dispatchConnectorRpc } from "./connector-rpc.ts";
import { dispatchPeopleRpc, PeopleRpcError } from "./people-rpc.ts";
import { ConsentCoordinatorImpl } from "./consent.ts";
import {
  encodeLine,
  errorResponse,
  isRequest,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcOutbound,
  JsonRpcParseError,
  type JsonRpcRequest,
  NdjsonLineReader,
  parseJsonRpcLine,
} from "./jsonrpc.ts";
import type { IPCServer } from "./types.ts";

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

type SessionWrite = (line: string) => void;

type BunSessionData = { session: ClientSession };

class ClientSession {
  readonly clientId: string;
  private readonly reader = new NdjsonLineReader();
  private readonly write: SessionWrite;
  private readonly onRpc: (
    clientId: string,
    msg: JsonRpcRequest | JsonRpcNotification,
  ) => void | Promise<void>;
  private readonly onDispose: (clientId: string) => void;
  private disposed = false;

  constructor(
    clientId: string,
    write: SessionWrite,
    onRpc: (clientId: string, msg: JsonRpcRequest | JsonRpcNotification) => void | Promise<void>,
    onDispose: (clientId: string) => void,
  ) {
    this.clientId = clientId;
    this.write = write;
    this.onRpc = onRpc;
    this.onDispose = onDispose;
  }

  push(chunk: Uint8Array): void {
    if (this.disposed) {
      return;
    }
    let lines: string[];
    try {
      lines = this.reader.push(chunk);
    } catch (e) {
      this.sendParseFailure(e);
      return;
    }
    void this.dispatchLines(lines);
  }

  endInput(): void {
    if (this.disposed) {
      return;
    }
    let lines: string[];
    try {
      lines = this.reader.flush();
    } catch (e) {
      this.sendParseFailure(e);
      return;
    }
    void this.dispatchLines(lines);
  }

  writeOutbound(msg: JsonRpcOutbound): void {
    if (this.disposed) {
      return;
    }
    this.write(encodeLine(msg));
  }

  writeNotification(n: JsonRpcNotification): void {
    this.writeOutbound(n);
  }

  private sendParseFailure(e: unknown): void {
    const msg = e instanceof JsonRpcParseError ? e.message : "Parse error";
    this.write(encodeLine(errorResponse(null, -32700, msg)));
    this.dispose();
  }

  private async dispatchLines(lines: string[]): Promise<void> {
    for (const line of lines) {
      let msg: JsonRpcRequest | JsonRpcNotification;
      try {
        msg = parseJsonRpcLine(line);
      } catch (e) {
        const m = e instanceof JsonRpcParseError ? e.message : "Parse error";
        this.writeOutbound(errorResponse(null, -32700, m));
        continue;
      }
      await this.onRpc(this.clientId, msg);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.onDispose(this.clientId);
  }
}

export type CreateIpcServerOptions = {
  listenPath: string;
  vault: NimbusVault;
  version: string;
  /** When set, `audit.list` reads from the local index; otherwise returns []. */
  localIndex?: LocalIndex;
  /** Opens URLs for OAuth (`connector.auth`). */
  openUrl?: (url: string) => Promise<void>;
  /** Background sync; required for `connector.sync` force runs. */
  syncScheduler?: SyncScheduler;
  /** Monotonic gateway start time (ms) for ping.uptime */
  startedAtMs?: number;
  /** Initial `agent.invoke` handler; may be replaced via {@link IPCServer.setAgentInvokeHandler}. */
  agentInvoke?: AgentInvokeHandler;
  /**
   * Optional hook when a client connects (tests, diagnostics).
   * Not part of the JSON-RPC surface.
   */
  onClientConnected?: (clientId: string) => void;
};

export function createIpcServer(options: CreateIpcServerOptions): IPCServer {
  const startedAtMs = options.startedAtMs ?? Date.now();
  let agentInvokeHandler: AgentInvokeHandler | undefined = options.agentInvoke;
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
    const handler = agentInvokeHandler;
    if (handler === undefined) {
      return {
        reply: `Agent invoke is not configured (no handler). Echo: ${input.slice(0, 500)}`,
        stream,
      };
    }
    try {
      return await handler({
        clientId,
        input,
        stream,
        sendChunk: (text: string) => {
          sendAgentChunkIfStreaming(session, stream, text);
        },
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

  async function dispatchMethod(
    clientId: string,
    session: ClientSession,
    req: JsonRpcRequest,
  ): Promise<unknown> {
    const { method } = req;
    const params = req.params;

    const connectorOutcome = await tryDispatchConnectorRpc(method, params);
    if (connectorOutcome !== connectorRpcSkipped) {
      return connectorOutcome;
    }

    const peopleOutcome = tryDispatchPeopleRpc(method, params);
    if (peopleOutcome !== peopleRpcSkipped) {
      return peopleOutcome;
    }

    switch (method) {
      case "gateway.ping":
        return {
          version: options.version,
          uptime: Date.now() - startedAtMs,
        };

      case "agent.invoke":
        return await dispatchAgentInvoke(clientId, session, params);

      case "consent.respond": {
        const err = consentImpl.handleRespond(clientId, params);
        if (err !== null) {
          throw new RpcMethodError(err.code, err.message);
        }
        return { ok: true };
      }

      case "audit.list": {
        const rec = asRecord(params);
        let limit = 100;
        if (
          rec !== undefined &&
          typeof rec["limit"] === "number" &&
          Number.isFinite(rec["limit"])
        ) {
          limit = Math.min(1000, Math.max(1, Math.floor(rec["limit"])));
        }
        if (options.localIndex === undefined) {
          return [];
        }
        return options.localIndex.listAudit(limit);
      }

      default: {
        const vaultOutcome = await dispatchVaultIfPresent(options.vault, method, params);
        if (vaultOutcome.kind === "hit") {
          return vaultOutcome.value;
        }
        throw new RpcMethodError(-32601, `Method not found: ${method}`);
      }
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
      server.on("error", (err) => {
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
