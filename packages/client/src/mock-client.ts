import type { NimbusItem } from "@nimbus-dev/sdk";

export type MockClientFixtures = {
  items?: NimbusItem[];
};

/**
 * In-memory stub for scripts/tests without a running Gateway.
 */
export class MockClient {
  private readonly fixtures: MockClientFixtures;

  constructor(fixtures: MockClientFixtures = {}) {
    this.fixtures = fixtures;
  }

  async agentInvoke(
    _input: string,
    _options?: { stream?: boolean },
  ): Promise<{ reply: string } & Record<string, unknown>> {
    return { reply: "[MockClient] agent.invoke" };
  }

  async queryItems(_params: {
    services?: string[];
    types?: string[];
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): Promise<{ items: NimbusItem[]; meta: { limit: number; total: number } }> {
    const items = this.fixtures.items ?? [];
    return { items, meta: { limit: items.length, total: items.length } };
  }

  async querySql(_sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    return { rows: [] };
  }

  async auditList(): Promise<unknown[]> {
    return [];
  }

  async close(): Promise<void> {
    /* noop */
  }
}
