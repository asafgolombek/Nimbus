import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Subprocess-level coverage for `index.ts`'s TWO special-cased dispatch branches — `bench` and
 * `fleet` — which exist because both commands return `Promise<number>` and `COMMAND_HANDLERS`'
 * generic path (`await handler(args)`) DISCARDS a handler's return value (the map's type is
 * `Promise<void> | void`). Putting either command inside `COMMAND_HANDLERS` instead of its special
 * case would silently keep `process.exitCode` at its default (0) no matter what the command
 * actually did — the exact regression this review found and fixed for `fleet`, and one `bench`
 * shares by construction. Nothing caught it before this file: `bench.test.ts` and `fleet.test.ts`
 * cover the handler functions in isolation, never `index.ts`'s own two `if (command === …)`
 * branches that route a return value into `process.exitCode`.
 *
 * Both cases below are chosen to be FAST and to need no live Gateway:
 * - `bench` with no `--surface`/`--all` returns `2` from `runBenchCli` before any benchmark work
 *   starts (`bench-cli.ts`'s own early return).
 * - `fleet` with an unparseable subcommand returns `FLEET_EXIT_CODES.usage` (`1`) from
 *   `parseFleetArgs` failing, before `runFleet` ever attempts to connect.
 *
 * A regression that swapped either special case for a `COMMAND_HANDLERS` entry would make both
 * assertions below fail: real process exit code `0`, expected `2` / `1`.
 */
function isolatedEnvOverrides(): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), "nimbus-index-exit-codes-"));
  return {
    LOCALAPPDATA: root,
    APPDATA: root,
    XDG_DATA_HOME: root,
    XDG_CONFIG_HOME: root,
    XDG_RUNTIME_DIR: root,
    HOME: root,
  };
}

describe("index.ts exit-code special cases (bench, fleet)", () => {
  const cliEntry = fileURLToPath(new URL("../../src/index.ts", import.meta.url));

  async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn({
      cmd: [process.execPath, "run", cliEntry, ...args],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...isolatedEnvOverrides(), NIMBUS_QUIET: "1" },
    });
    const code = await proc.exited;
    return {
      code,
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text(),
    };
  }

  test("`nimbus bench` with no --surface/--all propagates runBench's own exit code (2), not 0", async () => {
    const out = await runCli(["bench"]);
    expect(out.code).toBe(2);
  });

  test("`nimbus bench --help` propagates 0 (both codes must be REACHABLE, not just the nonzero one)", async () => {
    const out = await runCli(["bench", "--help"]);
    expect(out.code).toBe(0);
  });

  test("`nimbus fleet <unparseable>` propagates FLEET_EXIT_CODES.usage (1), not 0", async () => {
    const out = await runCli(["fleet", "frobnicate"]);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("Usage: nimbus fleet");
  });
});
