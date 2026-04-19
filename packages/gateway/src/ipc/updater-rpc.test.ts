import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { Updater } from "../updater/updater.ts";
import { jsonResponse, makeKeypair } from "../updater/updater-test-fixtures.ts";
import { dispatchUpdaterRpc } from "./updater-rpc.ts";
import { expectRpcError } from "./updater-rpc-test-helpers.ts";

let server: Server<unknown>;
const kp = makeKeypair();

describe("dispatchUpdaterRpc", () => {
  afterEach(() => {
    server?.stop(true);
  });

  test("getStatus returns current state", async () => {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => jsonResponse({ version: "0.1.0" }),
    });
    const u = new Updater({
      currentVersion: "0.1.0",
      manifestUrl: `http://127.0.0.1:${server.port}/latest.json`,
      publicKey: kp.publicKey,
      target: "linux-x86_64",
      emit: () => {},
      timeoutMs: 1000,
    });
    const result = (await dispatchUpdaterRpc("updater.getStatus", {}, { updater: u })) as Record<
      string,
      unknown
    >;
    expect(result["state"]).toBeDefined();
    expect(result["currentVersion"]).toBe("0.1.0");
  });

  test("unknown method rejected", async () => {
    await expect(
      dispatchUpdaterRpc("updater.bogus", {}, { updater: undefined }),
    ).rejects.toBeInstanceOf(Error);
  });

  test("returns -32603 with ERR_UPDATER_MANIFEST_UNREACHABLE in message when fetch fails", async () => {
    const u = new Updater({
      currentVersion: "0.1.0",
      manifestUrl: "http://127.0.0.1:1/does-not-exist",
      publicKey: kp.publicKey,
      target: "linux-x86_64",
      emit: () => {},
      timeoutMs: 500,
    });
    await expectRpcError(
      dispatchUpdaterRpc("updater.checkNow", {}, { updater: u }),
      -32603,
      /ERR_UPDATER_MANIFEST_UNREACHABLE/,
    );
  });
});
