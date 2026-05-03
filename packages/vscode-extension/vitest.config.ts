import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environmentMatchGlobs: [["test/unit/webview/**", "jsdom"]],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/vscode-shim.ts"],
      thresholds: {
        lines: 80,
        branches: 75,
      },
    },
  },
  resolve: {
    alias: {
      vscode: new URL("./test/unit/vscode-stub.ts", import.meta.url).pathname,
    },
  },
});
