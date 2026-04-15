import { IPCClient } from "./ipc-transport.ts";

export type NimbusClientOptions = {
  socketPath: string;
};

/**
 * Typed convenience wrapper over the Gateway JSON-RPC IPC surface.
 */
export class NimbusClient {
  private readonly ipc: IPCClient;

  private constructor(ipc: IPCClient) {
    this.ipc = ipc;
  }

  static async open(opts: NimbusClientOptions): Promise<NimbusClient> {
    const ipc = new IPCClient(opts.socketPath);
    await ipc.connect();
    return new NimbusClient(ipc);
  }

  async agentInvoke(
    input: string,
    options?: { stream?: boolean; sessionId?: string; agent?: string },
  ): Promise<{ reply?: string } & Record<string, unknown>> {
    return await this.ipc.call("agent.invoke", {
      input,
      stream: options?.stream ?? false,
      ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      ...(options?.agent !== undefined ? { agent: options.agent } : {}),
    });
  }

  async queryItems(params: {
    services?: string[];
    types?: string[];
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): Promise<{ items: Record<string, unknown>[]; meta: { limit: number; total: number } }> {
    return await this.ipc.call("index.queryItems", {
      services: params.services,
      types: params.types,
      sinceMs: params.sinceMs,
      untilMs: params.untilMs,
      limit: params.limit,
    });
  }

  async querySql(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    return await this.ipc.call("index.querySql", { sql });
  }

  async auditList(limit?: number): Promise<unknown[]> {
    return await this.ipc.call("audit.list", { limit: limit ?? 50 });
  }

  async close(): Promise<void> {
    await this.ipc.disconnect();
  }
}
