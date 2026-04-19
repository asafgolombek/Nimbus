/**
 * @nimbus-dev/sdk v1.0.0 — Plugin API v1 (stable baseline)
 * MIT License
 *
 * Typed scaffolding for building Nimbus extensions (MCP connectors).
 * See CHANGELOG.md for the stable surface guarantee.
 */

export type { AuditEmit, AuditLogger } from "./audit-logger.ts";
export { createScopedAuditLogger } from "./audit-logger.ts";
export { ExtensionContractError, runContractTests } from "./contract-tests";
export type { HitlRequest } from "./hitl-request.ts";
export { isHitlRequest } from "./hitl-request.ts";
export { NimbusExtensionServer } from "./server";
export { MockGateway } from "./testing/index";
export type { ExtensionManifest, NimbusItem } from "./types";
