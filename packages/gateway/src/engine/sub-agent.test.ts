import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runIndexedSchemaMigrations } from "../index/migrations/runner.ts";
import { runSubAgent } from "./sub-agent.ts";

describe("runSubAgent", () => {
  test("executes and returns result", async () => {
    const result = await runSubAgent({
      sessionId: "s1",
      parentId: "p1",
      taskIndex: 0,
      taskType: "classification",
      execute: async () => ({ text: "ok", tokensIn: 1, tokensOut: 1 }),
    });
    expect(result.text).toBe("ok");
  });

  test("writes running and done rows to sub_task_results", async () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);

    await runSubAgent({
      sessionId: "s2",
      parentId: "p2",
      taskIndex: 0,
      taskType: "reasoning",
      db,
      execute: async () => ({ text: "done", tokensIn: 5, tokensOut: 3 }),
    });

    const row = db
      .query("SELECT status, tokens_in, tokens_out FROM sub_task_results WHERE session_id = 's2'")
      .get() as { status: string; tokens_in: number; tokens_out: number } | null;
    expect(row?.status).toBe("done");
    expect(row?.tokens_in).toBe(5);
    expect(row?.tokens_out).toBe(3);
  });

  test("writes error status on failure", async () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);

    await expect(
      runSubAgent({
        sessionId: "s3",
        parentId: "p3",
        taskIndex: 0,
        taskType: "agent_step",
        db,
        execute: async () => {
          throw new Error("task failed");
        },
      }),
    ).rejects.toThrow("task failed");

    const row = db
      .query("SELECT status, error_text FROM sub_task_results WHERE session_id = 's3'")
      .get() as { status: string; error_text: string } | null;
    expect(row?.status).toBe("error");
    expect(row?.error_text).toContain("task failed");
  });
});
