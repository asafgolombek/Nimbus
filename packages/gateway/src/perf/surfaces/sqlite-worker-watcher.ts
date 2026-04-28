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
import { runWorkerEntry, type WorkerSelf } from "./sqlite-worker-shared.ts";

declare const self: Worker;

const WATCHER_ID = "bench-s10-watcher";

const WATCHER_SEED_SQL = `INSERT OR IGNORE INTO watcher (
  id, name, enabled, condition_type, condition_json, action_type, action_json, created_at
) VALUES (?, ?, 1, 'count', '{}', 'noop', '{}', ?)`;

const WATCHER_EVENT_INSERT_SQL = `INSERT INTO watcher_event (
  watcher_id, fired_at, condition_snapshot, action_result
) VALUES (?, ?, ?, ?)`;

runWorkerEntry<Record<string, unknown>>(self as unknown as WorkerSelf, {
  init: (_config, dbPath) => {
    const db = new Database(dbPath);
    LocalIndex.ensureSchema(db);
    dbRun(db, WATCHER_SEED_SQL, [WATCHER_ID, "bench-s10", Date.now()]);
    let counter = 0;
    return {
      doOneWrite: (): void => {
        counter += 1;
        dbRun(db, WATCHER_EVENT_INSERT_SQL, [WATCHER_ID, Date.now(), `{"count":${counter}}`, null]);
      },
    };
  },
});
