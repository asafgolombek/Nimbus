/**
 * MockGateway — test utility for Nimbus extension unit tests
 *
 * Allows extension authors to test their MCP servers without
 * running a real Gateway process.
 *
 * Usage:
 *   const gateway = new MockGateway();
 *   const result = await gateway.callTool("search", { query: "test" });
 *   expect(result.items).toHaveLength(3);
 */

export class MockGateway {
  // Roadmap Q3: mock Gateway for extension testing
  async callTool(_toolName: string, _input: Record<string, unknown>): Promise<unknown> {
    return {};
  }
}
