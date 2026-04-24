import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, "..", "..", "..");
  const extensionTestsPath = resolve(__dirname, "index.js");
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}

void main();
