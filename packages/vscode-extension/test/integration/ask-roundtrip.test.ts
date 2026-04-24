import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as vscode from "vscode";

describe("Nimbus extension activation", () => {
  it("registers all expected commands", async () => {
    const extension = vscode.extensions.getExtension("nimbus-dev.nimbus");
    assert.ok(extension, "Extension not found");
    await extension.activate();
    const all = await vscode.commands.getCommands(true);
    const expected = [
      "nimbus.ask",
      "nimbus.askAboutSelection",
      "nimbus.search",
      "nimbus.searchSelection",
      "nimbus.runWorkflow",
      "nimbus.newConversation",
      "nimbus.startGateway",
    ];
    for (const cmd of expected) {
      assert.ok(all.includes(cmd), `Missing command: ${cmd}`);
    }
  });

  it("opens chat panel on Nimbus: Ask", async () => {
    await vscode.commands.executeCommand("nimbus.ask");
    // Allow the panel a tick to render
    await new Promise((r) => setTimeout(r, 200));
    // Webview panels aren't enumerated via API; assert no exception was thrown.
    assert.ok(true);
  });
});
