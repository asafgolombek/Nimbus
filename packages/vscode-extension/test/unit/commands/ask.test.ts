import { describe, expect, test } from "vitest";

import { buildAskAboutSelectionPrefill } from "../../../src/commands/ask.ts";

describe("buildAskAboutSelectionPrefill", () => {
  test("includes path, line range, language fence", () => {
    const out = buildAskAboutSelectionPrefill({
      relativePath: "src/auth.ts",
      startLine: 41,
      endLine: 57,
      languageId: "typescript",
      selectionText: "function authenticate() { return true; }",
    });
    expect(out).toContain("Context (src/auth.ts, lines 42–58):");
    expect(out).toContain("```typescript");
    expect(out).toContain("function authenticate() { return true; }");
    expect(out.endsWith("Question: ")).toBe(true);
  });

  test("single-line selection renders as 'line N'", () => {
    const out = buildAskAboutSelectionPrefill({
      relativePath: "x.ts",
      startLine: 5,
      endLine: 5,
      languageId: "ts",
      selectionText: "let x = 1;",
    });
    expect(out).toContain("Context (x.ts, line 6):");
  });
});
