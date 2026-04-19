import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { Server } from "bun";
import nacl from "tweetnacl";
import { Updater } from "../updater/updater.ts";
import { dispatchUpdaterRpc, UpdaterRpcError } from "./updater-rpc.ts";

let server: Server<unknown>;
const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(randomBytes(32)));

async function expectRpcError(
  promise: Promise<unknown>,
  code: number,
  pattern: RegExp,
): Promise<void> {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UpdaterRpcError);
  expect((err as UpdaterRpcError).rpcCode).toBe(code);
  expect((err as UpdaterRpcError).message).toMatch(pattern);
}

describe("dispatchUpdaterRpc", () => {
  afterEach(() => {
    server?.stop(true);
  });

  test("getStatus returns current state", async () => {
    server = Bun.serve({ port: 0, fetch: () => Response.json({ version: "0.1.0" }) });
    const u = new Updater({
      currentVersion: "0.1.0",
      manifestUrl: `http://localhost:${server.port}/latest.json`,
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
    ).rejects.toBeInstanceOf(UpdaterRpcError);
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
