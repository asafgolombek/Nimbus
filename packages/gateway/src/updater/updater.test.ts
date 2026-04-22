import { afterEach, describe, expect, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { Server } from "bun";
import type { UpdaterEmit, UpdaterOptions } from "./updater.ts";
import { Updater } from "./updater.ts";
import { buildSignedManifest, jsonResponse, makeKeypair } from "./updater-test-fixtures.ts";

const kp = makeKeypair();

let server: Server<undefined>;
let downloadServer: Server<undefined>;

function makeUpdater(overrides?: Partial<UpdaterOptions>): Updater {
  return new Updater({
    currentVersion: "0.1.0",
    manifestUrl: `http://127.0.0.1:${server.port}/latest.json`,
    publicKey: kp.publicKey,
    target: "linux-x86_64",
    emit: () => {},
    timeoutMs: 2000,
    ...overrides,
  });
}

describe("Updater state machine", () => {
  afterEach(() => {
    server?.stop(true);
    downloadServer?.stop(true);
  });

  test("checkNow emits updateAvailable when manifest newer", async () => {
    const binary = new Uint8Array(randomBytes(512));
    downloadServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(binary),
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        jsonResponse(
          buildSignedManifest(binary, kp, `http://127.0.0.1:${downloadServer.port}/bin`, "0.2.0"),
        ),
    });
    const events: string[] = [];
    const status = await makeUpdater({ emit: (name) => events.push(name) }).checkNow();
    expect(status.updateAvailable).toBe(true);
    expect(events).toContain("updater.updateAvailable");
  });

  test("checkNow does not emit when versions equal", async () => {
    const binary = new Uint8Array(randomBytes(512));
    downloadServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(binary),
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        jsonResponse(
          buildSignedManifest(binary, kp, `http://127.0.0.1:${downloadServer.port}/bin`, "0.1.0"),
        ),
    });
    const events: string[] = [];
    const status = await makeUpdater({ emit: (name) => events.push(name) }).checkNow();
    expect(status.updateAvailable).toBe(false);
    expect(events).not.toContain("updater.updateAvailable");
  });

  test("applyUpdate verifies signature before invoking installer", async () => {
    const binary = new Uint8Array(randomBytes(512));
    downloadServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(binary),
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        jsonResponse(
          buildSignedManifest(binary, kp, `http://127.0.0.1:${downloadServer.port}/bin`),
        ),
    });
    const invocations: string[] = [];
    const u = makeUpdater({
      invokeInstaller: async () => {
        invocations.push("install");
      },
    });
    await u.checkNow();
    await u.applyUpdate();
    expect(invocations).toEqual(["install"]);
  });

  test("applyUpdate rejects tampered binary and does not invoke installer", async () => {
    const binary = new Uint8Array(randomBytes(512));
    const tamperedBinary = new Uint8Array(randomBytes(512));
    downloadServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(tamperedBinary),
    });
    const manifest = buildSignedManifest(binary, kp, `http://127.0.0.1:${downloadServer.port}/bin`);
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => jsonResponse(manifest) });
    const invocations: string[] = [];
    const events: string[] = [];
    const u = makeUpdater({
      emit: (name) => events.push(name),
      invokeInstaller: async () => {
        invocations.push("install");
      },
    });
    await u.checkNow();
    await expect(u.applyUpdate()).rejects.toThrow(/signature|hash/i);
    expect(invocations).toEqual([]);
    expect(events).toContain("updater.rolledBack");
  });

  test("applyUpdate emits downloadProgress events during streaming fetch", async () => {
    const progressEvents: Array<{ bytes: number; total: number }> = [];
    const emit = mock((name: Parameters<UpdaterEmit>[0], payload?: Record<string, unknown>) => {
      if (name === "updater.downloadProgress") {
        progressEvents.push(payload as { bytes: number; total: number });
      }
    }) as UpdaterEmit;

    const chunk = new Uint8Array(256);
    downloadServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(chunk);
            c.enqueue(chunk);
            c.close();
          },
        });
        return new Response(stream, {
          headers: { "content-length": "512", "content-type": "application/octet-stream" },
        });
      },
    });

    // Use a valid manifest signed against the real binary so verification fails
    // at hash/sig rather than before progress events are emitted
    const binary = new Uint8Array(randomBytes(512));
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        jsonResponse(
          buildSignedManifest(binary, kp, `http://127.0.0.1:${downloadServer.port}/bin`),
        ),
    });

    const u = makeUpdater({ emit });
    await u.checkNow();

    // applyUpdate will throw at hash/sig verification (tampered binary), but
    // downloadProgress events must have been emitted before that point
    await u.applyUpdate().catch(() => {});

    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    // total comes from content-length header; some servers omit it for streaming (ok to be 0)
    expect(typeof progressEvents[0]?.total).toBe("number");
    const last = progressEvents.at(-1)!;
    expect(last.bytes).toBe(512);
  });
});
