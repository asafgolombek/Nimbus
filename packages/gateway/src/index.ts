/**
 * Nimbus Gateway — Headless Bun process
 *
 * Startup: PAL → SQLite index → MCP filesystem mesh → IPC (agent.invoke → runAsk).
 * See architecture.md §Nimbus Gateway: Process Lifecycle.
 */

import { createConnectorDispatcher, type McpToolListingClient } from "./connectors/index.ts";
import { createNimbusEngineAgent } from "./engine/agent.ts";
import { runAsk } from "./engine/run-ask.ts";
import { createPlatformServices } from "./platform/index.ts";

const GATEWAY_VERSION = "0.1.0";

async function main(): Promise<void> {
  const platform = await createPlatformServices();
  const mcp = platform.connectorMesh;
  const dispatcher = createConnectorDispatcher(mcp as unknown as McpToolListingClient);
  const engine = createNimbusEngineAgent({
    localIndex: platform.localIndex,
    ...(platform.sessionMemoryStore !== undefined
      ? { sessionMemoryStore: platform.sessionMemoryStore }
      : {}),
  });

  platform.ipc.setAgentInvokeHandler((ctx) =>
    runAsk({
      ...ctx,
      paths: platform.paths,
      consentCoordinator: platform.ipc.consent,
      localIndex: platform.localIndex,
      dispatcher,
      conversationalAgent: engine.agent,
    }),
  );

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`[gateway] ${signal} — shutting down\n`);
    try {
      platform.syncScheduler.stop();
    } catch {
      /* ignore */
    }
    try {
      await platform.ipc.stop();
    } finally {
      try {
        await mcp.disconnect();
      } catch {
        /* ignore */
      }
      try {
        platform.localIndex.close();
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await platform.ipc.start();
  process.stdout.write(`[gateway] ready (${GATEWAY_VERSION}) IPC ${platform.paths.socketPath}\n`);
}

try {
  await main();
} catch (err: unknown) {
  console.error("[gateway] fatal:", err);
  process.exit(1);
}
