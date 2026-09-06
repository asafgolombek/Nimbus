import type { Database } from "bun:sqlite";
import { dbRun } from "../db/write.ts";
import type { HostPower, HostProbeSource } from "../platform/host-activity.ts";

export type FleetRunOutcome = "completed" | "yielded" | "deferred" | "failed";

export interface FleetJobState {
  readonly jobId: string;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly consecutiveFailures: number;
  readonly backoffUntil: number | null;
  readonly lastError: string | null;
}

export interface FleetBriefRow {
  readonly id: string;
  readonly runId: string;
  readonly jobId: string;
  readonly agentMethod: string;
  readonly briefMarkdown: string | null;
  readonly findingsJson: string;
  readonly synthesisJson: string | null;
  readonly createdAt: number;
}

/** 1h, 2h, 4h … capped at 24h. Capped because an uncapped doubling silently retires a job. */
const BACKOFF_BASE_MS = 60 * 60 * 1000;
const BACKOFF_CAP_MS = 24 * BACKOFF_BASE_MS;

export function backoffMsForFailures(consecutiveFailures: number): number {
  const exp = BACKOFF_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1);
  return Math.min(exp, BACKOFF_CAP_MS);
}

export class FleetStore {
  constructor(private readonly db: Database) {}

  openRun(r: {
    startedAt: number;
    hostPower: HostPower;
    hostIdleMs: number | null;
    hostSource: HostProbeSource;
    remoteCallBudget: number;
  }): string {
    const id = crypto.randomUUID();
    dbRun(
      this.db,
      `INSERT INTO fleet_run
         (id, started_at, host_power, host_idle_ms, host_source, remote_call_budget)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, r.startedAt, r.hostPower, r.hostIdleMs, r.hostSource, r.remoteCallBudget],
    );
    return id;
  }

  closeRun(
    runId: string,
    r: {
      endedAt: number;
      outcome: FleetRunOutcome;
      jobsAttempted: number;
      jobsCompleted: number;
      remoteCallsMade: number;
    },
  ): void {
    dbRun(
      this.db,
      `UPDATE fleet_run
          SET ended_at = ?, outcome = ?, jobs_attempted = ?, jobs_completed = ?,
              remote_calls_made = ?
        WHERE id = ?`,
      [r.endedAt, r.outcome, r.jobsAttempted, r.jobsCompleted, r.remoteCallsMade, runId],
    );
  }

  recordBrief(b: {
    runId: string;
    jobId: string;
    agentMethod: string;
    briefMarkdown: string | null;
    findingsJson: string;
    synthesisJson: string | null;
    createdAt: number;
    expiresAt: number;
  }): string {
    const id = crypto.randomUUID();
    dbRun(
      this.db,
      `INSERT INTO fleet_brief
         (id, run_id, job_id, agent_method, brief_markdown, findings_json, synthesis_json,
          created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        b.runId,
        b.jobId,
        b.agentMethod,
        b.briefMarkdown,
        b.findingsJson,
        b.synthesisJson,
        b.createdAt,
        b.expiresAt,
      ],
    );
    return id;
  }

  loadJobState(jobId: string): FleetJobState | undefined {
    const row = this.db
      .query(
        `SELECT job_id, last_attempt_at, last_success_at, consecutive_failures,
                backoff_until, last_error
           FROM fleet_job_state WHERE job_id = ?`,
      )
      .get(jobId) as {
      job_id: string;
      last_attempt_at: number | null;
      last_success_at: number | null;
      consecutive_failures: number;
      backoff_until: number | null;
      last_error: string | null;
    } | null;
    if (row === null) return undefined;
    return {
      jobId: row.job_id,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      consecutiveFailures: row.consecutive_failures,
      backoffUntil: row.backoff_until,
      lastError: row.last_error,
    };
  }

  recordJobSuccess(jobId: string, now: number): void {
    dbRun(
      this.db,
      `INSERT INTO fleet_job_state
         (job_id, last_attempt_at, last_success_at, consecutive_failures, backoff_until, last_error)
       VALUES (?, ?, ?, 0, NULL, NULL)
       ON CONFLICT(job_id) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at,
         consecutive_failures = 0, backoff_until = NULL, last_error = NULL`,
      [jobId, now, now],
    );
  }

  recordJobFailure(jobId: string, now: number, error: string): void {
    const failures = (this.loadJobState(jobId)?.consecutiveFailures ?? 0) + 1;
    dbRun(
      this.db,
      `INSERT INTO fleet_job_state
         (job_id, last_attempt_at, last_success_at, consecutive_failures, backoff_until, last_error)
       VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         consecutive_failures = excluded.consecutive_failures,
         backoff_until = excluded.backoff_until,
         last_error = excluded.last_error`,
      [jobId, now, failures, now + backoffMsForFailures(failures), error],
    );
  }

  listBriefs(q: { limit: number; jobId?: string }): FleetBriefRow[] {
    const rows = (
      q.jobId === undefined
        ? this.db
            .query(
              `SELECT id, run_id, job_id, agent_method, brief_markdown, findings_json,
                      synthesis_json, created_at
                 FROM fleet_brief ORDER BY created_at DESC LIMIT ?`,
            )
            .all(q.limit)
        : this.db
            .query(
              `SELECT id, run_id, job_id, agent_method, brief_markdown, findings_json,
                      synthesis_json, created_at
                 FROM fleet_brief WHERE job_id = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .all(q.jobId, q.limit)
    ) as ReadonlyArray<{
      id: string;
      run_id: string;
      job_id: string;
      agent_method: string;
      brief_markdown: string | null;
      findings_json: string;
      synthesis_json: string | null;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      jobId: r.job_id,
      agentMethod: r.agent_method,
      briefMarkdown: r.brief_markdown,
      findingsJson: r.findings_json,
      synthesisJson: r.synthesis_json,
      createdAt: r.created_at,
    }));
  }

  /** A point lookup on the primary key — never a scan. `brief_markdown` can be tens of KB. */
  getBrief(id: string): FleetBriefRow | undefined {
    const row = this.db
      .query(
        `SELECT id, run_id, job_id, agent_method, brief_markdown, findings_json,
                synthesis_json, created_at
           FROM fleet_brief WHERE id = ?`,
      )
      .get(id) as {
      id: string;
      run_id: string;
      job_id: string;
      agent_method: string;
      brief_markdown: string | null;
      findings_json: string;
      synthesis_json: string | null;
      created_at: number;
    } | null;
    if (row === null) return undefined;
    return {
      id: row.id,
      runId: row.run_id,
      jobId: row.job_id,
      agentMethod: row.agent_method,
      briefMarkdown: row.brief_markdown,
      findingsJson: row.findings_json,
      synthesisJson: row.synthesis_json,
      createdAt: row.created_at,
    };
  }

  /** Deletes briefs whose `expires_at` is at or before `now`. Returns the count removed. */
  pruneBriefs(now: number): number {
    const before = this.db.query(`SELECT COUNT(*) AS n FROM fleet_brief`).get() as { n: number };
    dbRun(this.db, `DELETE FROM fleet_brief WHERE expires_at <= ?`, [now]);
    const after = this.db.query(`SELECT COUNT(*) AS n FROM fleet_brief`).get() as { n: number };
    return before.n - after.n;
  }

  /**
   * Deletes runs started at or before `cutoff`. Their briefs go with them via the FK cascade —
   * which is why this exists: pruning only `fleet_brief` would leave one `fleet_run` row per
   * tick accumulating forever, and at a 60-second tick that is ~525k rows a year.
   */
  pruneRuns(cutoff: number): number {
    const before = this.db.query(`SELECT COUNT(*) AS n FROM fleet_run`).get() as { n: number };
    dbRun(this.db, `DELETE FROM fleet_run WHERE started_at <= ?`, [cutoff]);
    const after = this.db.query(`SELECT COUNT(*) AS n FROM fleet_run`).get() as { n: number };
    return before.n - after.n;
  }
}
