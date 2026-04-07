/**
 * IPC Layer — JSON-RPC 2.0 over domain socket (Unix) or named pipe (Windows)
 *
 * Protocol is language-agnostic. Future clients (VS Code extension,
 * browser extension, mobile app) can connect to the same Gateway.
 *
 * Key methods:
 * - agent.invoke        — stream or batch agent invocation
 * - consent.request     — Gateway → client: requires user decision
 * - consent.respond     — client → Gateway: approved/rejected
 * - extension.install   — install extension package
 * - extension.list      — list installed extensions
 * - connector.auth      — trigger OAuth PKCE flow
 * - connector.list      — list connectors + sync status
 *
 * See architecture.md §IPC Protocol
 */

// TODO Q1: Export IPCServer, JSONRPCRequest, JSONRPCResponse
export {};
