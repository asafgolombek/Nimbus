/**
 * IPC client — JSON-RPC 2.0 over newline-delimited JSON
 *
 * Transport:
 * - Windows: `node:net` to the named pipe path (e.g. `\\.\pipe\nimbus-gateway`)
 * - macOS/Linux: `Bun.connect` Unix domain socket
 *
 * See dev-plan-q1.md §3.4, architecture.md §IPC Protocol
 */

import { randomUUID } from "node:crypto";
import net from "node:net";
import { platform } from "node:os";

const IPC_MAX_LINE_BYTES = 1024 * 1024;

class NdjsonLineReader {
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  private pending = "";

  push(chunk: Uint8Array): string[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    const out: string[] = [];
    while (true) {
      const nl = this.pending.indexOf("\n");
      if (nl < 0) {
        break;
      }
      const line = this.pending.slice(0, nl);
      this.pending = this.pending.slice(nl + 1);
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (trimmed.length === 0) {
        continue;
      }
      if (new TextEncoder().encode(trimmed).length > IPC_MAX_LINE_BYTES) {
        throw new Error("Message exceeds 1MB line limit");
      }
      out.push(trimmed);
    }
    if (new TextEncoder().encode(this.pending).length > IPC_MAX_LINE_BYTES) {
      throw new Error("Message exceeds 1MB line limit");
    }
    return out;
  }
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

function idKey(id: string | number): string {
  return typeof id === "number" ? `n:${id}` : `s:${id}`;
}

export class IPCClient {
  private readonly socketPath: string;
  private reader = new NdjsonLineReader();
  private readonly pending = new Map<string, Pending>();
  private readonly notifHandlers = new Map<string, Set<(params: unknown) => void>>();
  private bunSocket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private netSocket: net.Socket | null = null;
  private connected = false;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.reader = new NdjsonLineReader();

    if (platform() === "win32") {
      await new Promise<void>((resolve, reject) => {
        const sock = net.createConnection(this.socketPath);
        sock.on("connect", () => {
          this.netSocket = sock;
          this.connected = true;
          resolve();
        });
        sock.on("error", (err) => {
          reject(err);
        });
        sock.on("data", (buf: Buffer) => {
          try {
            this.ingest(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
          } catch (e) {
            this.failAll(e);
          }
        });
        sock.on("close", () => {
          this.connected = false;
          this.netSocket = null;
          this.failAll(new Error("IPC connection closed"));
        });
      });
      return;
    }

    this.bunSocket = await Bun.connect({
      unix: this.socketPath,
      socket: {
        data: (_socket, chunk: Uint8Array) => {
          try {
            this.ingest(chunk);
          } catch (e) {
            this.failAll(e);
          }
        },
        close: () => {
          this.connected = false;
          this.bunSocket = null;
          this.failAll(new Error("IPC connection closed"));
        },
        error: () => {
          this.connected = false;
          this.bunSocket = null;
          this.failAll(new Error("IPC connection error"));
        },
      },
    });
    this.connected = true;
  }

  async call<T>(method: string, params?: unknown): Promise<T> {
    if (!this.connected) {
      throw new Error("IPC client is not connected");
    }
    const id = randomUUID();
    const line = `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    })}\n`;

    return await new Promise<T>((resolve, reject) => {
      this.pending.set(idKey(id), {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.rawWrite(line);
    });
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    let set = this.notifHandlers.get(method);
    if (set === undefined) {
      set = new Set();
      this.notifHandlers.set(method, set);
    }
    set.add(handler);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.failAll(new Error("IPC disconnected"));
    if (this.netSocket !== null) {
      this.netSocket.end();
      this.netSocket = null;
    }
    if (this.bunSocket !== null) {
      this.bunSocket.end();
      this.bunSocket = null;
    }
  }

  private rawWrite(s: string): void {
    if (this.netSocket !== null) {
      this.netSocket.write(s);
      return;
    }
    if (this.bunSocket !== null) {
      this.bunSocket.write(s);
    }
  }

  private ingest(chunk: Uint8Array): void {
    const lines = this.reader.push(chunk);
    for (const line of lines) {
      this.dispatchLine(line);
    }
  }

  private dispatchLine(line: string): void {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (o["jsonrpc"] !== "2.0") {
      return;
    }
    if (Object.hasOwn(o, "id")) {
      const id = o["id"];
      if (typeof id !== "string" && typeof id !== "number") {
        return;
      }
      const pend = this.pending.get(idKey(id));
      if (pend === undefined) {
        return;
      }
      this.pending.delete(idKey(id));
      if (Object.hasOwn(o, "error")) {
        const err = o["error"];
        const msg =
          typeof err === "object" &&
          err !== null &&
          "message" in err &&
          typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "JSON-RPC error";
        pend.reject(new Error(msg));
        return;
      }
      pend.resolve(Object.hasOwn(o, "result") ? o["result"] : undefined);
      return;
    }
    if (typeof o["method"] === "string") {
      const params = Object.hasOwn(o, "params") ? o["params"] : undefined;
      const set = this.notifHandlers.get(o["method"]);
      if (set !== undefined) {
        for (const h of set) {
          h(params);
        }
      }
    }
  }

  private failAll(reason: unknown): void {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    if (this.pending.size === 0) {
      return;
    }
    for (const p of this.pending.values()) {
      p.reject(err);
    }
    this.pending.clear();
  }
}
