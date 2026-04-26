import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBenchCli } from "./bench-cli.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "bench-cli-test-"));
}

describe("runBenchCli", () => {
  test("--surface S2-a --runs 1 writes a HistoryLine with the S2-a entry", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const exitCode = await runBenchCli(
        ["--surface", "S2-a", "--runs", "1", "--corpus", "small", "--gha"],
        { runId: "test-run-1", historyPath, fixtureCacheDir: dir, stdout: () => {} },
      );
      expect(exitCode).toBe(0);
      const line = JSON.parse(readFileSync(historyPath, "utf8").trim());
      expect(line.surfaces["S2-a"]).toBeDefined();
      expect(line.surfaces["S2-a"].samples_count).toBe(100);
      expect(line.runner).toMatch(/^gha-/);
      expect(line.run_id).toBe("test-run-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--reference without protocol confirmation refuses to run", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const stderr: string[] = [];
      const exitCode = await runBenchCli(
        ["--surface", "S2-a", "--runs", "1", "--corpus", "small", "--reference"],
        {
          runId: "test-run-2",
          historyPath,
          fixtureCacheDir: dir,
          stdout: () => {},
          stderr: (s) => stderr.push(s),
          confirmReferenceProtocol: () => false,
        },
      );
      expect(exitCode).not.toBe(0);
      expect(stderr.join("\n")).toMatch(/protocol/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
