import { describe, expect, test } from "bun:test";

import { planFromIntent } from "./planner.ts";
import type { ClassifiedIntent } from "./router.ts";

const paths = {
  configDir: "/c",
  dataDir: "/d",
  logDir: "/l",
  socketPath: "/s.sock",
  extensionsDir: "/e",
  tempDir: "/t",
};

describe("planFromIntent", () => {
  test("low confidence yields clarification reply", () => {
    const c: ClassifiedIntent = {
      intent: "file_search",
      entities: { pattern: "x" },
      requiresHITL: false,
      confidence: 0.2,
    };
    const p = planFromIntent(c, paths);
    expect(p.kind).toBe("reply");
    if (p.kind === "reply") {
      expect(p.text.length).toBeGreaterThan(10);
    }
  });

  test("file_search builds filesystem_search_files action", () => {
    const c: ClassifiedIntent = {
      intent: "file_search",
      entities: { pattern: "*.ts" },
      requiresHITL: false,
      confidence: 0.9,
    };
    const p = planFromIntent(c, paths);
    expect(p.kind).toBe("actions");
    if (p.kind === "actions") {
      expect(p.actions).toHaveLength(1);
      const a = p.actions[0];
      expect(a?.type).toBe("filesystem_search_files");
      expect(a?.payload).toEqual({
        input: { path: paths.dataDir, pattern: "*.ts" },
      });
    }
  });

  test("file_organize uses file.move + filesystem_move_file for HITL", () => {
    const c: ClassifiedIntent = {
      intent: "file_organize",
      entities: { source: "/a", destination: "/b" },
      requiresHITL: true,
      confidence: 1,
    };
    const p = planFromIntent(c, paths);
    expect(p.kind).toBe("actions");
    if (p.kind === "actions") {
      expect(p.actions[0]?.type).toBe("file.move");
      expect(p.actions[0]?.payload).toEqual({
        mcpToolId: "filesystem_move_file",
        input: { source: "/a", destination: "/b" },
      });
    }
  });
});
