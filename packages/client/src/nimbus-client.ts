import { createAskStream } from "./ask-stream.js";
import { IPCClient } from "./ipc-transport.js";
import type { AskStreamHandle, AskStreamOptions, HitlRequest } from "./stream-events.js";

export type NimbusClientOptions = {
  socketPath: string;
};

export type SessionTranscript = {
  sessionId: string;
  turns: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: number;
    auditLogId?: number;
  }>;
  hasMore: boolean;
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
      ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options?.agent === undefined ? {} : { agent: options.agent }),
    });
  }

  askStream(input: string, opts?: AskStreamOptions): AskStreamHandle {
    return createAskStream(this.ipc, input, opts);
  }

  subscribeHitl(handler: (req: HitlRequest) => void): { dispose(): void } {
    const onBatch = (params: unknown): void => {
      if (typeof params !== "object" || params === null) return;
      const p = params as Record<string, unknown>;
      const requestId = p["requestId"];
      const prompt = p["prompt"];
      if (typeof requestId !== "string" || typeof prompt !== "string") return;
      const req: HitlRequest = {
        requestId,
        prompt,
        details: p["details"],
      };
      const streamId = p["streamId"];
      if (typeof streamId === "string") req.streamId = streamId;
      handler(req);
    };
    this.ipc.onNotification("agent.hitlBatch", onBatch);
    return {
      dispose: () => {
        this.ipc.offNotification("agent.hitlBatch", onBatch);
      },
    };
  }

  async getSessionTranscript(params: {
    sessionId: string;
    limit?: number;
  }): Promise<SessionTranscript> {
    return await this.ipc.call("engine.getSessionTranscript", params);
  }

  async cancelStream(streamId: string): Promise<{ ok: boolean }> {
    return await this.ipc.call("engine.cancelStream", { streamId });
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
