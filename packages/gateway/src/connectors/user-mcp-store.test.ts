import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { LocalIndex } from "../index/local-index.ts";
import {
  listUserMcpConnectors,
  normalizeUserMcpServiceId,
  parseUserMcpCommandLine,
  USER_MCP_SERVICE_ID_PATTERN,
} from "./user-mcp-store.ts";

describe("user-mcp-store", () => {
  test("normalizeUserMcpServiceId", () => {
    expect(normalizeUserMcpServiceId("mcp_demo")).toBe("mcp_demo");
    expect(normalizeUserMcpServiceId("MCP_DEMO")).toBe("mcp_demo");
    expect(normalizeUserMcpServiceId("demo")).toBeNull();
    expect(normalizeUserMcpServiceId("mcp_")).toBeNull();
  });

  test("USER_MCP_SERVICE_ID_PATTERN length bound", () => {
    const ok = `mcp_${"a".repeat(62)}`;
    expect(USER_MCP_SERVICE_ID_PATTERN.test(ok)).toBe(true);
    const tooLong = `mcp_${"a".repeat(63)}`;
    expect(USER_MCP_SERVICE_ID_PATTERN.test(tooLong)).toBe(false);
  });

  test("parseUserMcpCommandLine splits on whitespace", () => {
    expect(parseUserMcpCommandLine("bun run ./srv.ts")).toEqual({
      command: "bun",
      args: ["run", "./srv.ts"],
    });
  });

  test("listUserMcpConnectors after migration 11", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    db.run(
      `INSERT INTO user_mcp_connector (service_id, command, args_json, created_at) VALUES (?, ?, ?, ?)`,
      ["mcp_x", "echo", "[]", Date.now()],
    );
    const rows = listUserMcpConnectors(db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.service_id).toBe("mcp_x");
  });
});
