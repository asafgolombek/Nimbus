/**
 * Events emitted by NimbusClient.askStream() over its AsyncIterable surface.
 * Single discriminated union so the consumer can `switch (ev.type)`.
 */
export type StreamEvent =
  | { type: "token"; text: string }
  | {
      type: "subTaskProgress";
      subTaskId: string;
      status: string;
      progress?: number;
    }
  | {
      type: "hitlBatch";
      requestId: string;
      prompt: string;
      details?: unknown;
    }
  | { type: "done"; reply: string; sessionId: string }
  | { type: "error"; code: string; message: string };

export type AskStreamOptions = {
  sessionId?: string;
  agent?: string;
  signal?: AbortSignal;
};

/**
 * Returned from NimbusClient.askStream(). Iterate to consume events;
 * call cancel() to terminate the stream early.
 */
export type AskStreamHandle = AsyncIterable<StreamEvent> & {
  readonly streamId: string;
  cancel(): Promise<void>;
};

/**
 * HITL request payload delivered via NimbusClient.subscribeHitl().
 * Independent of any stream — used for background workflow / watcher HITL.
 */
export type HitlRequest = {
  requestId: string;
  prompt: string;
  details?: unknown;
  /** Present only when the batch was produced by a known stream. */
  streamId?: string;
};
