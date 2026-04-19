import { afterEach, describe, expect, test } from "bun:test";
import { generateBoxKeypair } from "./lan-crypto.ts";
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
