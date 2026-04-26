import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeIncompleteLine } from "./signal-handler.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "signal-handler-test-"));
}

describe("writeIncompleteLine", () => {
  test("writes a HistoryLine with incomplete: true and the given reason", () => {
    const dir = freshDir();
    const path = join(dir, "history.jsonl");
    try {
      writeIncompleteLine(path, {
        runId: "r1",
        runner: "local-dev",
        reason: "interrupted",
        nimbusGitSha: "abc",
        bunVersion: "1.2.0",
        osVersion: "test",
      });
      const parsed = JSON.parse(readFileSync(path, "utf8").trim());
      expect(parsed.incomplete).toBe(true);
      expect(parsed.incomplete_reason).toBe("interrupted");
      expect(parsed.run_id).toBe("r1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
