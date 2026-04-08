import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { platform } from "node:os";
import net from "node:net";

import { ConsentDisconnectedError } from "./consent.ts";
import {
  IPC_MAX_LINE_BYTES,
  JsonRpcParseError,
  NdjsonLineReader,
  encodeLine,
  parseJsonRpcLine,
} from "./jsonrpc.ts";
import { createIpcServer } from "./server.ts";
import { MockVault } from "../vault/mock.ts";

describe("ipc jsonrpc", () => {
  test("parseJsonRpcLine accepts request with id", () => {
    const msg = parseJsonRpcLine(
      '{"jsonrpc":"2.0","id":"1","method":"gateway.ping"}',
    );
    expect(msg).toEqual({
      jsonrpc: "2.0",
      id: "1",
      method: "gateway.ping",
    });
  });

  test("parseJsonRpcLine accepts notification without id", () => {
    const msg = parseJsonRpcLine(
      '{"jsonrpc":"2.0","method":"consent.request","params":{"x":1}}',
    );
    expect(msg).toEqual({
      jsonrpc: "2.0",
      method: "consent.request",
      params: { x: 1 },
    });
  });

  test("NdjsonLineReader rejects line over 1MB", () => {
    const r = new NdjsonLineReader();
    const huge = `${"x".repeat(IPC_MAX_LINE_BYTES + 1)}\n`;
    expect(() => r.push(new TextEncoder().encode(huge))).toThrow(
      JsonRpcParseError,
    );
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

async function rpcPing(listenPath: string): Promise<string> {
  const req = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "gateway.ping",
  })}\n`;

  if (platform() === "win32") {
    return await new Promise<string>((resolve, reject) => {
      let buf = "";
      const sock = net.createConnection(listenPath);
      sock.on("connect", () => {
        sock.write(req);
      });
      sock.on("data", (b: Buffer) => {
        buf += b.toString("utf8");
        const i = buf.indexOf("\n");
        if (i >= 0) {
          resolve(buf.slice(0, i));
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
          socket.write(req);
        },
        data(socket, chunk: Uint8Array) {
          buf += new TextDecoder().decode(chunk);
          const i = buf.indexOf("\n");
          if (i >= 0) {
            resolve(buf.slice(0, i));
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

describe("ipc server integration", () => {
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
            buf += b.toString("utf8");
            const i = buf.indexOf("\n");
            if (i >= 0) {
              resolve(buf.slice(0, i));
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
