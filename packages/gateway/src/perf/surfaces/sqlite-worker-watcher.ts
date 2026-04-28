#!/usr/bin/env bun
/**
 * S10 watcher writer Worker — inserts watcher_event rows via the
 * production `dbRun` wrapper. Pre-seeds one watcher row at init so the
 * `watcher_event.watcher_id → watcher.id` FK constraint passes (FKs
 * are turned ON by `LocalIndex.ensureSchema`).
 *
 * INSERT shape matches `automation/watcher-store.ts:99-103`.
 */

import { Database } from "bun:sqlite";

import { dbRun } from "../../db/write.ts";
import { LocalIndex } from "../../index/local-index.ts";
import { type ParentMsg, runWorkerLoop, type WorkerMsg } from "./sqlite-worker-shared.ts";

declare const self: Worker;

const WATCHER_ID = "bench-s10-watcher";

const WATCHER_SEED_SQL = `INSERT OR IGNORE INTO watcher (
  id, name, enabled, condition_type, condition_json, action_type, action_json, created_at
) VALUES (?, ?, 1, 'count', '{}', 'noop', '{}', ?)`;

const WATCHER_EVENT_INSERT_SQL = `INSERT INTO watcher_event (
  watcher_id, fired_at, condition_snapshot, action_result
) VALUES (?, ?, ?, ?)`;

let db: Database | null = null;
let counter = 0;
let stopRequested = false;

function postMsg(msg: WorkerMsg): void {
  self.postMessage(msg);
}

function doOneWrite(): void {
  if (db === null) throw new Error("db not initialised");
  counter += 1;
  dbRun(db, WATCHER_EVENT_INSERT_SQL, [WATCHER_ID, Date.now(), `{"count":${counter}}`, null]);
}

self.onmessage = async (e: MessageEvent<unknown>): Promise<void> => {
  const msg = e.data as ParentMsg;
  try {
    if (msg.kind === "init") {
      db = new Database(msg.dbPath);
      LocalIndex.ensureSchema(db);
      dbRun(db, WATCHER_SEED_SQL, [WATCHER_ID, "bench-s10", Date.now()]);
      postMsg({ kind: "ready" });
      return;
    }
    if (msg.kind === "stop") {
      stopRequested = true;
      return;
    }
    if (msg.kind === "start") {
      const ac = new AbortController();
      const checkStop = setInterval(() => {
        if (stopRequested) ac.abort();
      }, 50);
      try {
        const result = await runWorkerLoop({
          durationMs: msg.durationMs,
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
