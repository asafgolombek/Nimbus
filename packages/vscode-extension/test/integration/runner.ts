import { runTests } from "@vscode/test-electron";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, "..", "..");
  const extensionTestsPath = resolve(__dirname, "index.js");
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}

void main();
