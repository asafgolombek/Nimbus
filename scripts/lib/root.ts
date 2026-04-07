import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (parent of `scripts/`). */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function run(cmd: readonly string[], cwd: string = REPO_ROOT): void {
  const proc = Bun.spawnSync([...cmd], {
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode ?? 1);
  }
}
