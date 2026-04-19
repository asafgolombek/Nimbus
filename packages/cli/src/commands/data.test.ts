import { describe, expect, test } from "bun:test";
import { runData } from "./data.ts";

describe("data subcommands", () => {
  test("runData is callable", () => {
    expect(typeof runData).toBe("function");
  });

  test("runData throws on unknown subcommand", async () => {
    await expect(runData(["unknown"])).rejects.toThrow("Usage: nimbus data");
  });
});
