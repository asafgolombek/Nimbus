import { describe, expect, test } from "bun:test";
import { Config } from "../config.ts";
import { AgentCoordinator, type SubTask } from "./coordinator.ts";

describe("AgentCoordinator", () => {
  test("executes a single sub-task and returns its result", async () => {
    const coordinator = new AgentCoordinator({
      sessionId: "sess1",
      parentId: "root",
      depth: 1,
      toolCallCount: { value: 0 },
    });

    const tasks: SubTask[] = [
      {
        taskType: "classification",
        prompt: "Is this a question?",
        execute: async () => ({ text: "yes", tokensIn: 1, tokensOut: 1 }),
      },
    ];

    const results = await coordinator.run(tasks);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("done");
    expect(results[0]?.text).toBe("yes");
  });

  test("stops at maxAgentDepth and returns error status", async () => {
    const maxDepth = Config.maxAgentDepth;
    const coordinator = new AgentCoordinator({
      sessionId: "sess2",
      parentId: "root",
      depth: maxDepth + 1,
      toolCallCount: { value: 0 },
    });

    const tasks: SubTask[] = [
      {
        taskType: "agent_step",
        prompt: "do something",
        execute: async () => ({ text: "done", tokensIn: 0, tokensOut: 0 }),
      },
    ];

    await expect(coordinator.run(tasks)).rejects.toThrow("Agent depth limit");
  });

  test("stops at maxToolCallsPerSession and returns error", async () => {
    const counter = { value: Config.maxToolCallsPerSession };
    const coordinator = new AgentCoordinator({
      sessionId: "sess3",
      parentId: "root",
      depth: 1,
      toolCallCount: counter,
    });

    const tasks: SubTask[] = [
      {
        taskType: "agent_step",
        prompt: "call a tool",
        execute: async () => {
          counter.value += 1;
          return { text: "result", tokensIn: 0, tokensOut: 0 };
        },
      },
    ];

    await expect(coordinator.run(tasks)).rejects.toThrow("Tool call limit");
  });

  test("marks rejected tasks as rejected status", async () => {
    const coordinator = new AgentCoordinator({
      sessionId: "sess4",
      parentId: "root",
      depth: 1,
      toolCallCount: { value: 0 },
    });

    const tasks: SubTask[] = [
      {
        taskType: "agent_step",
        prompt: "delete file",
        execute: async () => {
          throw new Error("User rejected");
        },
      },
    ];

    const results = await coordinator.run(tasks);
    expect(results[0]?.status).toBe("error");
    expect(results[0]?.errorText).toContain("User rejected");
  });

  test("runs multiple sub-tasks sequentially", async () => {
    const order: number[] = [];
    const coordinator = new AgentCoordinator({
      sessionId: "sess5",
      parentId: "root",
      depth: 1,
      toolCallCount: { value: 0 },
    });

    const tasks: SubTask[] = [0, 1, 2].map((i) => ({
      taskType: "summarisation" as const,
      prompt: `step ${i}`,
      execute: async () => {
        order.push(i);
        return { text: `done ${i}`, tokensIn: 1, tokensOut: 1 };
      },
    }));

    const results = await coordinator.run(tasks);
    expect(order).toEqual([0, 1, 2]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === "done")).toBe(true);
  });
});
