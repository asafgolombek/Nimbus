/**
 * MCP Connector Mesh — unified interface to all cloud and local services
 *
 * The Engine is an MCP client. It never calls cloud APIs directly.
 * Every connector is an MCP server process.
 *
 * Q1: filesystem only via {@link buildConnectorMesh}. Cloud connectors are Q2+.
 *
 * See architecture.md §Subsystem 2: The MCP Connector Mesh
 */

export {
  buildConnectorMesh,
  createConnectorDispatcher,
  type McpToolListingClient,
} from "./registry.ts";
