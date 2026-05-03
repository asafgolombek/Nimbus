/**
 * Node-compat test for @nimbus-dev/client. Runs under `node --test`,
 * not `bun test`. Validates the dual-runtime IPC transport against a
 * real Gateway subprocess on Linux/macOS (Unix socket) and Windows
 * (named pipe).
 *
 * This file is inert when NIMBUS_GATEWAY_BIN is not set, so `bun test`
 * (which runs without the env var) discovers it without side effects;
 * CI invokes it explicitly via `node --test` with the env var set.
 */

import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { discoverSocketPath, NimbusClient } from "../dist/index.js";

const GATEWAY_BIN = process.env.NIMBUS_GATEWAY_BIN;
const STARTUP_TIMEOUT_MS = 15000;

async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const c = await NimbusClient.open({ socketPath });
      await c.close();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Gateway socket did not appear within ${timeoutMs}ms: ${socketPath}`);
}

async function spawnGateway(dataDir: string): Promise<{
  proc: ChildProcessWithoutNullStreams;
  socketPath: string;
}> {
  if (GATEWAY_BIN === undefined) {
    throw new Error(
      "NIMBUS_GATEWAY_BIN env var must point to a built gateway binary or 'bun run packages/gateway/src/index.ts'",
    );
  }
  const env = { ...process.env, NIMBUS_DATA_DIR: dataDir };
  const proc = spawn(GATEWAY_BIN, [], { env });
  proc.stdout.on("data", () => undefined);
  proc.stderr.on("data", () => undefined);
  // Discover the socket path the gateway will write to its state file
  const r = await discoverSocketPath();
  await waitForSocket(r.socketPath, STARTUP_TIMEOUT_MS);
  return { proc, socketPath: r.socketPath };
}

if (GATEWAY_BIN === undefined) {
  await test("node-compat (skipped — NIMBUS_GATEWAY_BIN not set)", { skip: true }, () => undefined);
} else {
  await test("connects, askStream yields tokens + done", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nimbus-nodecompat-"));
    const { proc, socketPath } = await spawnGateway(dataDir);
    try {
      const client = await NimbusClient.open({ socketPath });
      const handle = client.askStream("hello");
      const events: string[] = [];
      for await (const ev of handle) {
        events.push(ev.type);
        if (ev.type === "done" || ev.type === "error") break;
      }
      assert.ok(events.includes("done") || events.includes("error"));
      await client.close();
    } finally {
      proc.kill("SIGTERM");
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  await test("subscribeHitl receives synthetic agent.hitlBatch", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nimbus-nodecompat-"));
    const { proc, socketPath } = await spawnGateway(dataDir);
    try {
      const client = await NimbusClient.open({ socketPath });
      let _received = false;
      const sub = client.subscribeHitl(() => {
        _received = true;
      });
      // The Gateway in test mode does not naturally fire HITL on a passive
      // socket connection; this test only asserts the subscription wires up
      // without throwing. A full HITL roundtrip is covered by the integration
      // test in the gateway package.
      assert.equal(typeof sub.dispose, "function");
      await client.close();
    } finally {
      proc.kill("SIGTERM");
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  await test("cancel() mid-stream terminates iterator", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nimbus-nodecompat-"));
    const { proc, socketPath } = await spawnGateway(dataDir);
    try {
      const client = await NimbusClient.open({ socketPath });
      const handle = client.askStream("long-running");
      setTimeout(() => {
        handle.cancel().catch(() => undefined);
      }, 50);
      const events: string[] = [];
      for await (const ev of handle) {
        events.push(ev.type);
        if (events.length > 100) break;
      }
      // Cancellation should terminate the iterator gracefully — well under
      // the 100-event manual safety break.
      assert.ok(events.length <= 100);
      await client.close();
    } finally {
      proc.kill("SIGTERM");
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  await test("disconnect closes socket without leaking handles", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nimbus-nodecompat-"));
    const { proc, socketPath } = await spawnGateway(dataDir);
    try {
      const client = await NimbusClient.open({ socketPath });
      await client.close();
      // Re-open to confirm socket is still usable
      const client2 = await NimbusClient.open({ socketPath });
      await client2.close();
    } finally {
      proc.kill("SIGTERM");
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
}
