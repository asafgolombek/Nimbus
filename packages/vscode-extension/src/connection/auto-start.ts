import type { ChildProcess } from "node:child_process";

import type { Logger } from "../logging.js";

export type AutoStartResult =
  | { kind: "ok" }
  | { kind: "timeout"; socketPath: string }
  | { kind: "spawn-error"; message: string };

export interface AutoStartDeps {
  spawn: (cmd: string, args: string[]) => ChildProcess;
  pingSocket: (socketPath: string) => Promise<boolean>;
  log: Logger;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface AutoStarter {
  spawn(socketPath: string): Promise<AutoStartResult>;
}

export function createAutoStarter(deps: AutoStartDeps): AutoStarter {
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const pollMs = deps.pollIntervalMs ?? 200;
  return {
    spawn: async (socketPath): Promise<AutoStartResult> => {
      let spawnError: string | undefined;
      let proc: ChildProcess;
      try {
        proc = deps.spawn("nimbus", ["start"]);
      } catch (e) {
        return { kind: "spawn-error", message: e instanceof Error ? e.message : String(e) };
      }
      proc.on("error", (err) => {
        spawnError = err.message;
        deps.log.error(`nimbus start spawn error: ${err.message}`);
      });
      proc.unref?.();

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (spawnError !== undefined) return { kind: "spawn-error", message: spawnError };
        if (await deps.pingSocket(socketPath)) {
          deps.log.info(`Gateway socket ready at ${socketPath} after ${Date.now() - start}ms`);
          return { kind: "ok" };
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return { kind: "timeout", socketPath };
    },
  };
}
