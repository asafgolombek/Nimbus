import { build, context } from "esbuild";
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

const webviewCfg = {
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
};

if (isWatch) {
  // esbuild 0.17+: watch requires context() + ctx.watch()
  const [extCtx, webCtx] = await Promise.all([
    context({ ...baseExt, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js" }),
    context(webviewCfg),
  ]);
  await Promise.all([extCtx.watch(), webCtx.watch()]);
} else {
  await Promise.all([
    build({ ...baseExt, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js" }),
    build(webviewCfg),
  ]);
  copyFileSync("src/chat/webview/styles.css", "media/webview.css");
  console.log(`esbuild: bundles produced (minify=${!isDev}, sourcemaps=${isDev})`);
}
