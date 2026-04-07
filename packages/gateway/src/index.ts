/**
 * Nimbus Gateway — Headless Bun process
 *
 * Entry point. Initializes platform services, database, vault,
 * connector mesh, Mastra agent, and IPC server.
 *
 * Startup sequence (architecture.md §Gateway Lifecycle):
 *  1. Detect platform → instantiate PlatformServices (PAL)
 *  2. Open bun:sqlite database → run pending migrations
 *  3. Verify extension integrity → SHA-256 check all installed manifests
 *  4. Initialize Secure Vault → test keystore availability
 *  5. Load connector registry → check credential availability per connector
 *  6. Spawn MCP server processes (first-party + enabled extensions)
 *  7. Initialize Mastra agent → register all tool schemas from live MCP processes
 *  8. Start background sync scheduler
 *  9. Bind IPC socket / named pipe (owner-only permissions)
 * 10. Emit "ready" → CLI and UI clients can now connect
 */

import { createPlatformServices } from "./platform/index.ts";

async function main(): Promise<void> {
  // TODO Q1: Implement full startup sequence
  await createPlatformServices();
  process.stdout.write("Nimbus Gateway starting...\n");
}

main().catch((err: unknown) => {
  console.error("Gateway startup failed:", err);
  process.exit(1);
});
