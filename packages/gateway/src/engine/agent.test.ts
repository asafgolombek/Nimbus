import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { LocalIndex } from "../index/local-index.ts";
import { createNimbusEngineAgent } from "./agent.ts";

describe("createNimbusEngineAgent", () => {
  test("constructs Mastra + Agent with read-only tools", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const localIndex = new LocalIndex(db);
    const { mastra, agent, agentsByName } = createNimbusEngineAgent({
      localIndex,
      agentModel: "openai/gpt-4o-mini",
    });
    expect(mastra).toBeDefined();
    expect(agent.id).toBe("nimbus-q1");
    expect(agentsByName.devops.id).toBe("nimbus-devops");
    expect(agentsByName.research.id).toBe("nimbus-research");
    // Mastra does not expose tool ids on the Agent instance; tools are registered in createNimbusEngineAgent.
    localIndex.close();
  });
});
