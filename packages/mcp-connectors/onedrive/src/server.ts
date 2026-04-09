/**
 * nimbus-mcp-onedrive — First-party OneDrive MCP server
 *
 * Tool surface (architecture.md §Connector Tool Contract):
 *   list    — No HITL
 *   get     — No HITL
 *   search  — No HITL
 *   create  — Conditional HITL
 *   update  — Conditional HITL
 *   move    — Always HITL
 *   delete  — Always HITL
 *
 * Auth: Microsoft Graph API via OAuth 2.0 PKCE
 * Token: injected via ONEDRIVE_TOKEN environment variable from Gateway Vault
 */

import { NimbusExtensionServer } from "@nimbus-dev/sdk";

const server = new NimbusExtensionServer({
  manifest: {
    id: "com.nimbus.onedrive",
    displayName: "OneDrive",
    version: "0.1.0",
    description: "Access and manage your OneDrive files from Nimbus.",
    author: "Nimbus Contributors",
    entrypoint: "dist/server.js",
    runtime: "bun",
    permissions: ["read", "write", "delete"],
    hitlRequired: ["write", "delete"],
    minNimbusVersion: "0.1.0",
  },
});

// Roadmap Q2: register OneDrive tools (list, get, search, create, update, move, delete)

server.start();
