import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

import { LocalIndex } from "../index/local-index.ts";
import { MockVault } from "../vault/mock.ts";
import { ConsentDisconnectedError } from "./consent.ts";
import {
  encodeLine,
  IPC_MAX_LINE_BYTES,
  JsonRpcParseError,
  NdjsonLineReader,
  parseJsonRpcLine,
} from "./jsonrpc.ts";
import { createIpcServer } from "./server.ts";

/** Accumulate UTF-8 chunks and return the first complete line (excluding `\n`) when present. */
function appendAndTakeFirstLine(buffer: string, chunk: string): { next: string; line?: string } {
  const combined = buffer + chunk;
  const nl = combined.indexOf("\n");
  if (nl < 0) {
    return { next: combined };
  }
  return { next: combined.slice(nl + 1), line: combined.slice(0, nl) };
}

describe("ipc jsonrpc", () => {
  test("parseJsonRpcLine accepts request with id", () => {
    const msg = parseJsonRpcLine('{"jsonrpc":"2.0","id":"1","method":"gateway.ping"}');
    expect(msg).toEqual({
      jsonrpc: "2.0",
      id: "1",
      method: "gateway.ping",
    });
  });

  test("parseJsonRpcLine accepts notification without id", () => {
    const msg = parseJsonRpcLine('{"jsonrpc":"2.0","method":"consent.request","params":{"x":1}}');
    expect(msg).toEqual({
      jsonrpc: "2.0",
      method: "consent.request",
      params: { x: 1 },
    });
  });

  test("NdjsonLineReader rejects line over 1MB", () => {
    const r = new NdjsonLineReader();
    const huge = `${"x".repeat(IPC_MAX_LINE_BYTES + 1)}\n`;
    expect(() => r.push(new TextEncoder().encode(huge))).toThrow(JsonRpcParseError);
  });

  test("encodeLine produces valid NDJSON", () => {
    const line = encodeLine({
      jsonrpc: "2.0",
      id: "a",
      result: { ok: true },
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.trim())).toEqual({
      jsonrpc: "2.0",
      id: "a",
      result: { ok: true },
    });
  });
});

function testListenPath(): string {
  if (platform() === "win32") {
    return String.raw`\\.\pipe\nimbus-ipc-test-${randomUUID()}`;
  }
  return join(mkdtempSync(join(tmpdir(), "nimbus-ipc-")), "sock");
}

function jsonRpcNdjsonLine(method: string, id: number, params?: unknown): string {
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id,
    method,
  };
  if (params !== undefined) {
    body["params"] = params;
  }
  return `${JSON.stringify(body)}\n`;
}

async function exchangeFirstNdjsonLine(listenPath: string, lineToWrite: string): Promise<string> {
  if (platform() === "win32") {
    return await new Promise<string>((resolve, reject) => {
      let buf = "";
      const sock = net.createConnection(listenPath);
      sock.on("connect", () => {
        sock.write(lineToWrite);
      });
      sock.on("data", (b: Buffer) => {
        const { next, line } = appendAndTakeFirstLine(buf, b.toString("utf8"));
        buf = next;
        if (line !== undefined) {
          resolve(line);
          sock.end();
        }
      });
      sock.on("error", reject);
    });
  }

  return await new Promise<string>((resolve, reject) => {
    let buf = "";
    Bun.connect({
      unix: listenPath,
      socket: {
        open(socket) {
          socket.write(lineToWrite);
        },
        data(socket, chunk: Uint8Array) {
          const { next, line } = appendAndTakeFirstLine(buf, new TextDecoder().decode(chunk));
          buf = next;
          if (line !== undefined) {
            resolve(line);
            socket.end();
          }
        },
        error() {
          reject(new Error("socket error"));
        },
      },
    }).catch(reject);
  });
}

async function rpcCall(listenPath: string, method: string, params: unknown): Promise<string> {
  return exchangeFirstNdjsonLine(listenPath, jsonRpcNdjsonLine(method, 42, params));
}

async function rpcPing(listenPath: string): Promise<string> {
  return exchangeFirstNdjsonLine(listenPath, jsonRpcNdjsonLine("gateway.ping", 1));
}

describe("ipc server integration", () => {
  test("connector.listStatus over IPC", async () => {
    const listenPath = testListenPath();
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const localIndex = new LocalIndex(db);
    localIndex.ensureConnectorSchedulerRegistration("google_drive", 30_000, Date.now());

    const server = createIpcServer({
      listenPath,
      vault: new MockVault(),
      version: "t",
      localIndex,
      openUrl: async () => {},
    });
    await server.start();
    try {
      const line = await rpcCall(listenPath, "connector.listStatus", {});
      const res = JSON.parse(line) as { result?: Array<{ serviceId: string }> };
      expect(res.result?.length).toBe(1);
      expect(res.result?.[0]?.serviceId).toBe("google_drive");
    } finally {
      await server.stop();
    }
  });

  test("gateway.ping over IPC transport", async () => {
    const listenPath = testListenPath();
    const server = createIpcServer({
      listenPath,
      vault: new MockVault(),
      version: "test-0",
      startedAtMs: Date.now() - 10_000,
    });
    await server.start();
    try {
      const line = await rpcPing(listenPath);
      const res = JSON.parse(line) as { result?: { version: string; uptime: number } };
      expect(res.result?.version).toBe("test-0");
      expect(typeof res.result?.uptime).toBe("number");
    } finally {
      await server.stop();
    }
  });

  test("consent.request and consent.respond for same client", async () => {
    const listenPath = testListenPath();
    const clientIds: string[] = [];
    const server = createIpcServer({
      listenPath,
      vault: new MockVault(),
      version: "t",
      onClientConnected: (id) => {
        clientIds.push(id);
      },
    });
    await server.start();

    try {
      if (platform() === "win32") {
        let buf = "";
        const sock = net.createConnection(listenPath);
        await new Promise<void>((resolve, reject) => {
          sock.on("connect", () => resolve());
          sock.on("error", reject);
        });
        await new Promise<void>((r) => setImmediate(r));
        expect(clientIds.length).toBe(1);
        const idA = clientIds[0];
        if (idA === undefined) {
          throw new Error("expected client id");
        }

        let consentP!: Promise<boolean>;
        const notifLine = await new Promise<string>((resolve, reject) => {
          sock.on("data", (b: Buffer) => {
            const { next, line } = appendAndTakeFirstLine(buf, b.toString("utf8"));
            buf = next;
            if (line !== undefined) {
              resolve(line);
            }
          });
          const t = setTimeout(() => reject(new Error("timeout")), 5000);
          consentP = server.consent.requestConsent(idA, {
            requestId: "r-consent-1",
            prompt: "Test?",
          });
          void consentP.finally(() => clearTimeout(t));
        });

        const notif = JSON.parse(notifLine) as { method?: string };
        expect(notif.method).toBe("consent.request");

        sock.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "consent.respond",
            params: { requestId: "r-consent-1", approved: true },
          })}\n`,
        );

        await expect(consentP).resolves.toBe(true);
        sock.end();
      } else {
        let buf = "";
        let consentP!: Promise<boolean>;
        const sock = await Bun.connect({
          unix: listenPath,
          socket: {
            data(_socket, chunk: Uint8Array) {
              buf += new TextDecoder().decode(chunk);
            },
          },
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(clientIds.length).toBe(1);
        const idA = clientIds[0];
        if (idA === undefined) {
          throw new Error("expected client id");
        }

        const notifLine = await new Promise<string>((resolve, reject) => {
          const iv = setInterval(() => {
            const i = buf.indexOf("\n");
            if (i >= 0) {
              clearInterval(iv);
              resolve(buf.slice(0, i));
            }
          }, 5);
          const to = setTimeout(() => {
            clearInterval(iv);
            reject(new Error("timeout"));
          }, 5000);
          consentP = server.consent.requestConsent(idA, {
            requestId: "r-consent-1",
            prompt: "Test?",
          });
          void consentP.finally(() => clearTimeout(to));
        });

        const notif = JSON.parse(notifLine) as { method?: string };
        expect(notif.method).toBe("consent.request");

        sock.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "consent.respond",
            params: { requestId: "r-consent-1", approved: true },
          })}\n`,
        );

        await expect(consentP).resolves.toBe(true);
        sock.end();
      }
    } finally {
      await server.stop();
    }
  });

  test("agent.invoke uses registered handler", async () => {
    const listenPath = testListenPath();
    const server = createIpcServer({
      listenPath,
      vault: new MockVault(),
      version: "t",
    });
    server.setAgentInvokeHandler(async () => ({ reply: "from-handler" }));
    await server.start();
    try {
      const req = `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "agent.invoke",
        params: { input: "hi", stream: false },
      })}\n`;
      const line = await exchangeFirstNdjsonLine(listenPath, req);
      const res = JSON.parse(line) as { result?: { reply?: string } };
      expect(res.result?.reply).toBe("from-handler");
    } finally {
      await server.stop();
    }
  });

  test("pending consent rejects when client disconnects", async () => {
    const listenPath = testListenPath();
    const clientIds: string[] = [];
    const server = createIpcServer({
      listenPath,
      vault: new MockVault(),
      version: "t",
      onClientConnected: (id) => {
        clientIds.push(id);
      },
    });
    await server.start();

    try {
      if (platform() === "win32") {
        const sock = net.createConnection(listenPath);
        await new Promise<void>((resolve, reject) => {
          sock.on("connect", () => resolve());
          sock.on("error", reject);
        });
        await new Promise<void>((r) => setImmediate(r));
        const idA = clientIds[0];
        if (idA === undefined) {
          throw new Error("expected client id");
        }
        const consentP = server.consent.requestConsent(idA, {
          requestId: "r-disc",
          prompt: "x",
        });
        await new Promise<void>((r) => setTimeout(r, 50));
        sock.destroy();
        await expect(consentP).rejects.toBeInstanceOf(ConsentDisconnectedError);
      } else {
        const sock = await Bun.connect({
          unix: listenPath,
          socket: {
            data() {},
          },
        });
        await new Promise((r) => setTimeout(r, 0));
        const idA = clientIds[0];
        if (idA === undefined) {
          throw new Error("expected client id");
        }
        const consentP = server.consent.requestConsent(idA, {
          requestId: "r-disc",
          prompt: "x",
        });
        await new Promise((r) => setTimeout(r, 50));
        sock.end();
        await expect(consentP).rejects.toBeInstanceOf(ConsentDisconnectedError);
      }
    } finally {
      await server.stop();
    }
  });
});
