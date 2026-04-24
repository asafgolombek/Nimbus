/**
 * @nimbus-dev/client — MIT local Gateway client (IPC).
 */

export { IPCClient } from "./ipc-transport.js";
export { MockClient, type MockClientFixtures } from "./mock-client.js";
export {
  NimbusClient,
  type NimbusClientOptions,
  type SessionTranscript,
} from "./nimbus-client.js";
export {
  type AskStreamHandle,
  type AskStreamOptions,
  type HitlRequest,
  type StreamEvent,
} from "./stream-events.js";
export {
  discoverSocketPath,
  gatewayStatePath,
  readGatewayState,
  type GatewayStateFile,
  type SocketDiscoveryResult,
} from "./discovery.js";
export { getNimbusPaths, type NimbusPaths } from "./paths.js";
