import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import net from "node:net";
import { platform } from "node:os";

import type { LocalIndex } from "../index/local-index.ts";
import { validateVaultKeyOrThrow } from "../vault/key-format.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
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

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function assertWellFormedVaultKey(key: string): void {
  try {
    validateVaultKeyOrThrow(key);
  } catch {
    throw new RpcMethodError(-32602, "Invalid vault key format");
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
  /** Monotonic gateway start time (ms) for ping.uptime */
  startedAtMs?: number;
  /**
   * Optional hook when a client connects (tests, diagnostics).
   * Not part of the JSON-RPC surface.
   */
  onClientConnected?: (clientId: string) => void;
};

export function createIpcServer(options: CreateIpcServerOptions): IPCServer {
  const startedAtMs = options.startedAtMs ?? Date.now();
  const sessions = new Map<string, ClientSession>();
  const consentImpl = new ConsentCoordinatorImpl((clientId) => {
    const s = sessions.get(clientId);
    if (s === undefined) {
      return undefined;
    }
    return (n) => {
      s.writeNotification(n);
    };
  });

  let bunListener: ReturnType<typeof Bun.listen<BunSessionData>> | undefined;
  let netServer: net.Server | undefined;
  const winSockets = new Set<net.Socket>();
  const stopNetSessions = new Set<ClientSession>();

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

  async function dispatchMethod(
    clientId: string,
    session: ClientSession,
    req: JsonRpcRequest,
  ): Promise<unknown> {
    const { method } = req;
    const params = req.params;

    switch (method) {
      case "gateway.ping":
        return {
          version: options.version,
          uptime: Date.now() - startedAtMs,
        };

      case "agent.invoke": {
        const rec = asRecord(params);
        const input = rec !== undefined && typeof rec["input"] === "string" ? rec["input"] : "";
        const stream = rec?.["stream"] === true;
        if (stream) {
          session.writeNotification({
            jsonrpc: "2.0",
            method: "agent.chunk",
            params: {
              text: `[stub] Processing for client ${clientId.slice(0, 8)}…`,
            },
          });
        }
        return {
          reply: `Q1 stub — engine not wired. Echo: ${input.slice(0, 500)}`,
          stream,
        };
      }

      case "consent.respond": {
        const err = consentImpl.handleRespond(clientId, params);
        if (err !== null) {
          throw new RpcMethodError(err.code, err.message);
        }
        return { ok: true };
      }

      case "vault.set": {
        const rec = asRecord(params);
        if (
          rec === undefined ||
          typeof rec["key"] !== "string" ||
          typeof rec["value"] !== "string"
        ) {
          throw new RpcMethodError(-32602, "Invalid params");
        }
        assertWellFormedVaultKey(rec["key"]);
        await options.vault.set(rec["key"], rec["value"]);
        return { ok: true };
      }

      case "vault.get": {
        const rec = asRecord(params);
        if (rec === undefined || typeof rec["key"] !== "string") {
          throw new RpcMethodError(-32602, "Invalid params");
        }
        assertWellFormedVaultKey(rec["key"]);
        return await options.vault.get(rec["key"]);
      }

      case "vault.delete": {
        const rec = asRecord(params);
        if (rec === undefined || typeof rec["key"] !== "string") {
          throw new RpcMethodError(-32602, "Invalid params");
        }
        assertWellFormedVaultKey(rec["key"]);
        await options.vault.delete(rec["key"]);
        return { ok: true };
      }

      case "vault.listKeys": {
        const rec = asRecord(params);
        const prefix =
          rec !== undefined && typeof rec["prefix"] === "string" ? rec["prefix"] : undefined;
        return await options.vault.listKeys(prefix);
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

      default:
        throw new RpcMethodError(-32601, `Method not found: ${method}`);
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

  return {
    listenPath: options.listenPath,
    consent: consentImpl,
    async start(): Promise<void> {
      if (platform() === "win32") {
        await new Promise<void>((resolve, reject) => {
          const server = net.createServer((sock) => {
            winSockets.add(sock);
            const session = attachSession((line) => {
              sock.write(line);
            });
            stopNetSessions.add(session);
            sock.on("data", (buf: Buffer) => {
              session.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
            });
            sock.on("end", () => {
              session.endInput();
            });
            sock.on("close", () => {
              winSockets.delete(sock);
              stopNetSessions.delete(session);
              session.dispose();
            });
            sock.on("error", () => {
              winSockets.delete(sock);
              stopNetSessions.delete(session);
              session.dispose();
            });
          });
          netServer = server;
          server.listen(options.listenPath, () => {
            resolve();
          });
          server.on("error", (err) => {
            reject(err);
          });
        });
        return;
      }

      if (existsSync(options.listenPath)) {
        try {
          unlinkSync(options.listenPath);
        } catch {
          /* stale or race — bind will surface EADDRINUSE */
        }
      }

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

      try {
        chmodSync(options.listenPath, 0o600);
      } catch {
        /* best-effort — platform-specific */
      }
    },

    async stop(): Promise<void> {
      if (netServer !== undefined) {
        const s = netServer;
        netServer = undefined;
        for (const sock of [...winSockets]) {
          sock.destroy();
        }
        winSockets.clear();
        stopNetSessions.clear();
        await new Promise<void>((resolve) => {
          s.close(() => resolve());
        });
        return;
      }

      if (bunListener !== undefined) {
        const l = bunListener;
        bunListener = undefined;
        for (const sess of [...sessions.values()]) {
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
