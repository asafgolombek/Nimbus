import { describe, expect, test } from "bun:test";
import { escapeDriveQueryLiteral } from "./drive-query.ts";

describe("escapeDriveQueryLiteral", () => {
  test("escapes backslashes and single quotes for Drive q parameter", () => {
    expect(escapeDriveQueryLiteral("it's \\ fine")).toBe("it\\'s \\\\ fine");
  });

  test("leaves simple phrases unchanged", () => {
    expect(escapeDriveQueryLiteral("quarterly report")).toBe("quarterly report");
  });
});
