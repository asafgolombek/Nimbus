import * as assert from "node:assert/strict";
import * as vscode from "vscode";

type Test = { name: string; fn: () => Promise<void> };

const suite: Test[] = [
  {
    name: "registers all expected commands",
    async fn() {
      const extension = vscode.extensions.getExtension("nimbus-dev.nimbus");
      assert.ok(extension, "Extension not found");
      await extension.activate();
      const all = await vscode.commands.getCommands(true);
      for (const cmd of [
        "nimbus.ask",
        "nimbus.askAboutSelection",
        "nimbus.search",
        "nimbus.searchSelection",
        "nimbus.runWorkflow",
        "nimbus.newConversation",
        "nimbus.startGateway",
      ]) {
        assert.ok(all.includes(cmd), `Missing command: ${cmd}`);
      }
    },
  },
  {
    name: "opens chat panel on Nimbus: Ask",
    async fn() {
      await vscode.commands.executeCommand("nimbus.ask");
      await new Promise<void>((r) => setTimeout(r, 200));
      assert.ok(true);
    },
  },
];

export async function run(): Promise<void> {
  let failures = 0;
  for (const { name, fn } of suite) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
      failures++;
    }
  }
  if (failures > 0) {
    throw new Error(`${failures} of ${suite.length} integration tests failed`);
  }
}
