#!/usr/bin/env bun
/**
 * S10 audit writer Worker — appends audit_log rows under contention.
 *
 * Replicates the body of `db/audit-chain.ts:appendAuditEntry` inline —
 * same prev_hash lookup, same `computeAuditRowHash` BLAKE3 recipe — but
 * routes the INSERT through the production `dbRun` wrapper so spec §9
 * acceptance ("all three Workers route writes through db/write.ts") is
 * satisfied for this Worker too. (`appendAuditEntry` itself uses
 * `db.run` because it pre-dates the wrapper; that's a separate prod
 * concern, not addressed here.)
 */

import { Database } from "bun:sqlite";

import { computeAuditRowHash, GENESIS_HASH } from "../../db/audit-chain.ts";
import { dbRun } from "../../db/write.ts";
import { LocalIndex } from "../../index/local-index.ts";
import { type ParentMsg, runWorkerLoop, type WorkerMsg } from "./sqlite-worker-shared.ts";

declare const self: Worker;

const AUDIT_INSERT_SQL = `INSERT INTO audit_log (
  action_type, hitl_status, action_json, timestamp, row_hash, prev_hash
) VALUES (?, ?, ?, ?, ?, ?)`;

let db: Database | null = null;
let counter = 0;
let stopRequested = false;

function postMsg(msg: WorkerMsg): void {
  self.postMessage(msg);
}

function doOneWrite(): void {
  if (db === null) throw new Error("db not initialised");
  counter += 1;
  const timestamp = Date.now();
  const actionJson = `{"counter":${counter}}`;
  const rawPrev = db.query(`SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1`).get() as
    | { row_hash: string | null }
    | undefined;
  const h = rawPrev?.row_hash;
  const prevHash = typeof h === "string" && h.length === 64 ? h : GENESIS_HASH;
  const rowHash = computeAuditRowHash({
    prevHash,
    actionType: "bench.s10.audit",
    hitlStatus: "n/a",
    actionJson,
    timestamp,
  });
  dbRun(db, AUDIT_INSERT_SQL, ["bench.s10.audit", "n/a", actionJson, timestamp, rowHash, prevHash]);
}

self.onmessage = async (e: MessageEvent<unknown>): Promise<void> => {
  const msg = e.data as ParentMsg;
  try {
    if (msg.kind === "init") {
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
