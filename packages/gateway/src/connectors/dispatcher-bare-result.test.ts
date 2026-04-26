import { describe, expect, test } from "bun:test";

import { createConnectorDispatcher, type McpToolListingClient } from "./registry.ts";

describe("ConnectorDispatcher returns bare results (G9 regression)", () => {
  test("dispatch result is the structured tool return, not an envelope string", async () => {
    const client: McpToolListingClient = {
      getToolsEpoch: () => 0,
      async listTools() {
        return {
          github_repo_get: {
            execute: async (): Promise<{ name: string; stars: number }> => ({
              name: "repo",
              stars: 42,
            }),
          },
        };
      },
    };
    const d = createConnectorDispatcher(client);
    const r = await d.dispatch({ type: "github_repo_get", payload: {} });
    expect(r).toEqual({ name: "repo", stars: 42 });
    expect(typeof r === "string" && r.startsWith("<tool_output")).toBe(false);
  });
});
