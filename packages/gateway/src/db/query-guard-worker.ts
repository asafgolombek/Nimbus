// Worker entry point — opens a fresh readonly handle, runs the SELECT,
// posts the rows back. The parent process owns the AbortController and
// terminates this worker via worker.terminate() on timeout.

import { Database } from "bun:sqlite";

declare const self: Worker;

self.onmessage = (e: MessageEvent<{ dbPath: string; sql: string }>): void => {
  try {
    const { dbPath, sql } = e.data;
    const ro = new Database(dbPath, { readonly: true, create: false });
    try {
      const rows = ro.query(sql).all() as Record<string, unknown>[];
      self.postMessage({ ok: true, rows });
    } finally {
      ro.close();
    }
  } catch (err) {
    self.postMessage({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
