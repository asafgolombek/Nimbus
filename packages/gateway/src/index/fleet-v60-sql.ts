/**
 * V60 — overnight agent fleet scheduling (spec § 9).
 *
 * `fleet_job_state` holds ONLY what config cannot: config remains the source of truth for job
 * definitions, this table for what happened to them. Same split as
 * `sync/scheduler-state-repository.ts`.
 *
 * `fleet_brief.run_id`'s cascade is live rather than decorative: `index/local-index.ts` runs
 * `PRAGMA foreign_keys = ON`. SQLite defaults them OFF, and a cascade written against a database
 * that never enabled them is a silent no-op that leaves orphans forever — hence the explicit note
 * and the test that deletes a parent row.
 */
export const FLEET_V60_SQL = `
CREATE TABLE IF NOT EXISTS fleet_job_state (
  job_id                TEXT PRIMARY KEY,
  last_attempt_at       INTEGER,
  last_success_at       INTEGER,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  backoff_until         INTEGER,
  last_error            TEXT
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS fleet_run (
  id                    TEXT PRIMARY KEY,
  started_at            INTEGER NOT NULL,
  ended_at              INTEGER,
  host_power            TEXT NOT NULL CHECK (host_power IN ('ac', 'battery', 'unknown')),
  host_idle_ms          INTEGER,
  host_source           TEXT NOT NULL CHECK (host_source IN ('measured', 'power_only')),
  outcome               TEXT CHECK (outcome IN ('completed', 'yielded', 'deferred', 'failed')),
  -- How many jobs were in scope for this run: the whole configured set, or the single job named
  -- by a targeted "nimbus fleet run <job>". Persisted so the row is SELF-DESCRIBING -- with it,
  -- every number the run reported is derivable from the row alone:
  --   unattempted = jobs_in_scope - jobs_attempted - jobs_skipped_not_due
  -- so a reader can answer "how many jobs did not get to run" months later, after the config that
  -- produced the run has been edited. Without it that question is unanswerable from history.
  -- (No backticks in this comment: the whole DDL is a TypeScript template literal.)
  jobs_in_scope         INTEGER NOT NULL DEFAULT 0,
  jobs_attempted        INTEGER NOT NULL DEFAULT 0,
  jobs_completed        INTEGER NOT NULL DEFAULT 0,
  -- Jobs in scope but outside their interval or inside a backoff. Deliberately SEPARATE from
  -- (jobs_attempted, jobs_completed): a reader must be able to tell "not scheduled yet, working as
  -- configured" from "wanted to run and was stopped short", because a run that reports fewer jobs
  -- than it was configured for, with no way to say which kind of fewer, is the disclosure failure
  -- this table exists to avoid.
  jobs_skipped_not_due  INTEGER NOT NULL DEFAULT 0,
  remote_calls_made     INTEGER NOT NULL DEFAULT 0,
  remote_call_budget    INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS fleet_brief (
  id                    TEXT PRIMARY KEY,
  run_id                TEXT NOT NULL REFERENCES fleet_run(id) ON DELETE CASCADE,
  job_id                TEXT NOT NULL,
  agent_method          TEXT NOT NULL,
  brief_markdown        TEXT,
  findings_json         TEXT NOT NULL,
  synthesis_json        TEXT,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_fleet_brief_run ON fleet_brief (run_id);
CREATE INDEX IF NOT EXISTS idx_fleet_brief_job ON fleet_brief (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_brief_expires ON fleet_brief (expires_at);
CREATE INDEX IF NOT EXISTS idx_fleet_run_started ON fleet_run (started_at DESC);
`;
