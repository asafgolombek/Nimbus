import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { dispatchUpdaterRpc, UpdaterRpcError } from "../../../src/ipc/updater-rpc.ts";
import { Updater } from "../../../src/updater/updater.ts";

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

describe("updater + air-gap", () => {
  test("when updater is not configured, returns rpcCode -32602", async () => {
    await expectRpcError(
      dispatchUpdaterRpc("updater.checkNow", {}, { updater: undefined }),
      -32602,
      /ERR_UPDATER_NOT_CONFIGURED/,
    );
  });

  test("fetch failure surfaces as -32603 with ERR_UPDATER_MANIFEST_UNREACHABLE in message", async () => {
    const u = new Updater({
      currentVersion: "0.1.0",
      manifestUrl: "http://127.0.0.1:1/no",
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
