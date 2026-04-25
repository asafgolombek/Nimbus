export class LanError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "LanError";
    this.rpcCode = rpcCode;
  }
}

const FORBIDDEN_OVER_LAN = new Set([
  "vault",
  "updater",
  "lan",
  "profile",
  "audit", // exfiltration-class namespace
  "data", // exfiltration-class namespace
  "connector.addMcp", // full method — arbitrary command execution over network
]);

const WRITE_METHODS = new Set([
  "engine.ask",
  "engine.askStream",
  "connector.sync",
  "connector.remove",
  "connector.addMcp",
  "connector.setConfig",
  "connector.setInterval",
  "watcher.create",
  "watcher.update",
  "watcher.delete",
  "workflow.run",
  "workflow.save",
  "workflow.delete",
  "extension.enable",
  "extension.remove",
  "data.import",
]);

export interface LanPeerContext {
  peerId: string;
  writeAllowed: boolean;
}

export function checkLanMethodAllowed(method: string, peer: LanPeerContext): void {
  const ns = method.split(".")[0] ?? "";
  if (FORBIDDEN_OVER_LAN.has(ns) || FORBIDDEN_OVER_LAN.has(method)) {
    throw new LanError(-32601, `ERR_METHOD_NOT_ALLOWED: ${method} is not callable over LAN`);
  }
  if (WRITE_METHODS.has(method) && !peer.writeAllowed) {
    throw new LanError(
      -32603,
      `ERR_LAN_WRITE_FORBIDDEN: peer ${peer.peerId} lacks write permission for ${method}`,
    );
  }
}
