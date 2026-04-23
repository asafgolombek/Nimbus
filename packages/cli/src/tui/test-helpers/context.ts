import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IpcContextValue } from "../ipc-context.ts";
import type { StubIpcClient } from "./stub-client.ts";

/**
 * Silent pino-shaped logger. Every level is a no-op; satisfies the `Logger`
 * type via `as unknown as` since we never assert on log output in TUI tests.
 */
export const silentLogger: IpcContextValue["logger"] = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as IpcContextValue["logger"];

/** Build an `IpcContextValue` around a stub client with a silent logger. */
export function ipcContextFor(stub: StubIpcClient): IpcContextValue {
  return {
    client: stub.asClient(),
    logger: silentLogger,
  };
}

/**
 * Allocate a fresh history-file path inside a disposable tmp dir. Returns the
 * path and a `cleanup` function that removes the tmp dir recursively.
 */
export function makeHistoryPath(prefix = "nimbus-tui-"): {
  readonly path: string;
  readonly cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    path: join(dir, "hist.json"),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
