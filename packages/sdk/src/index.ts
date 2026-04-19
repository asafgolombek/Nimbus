/**
 * @nimbus-dev/sdk v1.0.0 — Plugin API v1 (stable baseline)
 * MIT License
 *
 * Typed scaffolding for building Nimbus extensions (MCP connectors).
 * See CHANGELOG.md for the stable surface guarantee.
 */

export type { AuditEmit, AuditLogger } from "./audit-logger";
export { createScopedAuditLogger } from "./audit-logger";
export { ExtensionContractError, runContractTests } from "./contract-tests";
export type { HitlRequest } from "./hitl-request";
export { isHitlRequest } from "./hitl-request";
export { NimbusExtensionServer } from "./server";
export { MockGateway } from "./testing/index";
export type { ExtensionManifest, NimbusItem } from "./types";
