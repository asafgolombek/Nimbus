import type { NimbusFleetJobToml, NimbusFleetToml } from "../config/fleet-toml.ts";
import type { HostActivity, HostActivityProbe } from "../platform/host-activity.ts";
import type { AdmissionVerdict } from "./fleet-admission.ts";
import { admitFleetRun } from "./fleet-admission.ts";
import type { FleetInvoker } from "./fleet-invoker.ts";
import type { FleetJobState, FleetRunOutcome, FleetStore } from "./fleet-store.ts";

/** The local `[fleet] enabled` kill-switch, or the org-policy lockoff (I22). */
export class FleetDisabledError extends Error {}

/**
 * A `jobName` that matches nothing. Deliberately NOT a `FleetDisabledError`: nothing is disabled,
 * the caller mistyped, and a consumer mapping errors to exit codes or RPC codes needs to tell
 * "the owner turned this off" apart from "that job does not exist".
 */
export class FleetJobNotFoundError extends Error {}

export interface FleetRunSummary {
  /** `null` when no `fleet_run` row was opened — the run was refused before any work began. */
  readonly runId: string | null;
  readonly outcome: FleetRunOutcome;
  readonly jobsAttempted: number;
  readonly jobsCompleted: number;
  readonly jobsUnattempted: number;
}

/**
 * `jobName?: string | undefined` rather than `jobName?: string`, because the repo compiles with
 * `exactOptionalPropertyTypes: true` and the RPC caller forwards an optional param straight
 * through (`{ jobName: params.job }`, where `params.job` may legitimately be undefined). The
 * alternative is every caller rebuilding the object conditionally to express "no job named".
 */
export interface FleetRunOptions {
  readonly force?: boolean | undefined;
  readonly jobName?: string | undefined;
}

export interface FleetSchedulerDeps {
  readonly store: FleetStore;
  readonly jobs: readonly NimbusFleetJobToml[];
  readonly config: NimbusFleetToml;
  /** `EnforcedPolicy.capabilitiesDisabled.has("agent_fleet")`, resolved by the caller (I22). */
  readonly capabilityDisabled: boolean;
  readonly hostActivity: HostActivity;
  readonly invoke: FleetInvoker;
  readonly now: () => number;
  readonly remoteCallsMade?: (() => number) | undefined;
  /** Test seam only. Production leaves it at `DEFAULT_TICK_MS`. */
  readonly tickMs?: number | undefined;
}

export const DEFAULT_TICK_MS = 60_000;

/**
 * Whether a job is due: past its backoff, and at least `interval_seconds` since its last SUCCESS.
 *
 * Keyed on `lastSuccessAt`, not `lastAttemptAt`: a job that failed should be retried when its
 * backoff expires, not held off for a full interval on top. A job that has never succeeded is due.
 *
 * Without this the 60-second tick reruns every job every minute — a daily job producing 60 briefs
 * an hour all night, and `interval_seconds` parsed by the config layer and read by nothing.
 */
export function isJobDue(
  job: NimbusFleetJobToml,
  state: FleetJobState | undefined,
  now: number,
): boolean {
  if (state?.backoffUntil != null && state.backoffUntil > now) return false;
  if (state?.lastSuccessAt == null) return true;
  return now - state.lastSuccessAt >= job.intervalSeconds * 1000;
}

export class FleetScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  /**
   * Re-entrancy guard. `start()` ticks every 60 s, and a real run — a cold `ownership` plus an
   * `impact` with synthesis — routinely takes minutes. Without this, tick N+1 opens a second
   * `fleet_run`, interleaves its writes with the first, and puts two jobs on the local model at
   * once: the exact concurrency the sequential invoker exists to prevent, reintroduced one level
   * up. It is set and cleared around a single `await` in `runOnce`, so no caller can observe it
   * half-applied, and the `finally` clears it on the throwing path too.
   */
  private inFlight = false;

  constructor(private readonly deps: FleetSchedulerDeps) {}

  start(): void {
    if (this.timer !== undefined) return;
    // `unref` so a pending tick never holds the process open — a hung fleet timer would make
    // `bun test` and a clean gateway shutdown hang identically.
    this.timer = setInterval(
      () => void this.runOnce().catch(() => undefined),
      this.deps.tickMs ?? DEFAULT_TICK_MS,
    );
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * One pass. `force` skips ADMISSION ONLY — the idle/power checks, which exist to protect the
   * user's machine and which an owner typing the command is by definition present to override. It
   * never skips the config kill-switch, the org-policy lockoff, agent eligibility (resolved inside
   * the invoker) or I38's remote budget (enforced by the wrapped synthesis router).
   */
  async runOnce(opts?: FleetRunOptions): Promise<FleetRunSummary> {
    // Ordering mirrors I33: local kill-switch, then org policy, BOTH before any work — so a
    // disabled capability never advertises itself by probing hardware or opening a run row.
    if (!this.deps.config.enabled) {
      throw new FleetDisabledError("fleet is disabled ([fleet] enabled = false)");
    }
    if (this.deps.capabilityDisabled) {
      throw new FleetDisabledError("fleet is disabled by org policy");
    }

    const jobName = opts?.jobName;
    const jobs =
      jobName === undefined ? this.deps.jobs : this.deps.jobs.filter((j) => j.name === jobName);
    // Throws rather than running everything: `nimbus fleet run typo` must not become
    // "run every configured job", which is the worst possible reading of a typo.
    if (jobName !== undefined && jobs.length === 0) {
      throw new FleetJobNotFoundError(`no such fleet job: ${jobName}`);
    }

    if (this.inFlight) {
      return {
        runId: null,
        outcome: "deferred",
        jobsAttempted: 0,
        jobsCompleted: 0,
        jobsUnattempted: jobs.length,
      };
    }
    this.inFlight = true;
    try {
      return await this.execute(jobs, opts?.force === true);
    } finally {
      this.inFlight = false;
    }
  }

  private admit(probe: HostActivityProbe): AdmissionVerdict {
    return admitFleetRun(probe, {
      requireAcPower: this.deps.config.requireAcPower,
      minIdleSeconds: this.deps.config.minIdleSeconds,
    });
  }

  private async execute(
    jobs: readonly NimbusFleetJobToml[],
    force: boolean,
  ): Promise<FleetRunSummary> {
    const probe = await this.deps.hostActivity.probe();
    const admitted = this.admit(probe).admitted;

    const startedAt = this.deps.now();
    const runId = this.deps.store.openRun({
      startedAt,
      hostPower: probe.power,
      hostIdleMs: probe.idleMs,
      hostSource: probe.source,
      remoteCallBudget: this.deps.config.remoteCallBudget,
    });

    const close = (
      outcome: FleetRunOutcome,
      attempted: number,
      completed: number,
    ): FleetRunSummary => {
      this.deps.store.closeRun(runId, {
        endedAt: this.deps.now(),
        outcome,
        jobsAttempted: attempted,
        jobsCompleted: completed,
        remoteCallsMade: this.deps.remoteCallsMade?.() ?? 0,
      });
      return {
        runId,
        outcome,
        jobsAttempted: attempted,
        jobsCompleted: completed,
        jobsUnattempted: jobs.length - attempted,
      };
    };

    if (!admitted && !force) return close("deferred", 0, 0);

    const expiresAt = startedAt + this.deps.config.retentionDays * 86_400_000;
    let attempted = 0;
    let completed = 0;

    try {
      for (const job of jobs) {
        // Re-probe BETWEEN jobs, not only at the start. Stopping at a boundary rather than
        // mid-brief is why the boundary exists: a half-written brief is worse than an absent one.
        if (attempted > 0 && !force) {
          const again = await this.deps.hostActivity.probe();
          if (!this.admit(again).admitted) return close("yielded", attempted, completed);
        }

        // Due check AND backoff, both inside `isJobDue`. `force` (an owner at a keyboard)
        // overrides the schedule; it does not override the capability, eligibility or I38's budget.
        if (!force && !isJobDue(job, this.deps.store.loadJobState(job.name), this.deps.now())) {
          continue;
        }

        attempted += 1;
        const outcome = await this.deps.invoke(job);
        if (outcome.status === "done") {
          this.deps.store.recordBrief({
            runId,
            jobId: job.name,
            agentMethod: `agents.${job.agent}`,
            briefMarkdown: outcome.briefMarkdown,
            findingsJson: outcome.findingsJson,
            synthesisJson: outcome.synthesisJson,
            createdAt: this.deps.now(),
            expiresAt,
          });
          this.deps.store.recordJobSuccess(job.name, this.deps.now());
          completed += 1;
        } else {
          // Isolated, not fatal. A run that aborted on the first bad config line would let one
          // stale entry silence every other brief indefinitely — and overnight, nobody notices.
          this.deps.store.recordJobFailure(job.name, this.deps.now(), outcome.error);
        }
      }
    } catch (err) {
      // The invoker CONTRACT returns `{ status: "failed" }` rather than throwing, so reaching here
      // means something below it broke its contract (or the store did). Close the row as `failed`
      // and rethrow: an abandoned run row keeps `outcome` NULL forever, which reads as "still
      // running" to every consumer and is the one state `nimbus fleet status` cannot recover from.
      // This is also the only writer of the `failed` outcome the schema already allows.
      close("failed", attempted, completed);
      throw err;
    }

    return close("completed", attempted, completed);
  }
}
