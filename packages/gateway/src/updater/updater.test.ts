import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { Server } from "bun";
import nacl from "tweetnacl";
import { sha256Hex } from "./signature-verifier.ts";
import type { UpdateManifest } from "./types.ts";
import { Updater } from "./updater.ts";

let server: Server<undefined>;
let downloadServer: Server<undefined>;
const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(randomBytes(32)));

function buildManifest(binary: Uint8Array, version = "0.2.0"): UpdateManifest {
  const sha = sha256Hex(binary);
  const digest = Buffer.from(sha, "hex");
  const sig = nacl.sign.detached(new Uint8Array(digest), kp.secretKey);
  const sigB64 = Buffer.from(sig).toString("base64");
  const url = `http://localhost:${downloadServer.port}/bin`;
  return {
    version,
    pub_date: "2026-05-01T00:00:00Z",
    platforms: {
      "darwin-x86_64": { url, sha256: sha, signature: sigB64 },
      "darwin-aarch64": { url, sha256: sha, signature: sigB64 },
      "linux-x86_64": { url, sha256: sha, signature: sigB64 },
      "windows-x86_64": { url, sha256: sha, signature: sigB64 },
    },
  };
}

describe("Updater state machine", () => {
  afterEach(() => {
    server?.stop(true);
    downloadServer?.stop(true);
  });

  test("checkNow emits updateAvailable when manifest newer", async () => {
    const binary = new Uint8Array(randomBytes(512));
    downloadServer = Bun.serve({
      port: 0,
      fetch: () => new Response(binary),
    });
    server = Bun.serve({
      port: 0,
      fetch: () => Response.json(buildManifest(binary, "0.2.0")),
    });

    const events: string[] = [];
    const u = new Updater({
      currentVersion: "0.1.0",
      manifestUrl: `http://localhost:${server.port}/latest.json`,
      publicKey: kp.publicKey,
      target: "linux-x86_64",
      emit: (name) => events.push(name),
      timeoutMs: 2000,
    });
    const status = await u.checkNow();
    expect(status.updateAvailable).toBe(true);
    expect(events).toContain("updater.updateAvailable");
  });

  test("checkNow does not emit when versions equal", async () => {
    const binary = new Uint8Array(randomBytes(512));
    downloadServer = Bun.serve({ port: 0, fetch: () => new Response(binary) });
    server = Bun.serve({ port: 0, fetch: () => Response.json(buildManifest(binary, "0.1.0")) });
    const events: string[] = [];
    const u = new Updater({
      currentVersion: "0.1.0",
      manifestUrl: `http://localhost:${server.port}/latest.json`,
      publicKey: kp.publicKey,
      target: "linux-x86_64",
      emit: (name) => events.push(name),
      timeoutMs: 2000,
    });
    const status = await u.checkNow();
    expect(status.updateAvailable).toBe(false);
    expect(events).not.toContain("updater.updateAvailable");
  });

  test("applyUpdate verifies signature before invoking installer", async () => {
    const binary = new Uint8Array(randomBytes(512));
    downloadServer = Bun.serve({ port: 0, fetch: () => new Response(binary) });
    server = Bun.serve({ port: 0, fetch: () => Response.json(buildManifest(binary, "0.2.0")) });
    const invocations: string[] = [];
    const u = new Updater({
      currentVersion: "0.1.0",
      manifestUrl: `http://localhost:${server.port}/latest.json`,
      publicKey: kp.publicKey,
      target: "linux-x86_64",
      emit: () => {},
      timeoutMs: 2000,
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
    downloadServer = Bun.serve({ port: 0, fetch: () => new Response(tamperedBinary) });
    const manifest = buildManifest(binary, "0.2.0");
    server = Bun.serve({ port: 0, fetch: () => Response.json(manifest) });
    const invocations: string[] = [];
    const events: string[] = [];
    const u = new Updater({
      currentVersion: "0.1.0",
      manifestUrl: `http://localhost:${server.port}/latest.json`,
      publicKey: kp.publicKey,
      target: "linux-x86_64",
      emit: (name) => events.push(name),
      timeoutMs: 2000,
      invokeInstaller: async () => {
        invocations.push("install");
      },
    });
    await u.checkNow();
    await expect(u.applyUpdate()).rejects.toThrow(/signature|hash/i);
    expect(invocations).toEqual([]);
    expect(events).toContain("updater.rolledBack");
  });
});
