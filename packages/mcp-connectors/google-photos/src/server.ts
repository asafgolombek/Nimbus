/**
 * nimbus-mcp-google-photos — First-party Google Photos MCP server
 *
 * Tool surface (architecture.md §Connector Tool Contract):
 *   list    — No HITL (list albums/photos)
 *   get     — No HITL (get photo metadata)
 *   search  — No HITL
 *   delete  — Always HITL (photo.delete)
 *
 * Auth: Google Photos API via OAuth 2.0 PKCE
 * Token: injected via GDRIVE_CREDENTIALS environment variable from Gateway Vault
 */

import { NimbusExtensionServer } from "@nimbus-dev/sdk";

const server = new NimbusExtensionServer({
  manifest: {
    id: "com.nimbus.google-photos",
    displayName: "Google Photos",
    version: "0.1.0",
    description: "Search and manage your Google Photos library from Nimbus.",
    author: "Nimbus Contributors",
    entrypoint: "dist/server.js",
    runtime: "bun",
    permissions: ["read", "delete"],
    hitlRequired: ["delete"],
    minNimbusVersion: "0.1.0",
  },
});

// Roadmap Q2: register Google Photos tools (list, get, search, delete)

server.start();
