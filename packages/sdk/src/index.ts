/**
 * @nimbus-dev/sdk
 * MIT License
 *
 * Typed scaffolding for building Nimbus extensions (MCP connectors).
 *
 * This package is intentionally MIT-licensed so extension authors are
 * not burdened by AGPL-3.0 copyleft obligations on the core Gateway.
 *
 * The hard problems — OAuth token management, credential storage,
 * sync scheduling, HITL enforcement for write operations — are handled
 * by the Gateway. Extension authors focus on their service's API.
 */

export { ExtensionContractError, runContractTests } from "./contract-tests";
export { NimbusExtensionServer } from "./server";
export { MockGateway } from "./testing/index";
export type { ExtensionManifest, NimbusItem } from "./types";
