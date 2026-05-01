import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const ci = Boolean(process.env.CI);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Default 5_000 ms is too tight for the first test on a freshly-spawned
    // Vitest worker on Windows-2025 CI: cold-start (jsdom + React + user-event +
    // first component import) routinely consumes 5–7 s before any assertion
    // runs. 10_000 gives 2× the observed worst case (test/pages/Watchers ran
    // 6_283 ms on `dbcd253`) without masking real perf regressions in tests
    // that should complete in tens of ms.
    testTimeout: 10_000,
    reporters: ci
      ? ["default", ["junit", { outputFile: "../../junit-reports/junit-vitest.xml" }]]
      : ["default"],
    /** `*.vitest.tsx` avoids Bun picking component tests as `bun:test` files at repo root. */
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "**/*.vitest.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/test/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: ["src/test-setup.ts", "**/*.d.ts", "dist/**", "**/test/e2e/**"],
    },
  },
});
