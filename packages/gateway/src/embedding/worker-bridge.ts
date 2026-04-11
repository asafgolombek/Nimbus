import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Logger } from "pino";

import type { NimbusEmbeddingToml } from "../config/nimbus-toml.ts";
import type { EmbeddingRuntime } from "./embedding-runtime.ts";

type Pending = {
  resolve: (v: Float32Array | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

export async function tryCreateEmbeddingWorkerBridge(
  dbPath: string,
  dataDir: string,
  toml: Pick<NimbusEmbeddingToml, "chunkTokens" | "chunkOverlapTokens" | "backfillBatchSize">,
  logger: Logger,
): Promise<EmbeddingRuntime | null> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./embedding-worker.ts", import.meta.url).href);
  } catch (err) {
    logger.warn({ err }, "could not spawn embedding worker");
    return null;
  }
  const bridge = new EmbeddingWorkerBridge(worker, dbPath, join(dataDir, "models"), toml, logger);
  try {
    await bridge.waitUntilReady();
    return bridge;
  } catch (err) {
    logger.warn({ err }, "embedding worker failed to initialize");
    try {
      worker.terminate();
    } catch {
      /* ignore */
    }
    return null;
  }
}

class EmbeddingWorkerBridge implements EmbeddingRuntime {
  private readonly pending = new Map<string, Pending>();
  private progress: { done: number; total: number } | null = null;
  private gateSettled = false;
  private workerReady = false;
  private readonly resolveGate: () => void;
  private readonly rejectGate: (e: Error) => void;
  private readonly gate: Promise<void>;

  constructor(
    private readonly worker: Worker,
    dbPath: string,
    cacheDir: string,
    toml: Pick<NimbusEmbeddingToml, "chunkTokens" | "chunkOverlapTokens" | "backfillBatchSize">,
    private readonly logger: Logger,
  ) {
    let res!: () => void;
    let rej!: (e: Error) => void;
    this.gate = new Promise<void>((resolve, reject) => {
      res = resolve;
      rej = reject;
    });
    this.resolveGate = res;
    this.rejectGate = rej;

    this.worker.onmessage = (ev: MessageEvent) => {
      this.handleMessage(ev.data);
    };

    this.worker.postMessage({
      type: "init",
      dbPath,
      cacheDir,
      toml,
    });
  }

  waitUntilReady(): Promise<void> {
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error("embedding worker init timed out"));
      }, 180_000);
    });
    return Promise.race([this.gate, timeout]);
  }

  private settleGate(ok: boolean, err?: Error): void {
    if (this.gateSettled) {
      return;
    }
    this.gateSettled = true;
    if (ok) {
      this.resolveGate();
    } else {
      this.rejectGate(err ?? new Error("embedding worker init failed"));
    }
  }

  private handleMessage(data: unknown): void {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return;
    }
    const rec = data as Record<string, unknown>;
    const t = rec["type"];
    if (t === "ready") {
      this.workerReady = true;
      this.settleGate(true);
      return;
    }
    if (t === "init_error" && typeof rec["message"] === "string") {
      this.settleGate(false, new Error(rec["message"]));
      return;
    }
    if (t === "backfill_progress") {
      const done = rec["done"];
      const total = rec["total"];
      if (typeof done === "number" && typeof total === "number") {
        this.progress = { done: Math.floor(done), total: Math.floor(total) };
      }
      return;
    }
    if (t === "backfill_done") {
      return;
    }
    if (t === "embed_texts_result") {
      const id = rec["id"];
      if (typeof id !== "string") {
        return;
      }
      const p = this.pending.get(id);
      if (p === undefined) {
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(id);
      if (rec["ok"] === true && Array.isArray(rec["vectors"])) {
        const first = rec["vectors"][0];
        if (Array.isArray(first)) {
          p.resolve(new Float32Array(first.map((x) => Number(x))));
          return;
        }
      }
      p.resolve(null);
    }
  }

  scheduleItemEmbedding(itemId: string): void {
    if (!this.workerReady) {
      return;
    }
    this.worker.postMessage({ type: "embed_item", itemId });
  }

  async embedQuery(text: string): Promise<Float32Array | null> {
    if (!this.workerReady) {
      return null;
    }
    const id = randomUUID();
    return new Promise<Float32Array | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, 60_000);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage({ type: "embed_texts", id, texts: [text] });
    }).catch((err: unknown) => {
      this.logger.warn({ err }, "embedQuery failed");
      return null;
    });
  }

  getBackfillProgress(): { done: number; total: number } | null {
    return this.progress;
  }

  startBackgroundJobs(): void {
    /* worker backfills after ready */
  }

  terminate(): void {
    this.worker.onmessage = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve(null);
    }
    this.pending.clear();
    try {
      this.worker.terminate();
    } catch {
      /* ignore */
    }
  }
}
