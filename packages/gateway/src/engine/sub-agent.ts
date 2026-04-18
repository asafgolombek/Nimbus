import type { Database } from "bun:sqlite";
import type { SubTaskExecuteResult, SubTaskType } from "./coordinator.ts";

export type SubAgentRunOptions = {
  sessionId: string;
  parentId: string;
  taskIndex: number;
  taskType: SubTaskType;
  db?: Database;
  execute: () => Promise<SubAgentRunResult>;
};

export type SubAgentRunResult = SubTaskExecuteResult;

export async function runSubAgent(opts: SubAgentRunOptions): Promise<SubAgentRunResult> {
  const now = Date.now();
  let rowId: number | undefined;

  if (opts.db !== undefined) {
    try {
      const stmt = opts.db.run(
        `INSERT INTO sub_task_results
         (session_id, parent_id, task_index, task_type, status, started_at, created_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?)`,
        [opts.sessionId, opts.parentId, opts.taskIndex, opts.taskType, now, now],
      );
      rowId = stmt.lastInsertRowid as number;
    } catch {
      /* DB may be in read-only mode during tests; continue without persistence */
    }
  }

  try {
    const result = await opts.execute();

    if (opts.db !== undefined && rowId !== undefined) {
      const completed = Date.now();
      try {
        opts.db.run(
          `UPDATE sub_task_results
           SET status = 'done', result_json = ?, model_used = ?, tokens_in = ?, tokens_out = ?, completed_at = ?
           WHERE id = ?`,
          [
            JSON.stringify({ text: result.text }),
            result.modelUsed ?? null,
            result.tokensIn,
            result.tokensOut,
            completed,
            rowId,
          ],
        );
      } catch {
        /* best-effort */
      }
    }

    return result;
  } catch (e) {
    if (opts.db !== undefined && rowId !== undefined) {
      try {
        opts.db.run(
          `UPDATE sub_task_results SET status = 'error', error_text = ?, completed_at = ? WHERE id = ?`,
          [e instanceof Error ? e.message : String(e), Date.now(), rowId],
        );
      } catch {
        /* best-effort */
      }
    }
    throw e;
  }
}
