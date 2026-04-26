import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBenchRunnerMain } from "./bench-runner.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "bench-runner-test-"));
}

describe("runBenchRunnerMain", () => {
  test("generates a UUID, calls runBenchCli, and writes one history line", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const exitCode = await runBenchRunnerMain([
        "--surface",
        "S2-a",
        "--runs",
        "1",
        "--corpus",
        "small",
        "--gha",
        "--history",
        historyPath,
        "--fixture-cache",
        dir,
      ]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(readFileSync(historyPath, "utf8").trim());
      // run_id must be a UUID-shaped string (8-4-4-4-12 hex), not a placeholder.
      expect(parsed.run_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--help prints usage and exits 0 without writing history", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const lines: string[] = [];
      const exit = await runBenchRunnerMain(["--help"], {
        stdout: (s) => lines.push(s),
        historyPath,
      });
      expect(exit).toBe(0);
      expect(lines.join("\n")).toMatch(/Usage:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
