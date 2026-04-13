/**
 * Extension Registry — sandboxed third-party MCP connectors
 *
 * Principles:
 * - MCP-native: extensions are MCP servers
 * - Manifest-gated: nimbus.extension.json (or legacy nimbus-extension.json) validated at install time
 * - Process-isolated: extensions run as child processes
 * - Permission-scoped: credentials injected via env per declared service only
 * - Integrity-verified: SHA-256 of manifest stored at install, verified on startup
 * - Marketplace-discoverable: registry index from registry.nimbus.dev
 *
 * See architecture.md §Subsystem 4: The Extension Registry
 */

export {
  EXTENSION_MANIFEST_FILENAME,
  EXTENSION_MANIFEST_FILENAME_LEGACY,
  parseExtensionManifestJson,
  resolveExtensionManifestPath,
} from "./manifest.ts";
export { extensionProcessEnv } from "./spawn-env.ts";
export { verifyExtensionsBestEffort } from "./verify-extensions.ts";
