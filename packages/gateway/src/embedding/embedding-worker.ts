/**
 * Bun worker entry: owns `@xenova/transformers` + sqlite writes for embeddings.
 * Loaded via `new Worker(new URL("./embedding-worker.ts", import.meta.url))`.
 */
import { Database } from "bun:sqlite";

import type { NimbusEmbeddingToml } from "../config/nimbus-toml.ts";
import { LocalIndex } from "../index/local-index.ts";
import { readIndexedUserVersion, runIndexedSchemaMigrations } from "../index/migrations/runner.ts";
import { ensureSqliteVecForConnection } from "../index/sqlite-vec-load.ts";
import { createLocalEmbedder } from "./model.ts";
import { SqliteEmbeddingPipeline } from "./pipeline.ts";
import type { IndexedItem } from "./types.ts";

type InitMsg = {
  type: "init";
  dbPath: string;
  cacheDir: string;
  toml: Pick<NimbusEmbeddingToml, "chunkTokens" | "chunkOverlapTokens" | "backfillBatchSize">;
};

type EmbedTextsMsg = { type: "embed_texts"; id: string; texts: string[] };
type EmbedItemMsg = { type: "embed_item"; itemId: string };

type InMsg = InitMsg | EmbedTextsMsg | EmbedItemMsg;

function sendToMain(data: unknown): void {
  const w = globalThis as unknown as { postMessage?: (d: unknown) => void };
  w.postMessage?.(data);
}

let db: Database | null = null;
let pipeline: SqliteEmbeddingPipeline | null = null;
let ready = false;
let embedChain = Promise.resolve();

function setupDb(dbPath: string): void {
  const d = new Database(dbPath);
  d.run("PRAGMA busy_timeout = 8000");
  runIndexedSchemaMigrations(d, LocalIndex.SCHEMA_VERSION);
  ensureSqliteVecForConnection(d, readIndexedUserVersion(d));
  d.run("PRAGMA foreign_keys = ON");
  db = d;
}

(globalThis as unknown as { onmessage: ((ev: MessageEvent<InMsg>) => void) | null }).onmessage = (
  ev: MessageEvent<InMsg>,
) => {
  const msg = ev.data;
  if (msg.type === "init") {
    void (async () => {
      try {
        setupDb(msg.dbPath);
        const embedder = await createLocalEmbedder({ cacheDir: msg.cacheDir });
        const pl = new SqliteEmbeddingPipeline({
          db: db as Database,
          embedder,
          backfillBatchSize: msg.toml.backfillBatchSize,
          chunkOptions: {
            maxChunkTokens: msg.toml.chunkTokens,
            overlapTokens: msg.toml.chunkOverlapTokens,
          },
        });
        pipeline = pl;
        ready = true;
        sendToMain({ type: "ready" });
        void (async () => {
          try {
            await pl.backfillAll((done, total) => {
              sendToMain({ type: "backfill_progress", done, total });
            });
          } catch {
            /* best-effort */
          }
          sendToMain({ type: "backfill_done" });
        })();
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        sendToMain({ type: "init_error", message: m });
      }
    })();
    return;
  }

  if (!ready || pipeline === null || db === null) {
    return;
  }

  if (msg.type === "embed_texts") {
    const pl = pipeline;
    void (async () => {
      try {
        const vectors = await pl.embedTexts(msg.texts);
        sendToMain({
          type: "embed_texts_result",
          id: msg.id,
          ok: true,
          vectors: vectors.map((v) => Array.from(v)),
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        sendToMain({ type: "embed_texts_result", id: msg.id, ok: false, error: m });
      }
    })();
    return;
  }

  if (msg.type === "embed_item") {
    const itemId = msg.itemId;
    const conn = db;
    const pl = pipeline;
    embedChain = embedChain
      .then(async () => {
        const row = conn
          .query(`SELECT id, title, body_preview FROM item WHERE id = ?`)
          .get(itemId) as IndexedItem | null | undefined;
        if (row === null || row === undefined) {
          return;
        }
        await pl.embedItem(row);
      })
      .catch(() => {
        /* best-effort */
      });
  }
};
