import { build } from "esbuild";
import { copyFileSync } from "node:fs";

const isWatch = process.argv.includes("--watch");
const isDev = isWatch || process.env.NODE_ENV === "development";

const baseExt = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: isDev,
  minify: !isDev,
  external: ["vscode"],
  logLevel: "info",
};

await build({
  ...baseExt,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  watch: isWatch,
});

await build({
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  globalName: "NimbusWebview",
  sourcemap: isDev,
  minify: true,
  treeShaking: true,
  entryPoints: ["src/chat/webview/main.ts"],
  outfile: "media/webview.js",
  logLevel: "info",
  watch: isWatch,
});

copyFileSync("src/chat/webview/styles.css", "media/webview.css");

console.log(`esbuild: bundles produced (minify=${!isDev}, sourcemaps=${isDev})`);
