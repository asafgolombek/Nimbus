#!/usr/bin/env bun
/**
 * S10 sync writer Worker — bulk-inserts items via the production
 * `dbRun` wrapper. Runs in its own bun:sqlite handle so the OS sees a
 * second writer competing for the database file lock with the watcher
 * + audit Workers.
 *
 * Every write goes through `dbRun` (packages/gateway/src/db/write.ts)
 * so SQLITE_FULL is converted to DiskFullError just like in production.
 * The INSERT shape mirrors `index/item-store.ts:71` — 13 columns +
 * ON CONFLICT(id) DO UPDATE — same schema we'd hit on a real sync.
 */

import { Database } from "bun:sqlite";

import { dbRun } from "../../db/write.ts";
import { LocalIndex } from "../../index/local-index.ts";
import { type ParentMsg, runWorkerLoop, type WorkerMsg } from "./sqlite-worker-shared.ts";

declare const self: Worker;

interface SyncConfig {
  /** Per-write batch size for the row PK. Default 100. Higher = fewer transactions. */
  batchSize?: number;
  /** Suffix prepended to row IDs to keep this worker's writes from colliding. */
  idPrefix?: string;
}

const ITEM_INSERT_SQL = `INSERT INTO item (
  id, service, type, external_id, title, body_preview, url, canonical_url,
  modified_at, author_id, metadata, synced_at, pinned
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  service = excluded.service,
  type = excluded.type,
  external_id = excluded.external_id,
  title = excluded.title,
  body_preview = excluded.body_preview,
  url = excluded.url,
  canonical_url = excluded.canonical_url,
  modified_at = excluded.modified_at,
  author_id = excluded.author_id,
  metadata = excluded.metadata,
  synced_at = excluded.synced_at,
  pinned = excluded.pinned`;

let db: Database | null = null;
let counter = 0;
let stopRequested = false;
let durationMs = 0;
let config: SyncConfig = {};

function postMsg(msg: WorkerMsg): void {
  self.postMessage(msg);
}

function doOneWrite(): void {
  if (db === null) throw new Error("db not initialised");
  const idPrefix = config.idPrefix ?? "sync";
  const id = `${idPrefix}:${counter}`;
  counter += 1;
  const now = Date.now();
  dbRun(db, ITEM_INSERT_SQL, [
    id,
    "github",
    "issue",
    String(counter),
    `Bench item ${counter}`,
    "synthetic",
    null,
    null,
    now,
    null,
    "{}",
    now,
    0,
  ]);
}

self.onmessage = async (e: MessageEvent<unknown>): Promise<void> => {
  const msg = e.data as ParentMsg;
  try {
    if (msg.kind === "init") {
      config = msg.config as SyncConfig;
      db = new Database(msg.dbPath);
      LocalIndex.ensureSchema(db);
      postMsg({ kind: "ready" });
      return;
    }
    if (msg.kind === "stop") {
      stopRequested = true;
      return;
    }
    if (msg.kind === "start") {
      durationMs = msg.durationMs;
      const ac = new AbortController();
      const checkStop = setInterval(() => {
        if (stopRequested) ac.abort();
      }, 50);
      try {
        const result = await runWorkerLoop({
          durationMs,
          signal: ac.signal,
          deps: {
            doOneWrite,
            now: () => performance.now(),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          },
        });
        postMsg({ kind: "done", writes: result.writes, busyRetries: result.busyRetries });
      } finally {
        clearInterval(checkStop);
      }
    }
  } catch (err) {
    postMsg({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
    });
  }
};
