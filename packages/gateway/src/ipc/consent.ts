import type { JsonRpcNotification } from "./jsonrpc.ts";

/**
 * Thrown when the initiating IPC client disconnects while consent is pending.
 * The executor should treat this as rejection and audit with reason "client disconnected".
 */
export class ConsentDisconnectedError extends Error {
  readonly code = "CONSENT_CLIENT_DISCONNECTED" as const;
  override readonly name = "ConsentDisconnectedError";
  constructor(message = "client disconnected") {
    super(message);
  }
}

export interface ConsentCoordinator {
  /**
   * Sends `consent.request` to the given client only; resolves when that client
   * sends `consent.respond`, or rejects with {@link ConsentDisconnectedError}.
   */
  requestConsent(
    clientId: string,
    params: { requestId: string; prompt: string; details?: unknown },
  ): Promise<boolean>;
}

type PendingConsent = {
  readonly resolve: (approved: boolean) => void;
  readonly reject: (err: Error) => void;
  readonly clientId: string;
};

export type ConsentSessionWriter = (notification: JsonRpcNotification) => void;

/**
 * Routes consent to a single client; clears pending entries on disconnect.
 */
export class ConsentCoordinatorImpl implements ConsentCoordinator {
  private readonly pending = new Map<string, PendingConsent>();

  constructor(
    private readonly getWriter: (clientId: string) => ConsentSessionWriter | undefined,
  ) {}

  requestConsent(
    clientId: string,
    params: { requestId: string; prompt: string; details?: unknown },
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const write = this.getWriter(clientId);
      if (write === undefined) {
        reject(new ConsentDisconnectedError("No active IPC session for client"));
        return;
      }
      const { requestId, prompt, details } = params;
      this.pending.set(requestId, { resolve, reject, clientId });
      const notif: JsonRpcNotification = {
        jsonrpc: "2.0",
        method: "consent.request",
        params:
          details === undefined
            ? { requestId, prompt }
            : { requestId, prompt, details },
      };
      write(notif);
    });
  }

  /**
   * @returns Error body for JSON-RPC response, or null if handled successfully.
   */
  handleRespond(
    clientId: string,
    params: unknown,
  ): { code: number; message: string } | null {
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      return { code: -32602, message: "Invalid params" };
    }
    const o = params as Record<string, unknown>;
    if (typeof o["requestId"] !== "string" || typeof o["approved"] !== "boolean") {
      return { code: -32602, message: "Invalid params" };
    }
    const entry = this.pending.get(o["requestId"]);
    if (entry === undefined || entry.clientId !== clientId) {
      return { code: -32602, message: "Unknown or foreign consent request" };
    }
    this.pending.delete(o["requestId"]);
    entry.resolve(o["approved"]);
    return null;
  }

  onClientDisconnect(clientId: string): void {
    for (const [requestId, entry] of [...this.pending.entries()]) {
      if (entry.clientId === clientId) {
        this.pending.delete(requestId);
        entry.reject(new ConsentDisconnectedError("client disconnected"));
      }
    }
  }
}
