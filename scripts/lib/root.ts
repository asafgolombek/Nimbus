import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (parent of `scripts/`). */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type RunOptions = {
  /** Merged onto `process.env` for the child process. */
  env?: Record<string, string>;
};

export function run(
  cmd: readonly string[],
  cwd: string = REPO_ROOT,
  options?: RunOptions,
): void {
  const proc = Bun.spawnSync([...cmd], {
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
    env:
      options?.env !== undefined
        ? { ...process.env, ...options.env }
        : process.env,
  });
  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode ?? 1);
  }
}
