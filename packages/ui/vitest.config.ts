import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    /** `*.vitest.tsx` avoids Bun picking component tests as `bun:test` files at repo root. */
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "**/*.vitest.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/test/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["src/test-setup.ts", "**/*.d.ts", "dist/**", "**/test/e2e/**"],
    },
  },
});
