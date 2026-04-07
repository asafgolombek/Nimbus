/**
 * nimbus-mcp-outlook — First-party Outlook MCP server
 *
 * Tool surface (architecture.md §Connector Tool Contract):
 *   list    — No HITL (list emails/folders)
 *   get     — No HITL (read email)
 *   search  — No HITL
 *   create  — Conditional HITL (draft)
 *   send    — Always HITL (email.send)
 *   delete  — Always HITL
 *
 * Auth: Microsoft Graph API via OAuth 2.0 PKCE
 * Token: injected via OUTLOOK_TOKEN environment variable from Gateway Vault
 */

import { NimbusExtensionServer } from "@nimbus-dev/sdk";

const server = new NimbusExtensionServer({
  manifest: {
    id: "com.nimbus.outlook",
    displayName: "Outlook",
    version: "0.1.0",
    description: "Read and send Outlook email from Nimbus.",
    author: "Nimbus Contributors",
    entrypoint: "dist/server.js",
    runtime: "bun",
    permissions: ["read", "write"],
    hitlRequired: ["write"],
    minNimbusVersion: "0.1.0",
  },
});

// TODO Q2: Register Outlook tools (list, get, search, draft, send, delete)

server.start();
