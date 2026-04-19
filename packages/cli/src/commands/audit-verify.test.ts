import { describe, expect, test } from "bun:test";
import { runAudit } from "./audit.ts";

describe("audit subcommands", () => {
  test("runAudit is callable", () => {
    expect(typeof runAudit).toBe("function");
  });
});
