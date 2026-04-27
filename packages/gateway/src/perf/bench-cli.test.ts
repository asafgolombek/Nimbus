import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBenchCli } from "./bench-cli.ts";

let dir = "";
let historyPath = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bench-cli-test-"));
  historyPath = join(dir, "history.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readHistoryLine(): {
  surfaces: Record<string, { samples_count: number; stub_reason?: string }>;
  runner: string;
  run_id: string;
} {
  return JSON.parse(readFileSync(historyPath, "utf8").trim());
}

describe("runBenchCli", () => {
  test("--surface S2-a --runs 1 writes a HistoryLine with the S2-a entry", async () => {
    const exitCode = await runBenchCli(
      ["--surface", "S2-a", "--runs", "1", "--corpus", "small", "--gha"],
      { runId: "test-run-1", historyPath, fixtureCacheDir: dir, stdout: () => {} },
    );
    expect(exitCode).toBe(0);
    const line = readHistoryLine();
    expect(line.surfaces["S2-a"]).toBeDefined();
    expect(line.surfaces["S2-a"]?.samples_count).toBe(100);
    expect(line.runner).toMatch(/^gha-/);
    expect(line.run_id).toBe("test-run-1");
  });

  test("--reference without protocol confirmation refuses to run", async () => {
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
  });
});

describe("runBenchCli — PR-B-2a registrations", () => {
  test("--surface S3 records a stub entry with stub_reason", async () => {
    const exitCode = await runBenchCli(["--surface", "S3", "--runs", "1", "--gha"], {
      runId: "stub-test",
      historyPath,
      fixtureCacheDir: dir,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    const line = readHistoryLine();
    expect(line.surfaces["S3"]?.samples_count).toBe(0);
    expect(typeof line.surfaces["S3"]?.stub_reason).toBe("string");
    expect((line.surfaces["S3"]?.stub_reason ?? "").length).toBeGreaterThan(0);
  });

  test("--surface S2-c on --gha records a reference-only stub entry", async () => {
    const exitCode = await runBenchCli(["--surface", "S2-c", "--runs", "1", "--gha"], {
      runId: "ref-only-test",
      historyPath,
      fixtureCacheDir: dir,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    const line = readHistoryLine();
    expect(line.surfaces["S2-c"]?.samples_count).toBe(0);
    expect(line.surfaces["S2-c"]?.stub_reason).toMatch(/reference-only/i);
  });

  test("--surface S2-b on --gha measures the medium tier (override to small for test speed)", async () => {
    const exitCode = await runBenchCli(
      ["--surface", "S2-b", "--runs", "1", "--corpus", "small", "--gha"],
      { runId: "s2b-test", historyPath, fixtureCacheDir: dir, stdout: () => {} },
    );
    expect(exitCode).toBe(0);
    const line = readHistoryLine();
    expect(line.surfaces["S2-b"]?.samples_count).toBe(100);
    expect(line.surfaces["S2-b"]?.stub_reason).toBeUndefined();
  });

  test("a driver failure records stub_reason and continues (does not abort the run)", async () => {
    const exitCode = await runBenchCli(
      ["--surface", "S2-a", "--runs", "1", "--corpus", "small", "--gha"],
      {
        runId: "drv-fail-test",
        historyPath,
        fixtureCacheDir: dir,
        stdout: () => {},
        stderr: () => {},
        // Inject a S2-a driver that throws — exercises the bench-cli
        // try/catch wrapper without depending on a real spawn.
        surfaceDriverOverrides: {
          "S2-a": () => Promise.reject(new Error("synthetic driver failure")),
        },
      },
    );
    expect(exitCode).toBe(0);
    const line = readHistoryLine();
    expect(line.surfaces["S2-a"]?.samples_count).toBe(0);
    expect(line.surfaces["S2-a"]?.stub_reason).toMatch(/driver-failed.*synthetic/);
  });
});
