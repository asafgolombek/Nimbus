import { afterEach, describe, expect, test } from "bun:test";
import { generateBoxKeypair, openBoxFrame, sealBoxFrame } from "./lan-crypto.ts";
import { LanServer } from "./lan-server.ts";

let server: LanServer | undefined;

function makeServer(): LanServer {
  return new LanServer({
    bind: "127.0.0.1",
    port: 0,
    hostKeypair: generateBoxKeypair(),
    onMessage: async () => ({}),
    isKnownPeer: () => null,
    rateLimit: { checkAllowed: () => true, recordFailure: () => {}, recordSuccess: () => {} },
    pairing: {
      isOpen: () => false,
      consume: () => false,
      open: () => {},
      close: () => {},
      getExpiresAt: () => undefined,
    },
    registerPeer: () => "peer-id",
  });
}

describe("LanServer boot/stop", () => {
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  test("start exposes listenAddr on an available port", async () => {
    server = makeServer();
    await server.start();
    const addr = server.listenAddr();
    expect(addr).toBeTruthy();
    expect(addr?.port).toBeGreaterThan(0);
  });

  test("stop cleanly releases the port", async () => {
    server = makeServer();
    await server.start();
    await server.stop();
    server = undefined;
  });
});

async function sendEncryptedRpc(
  serverPubkey: Uint8Array,
  clientKeypair: ReturnType<typeof generateBoxKeypair>,
  serverPort: number,
  msg: { id: number; method: string; params?: unknown },
): Promise<{ result?: unknown; error?: { code: string; message: string } }> {
  const payload = new TextEncoder().encode(JSON.stringify(msg));
  const frame = sealBoxFrame(payload, serverPubkey, clientKeypair.secretKey);
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, frame.length, false);

  // Build hello handshake frame
  const helloMsg = JSON.stringify({
    kind: "hello",
    client_pubkey: Buffer.from(clientKeypair.publicKey).toString("base64"),
  });
  const helloBytes = new TextEncoder().encode(helloMsg);
  const helloHeader = new Uint8Array(4);
  new DataView(helloHeader.buffer).setUint32(0, helloBytes.length, false);

  return new Promise((resolve, reject) => {
    const conn = Bun.connect({
      hostname: "127.0.0.1",
      port: serverPort,
      socket: {
        open(socket) {
          socket.write(helloHeader);
          socket.write(helloBytes);
        },
        data(socket, chunk) {
          try {
            const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            if (chunk.length >= 4) {
              const len = view.getUint32(0, false);
              const body = chunk.slice(4, 4 + len);
              const text = new TextDecoder().decode(body);
              if (text.includes("hello_ok")) {
                // Now send encrypted RPC
                socket.write(header);
                socket.write(frame);
              } else {
                // Encrypted response
                const plain = openBoxFrame(body, serverPubkey, clientKeypair.secretKey);
                resolve(
                  JSON.parse(new TextDecoder().decode(plain)) as {
                    result?: unknown;
                    error?: { code: string; message: string };
                  },
                );
                socket.end();
              }
            }
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        },
        error(_, err) {
          reject(err);
        },
        close() {},
      },
    });
    setTimeout(() => {
      conn.then((s) => s.end());
      reject(new Error("timeout"));
    }, 3000);
  });
}

describe("LanServer gate (G4)", () => {
  let server: LanServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  async function makeGateServer(onMessageCalls: string[]): Promise<{
    hostKeypair: ReturnType<typeof generateBoxKeypair>;
    clientKeypair: ReturnType<typeof generateBoxKeypair>;
    port: number;
  }> {
    const hostKeypair = generateBoxKeypair();
    const clientKeypair = generateBoxKeypair();
    server = new LanServer({
      bind: "127.0.0.1",
      port: 0,
      hostKeypair,
      onMessage: async (method) => {
        onMessageCalls.push(method);
        return {};
      },
      isKnownPeer: () => ({ peerId: "test-peer", writeAllowed: false }),
      rateLimit: { checkAllowed: () => true, recordFailure: () => {}, recordSuccess: () => {} },
      pairing: {
        isOpen: () => false,
        consume: () => false,
        open: () => {},
        close: () => {},
        getExpiresAt: () => undefined,
      },
      registerPeer: () => "test-peer",
    });
    await server.start();
    return { hostKeypair, clientKeypair, port: server.listenAddr()!.port };
  }

  test("forbidden method (vault.list) is rejected with ERR_METHOD_NOT_ALLOWED", async () => {
    const calls: string[] = [];
    const { hostKeypair, clientKeypair, port } = await makeGateServer(calls);
    const resp = await sendEncryptedRpc(hostKeypair.publicKey, clientKeypair, port, {
      id: 1,
      method: "vault.list",
    });
    expect(resp.error?.message).toMatch(/ERR_METHOD_NOT_ALLOWED/);
    expect(calls.length).toBe(0);
  });

  test("write method without write grant is rejected with ERR_LAN_WRITE_FORBIDDEN", async () => {
    const calls: string[] = [];
    const { hostKeypair, clientKeypair, port } = await makeGateServer(calls);
    const resp = await sendEncryptedRpc(hostKeypair.publicKey, clientKeypair, port, {
      id: 1,
      method: "engine.ask",
    });
    expect(resp.error?.message).toMatch(/ERR_LAN_WRITE_FORBIDDEN/);
    expect(calls.length).toBe(0);
  });
});
