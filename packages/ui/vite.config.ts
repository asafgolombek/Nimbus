import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://tauri.app/start/frontend/vite
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Watch src-tauri for Rust changes (tell Vite to re-trigger)
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri supports ES2021
    target: ["es2021", "chrome105", "safari15"],
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
