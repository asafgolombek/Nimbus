import { expect } from "bun:test";
import { UpdaterRpcError } from "./updater-rpc.ts";

export async function expectRpcError(
  promise: Promise<unknown>,
  code: number,
  pattern: RegExp,
): Promise<void> {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UpdaterRpcError);
  expect((err as UpdaterRpcError).rpcCode).toBe(code);
  expect((err as UpdaterRpcError).message).toMatch(pattern);
}
