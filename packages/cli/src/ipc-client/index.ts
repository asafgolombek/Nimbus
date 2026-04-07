/**
 * IPC client — JSON-RPC 2.0 client for CLI → Gateway communication
 *
 * Handles:
 * - Connection to domain socket (Unix) or named pipe (Windows)
 * - Request/response correlation via JSON-RPC id
 * - Streaming responses (agent.invoke with stream: true)
 * - Consent channel: surfaces consent.request to terminal, sends consent.respond
 */

// TODO Q1: Export IPCClient, connectToGateway(), ConsentChannel
export {};
