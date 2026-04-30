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

  test("--protocol-confirmed allows --reference to proceed without interactive prompt", async () => {
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
        "--reference",
        "--protocol-confirmed",
        "--history",
        historyPath,
        "--fixture-cache",
        dir,
      ]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(readFileSync(historyPath, "utf8").trim());
      expect(parsed.runner).toBe("reference-m1air");
      expect(parsed.reference_protocol_compliant).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--reference without --protocol-confirmed refuses to record (default still gates)", async () => {
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
        "--reference",
        "--history",
        historyPath,
        "--fixture-cache",
        dir,
      ]);
      expect(exitCode).not.toBe(0);
      // history.jsonl must not exist or must be empty when the gate trips.
      let contents = "";
      try {
        contents = readFileSync(historyPath, "utf8");
      } catch {
        // file absent is also acceptable — the orchestrator refused before writing
      }
      expect(contents.trim()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--protocol-confirmed without --reference is a no-op (flag is ignored on non-reference runs)", async () => {
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
        "--protocol-confirmed",
        "--history",
        historyPath,
        "--fixture-cache",
        dir,
      ]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(readFileSync(historyPath, "utf8").trim());
      expect(parsed.runner).toMatch(/^gha-/);
      // The reference-protocol-compliant field is only set on reference runs;
      // a --gha run with --protocol-confirmed must NOT carry this field.
      expect(parsed.reference_protocol_compliant).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
