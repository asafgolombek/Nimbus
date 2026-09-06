import type { NimbusFleetJobToml, NimbusFleetToml } from "../config/fleet-toml.ts";
import type { HostActivity, HostActivityProbe } from "../platform/host-activity.ts";
import type { AdmissionVerdict } from "./fleet-admission.ts";
import { admitFleetRun } from "./fleet-admission.ts";
import type { FleetInvoker } from "./fleet-invoker.ts";
import type { FleetJobState, FleetRunOutcome, FleetStore } from "./fleet-store.ts";

/**
 * The `AI_V2_CAPABILITIES` member (`policy/types.ts`) an org policy disables to turn the fleet off
 * gateway-wide (I22). Exported so a test can pin it against that frozen list rather than repeating
 * the string — a typo here would read as "never disabled", which is the direction that fails open.
 */
export const FLEET_CAPABILITY = "agent_fleet";

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
  /**
   * In scope and did not run, having NOT been classified as not-due — the yield and abandon cases.
   *
   * A job that was simply not scheduled yet is NOT counted here; it is `jobsSkippedNotDue`. The
   * two are different facts and a human acts differently on each: "the fleet was stopped before it
   * got to 2 jobs" is a reason to look at the machine, "2 jobs are not due yet" is the scheduler
   * working exactly as configured. Folding them together makes every ordinary tick on a
   * daily-interval fleet look like a run that gave up — a disclosure failure wearing the shape of
   * a smaller number, which is precisely what this counter exists to avoid.
   *
   * NOTE FOR AN AGGREGATOR: on a `deferred` run this is `jobs.length`, every time. A deferred run
   * is refused BEFORE any job is assessed for dueness, so no job can be classified as not-due and
   * every job in scope genuinely did not run — `jobs.length` is the honest number, not a fallback.
   * The consequence is that this field is not directly comparable across a deferred run and a
   * completed one: averaging the two averages two different meanings. Nothing in this codebase
   * aggregates these rows today; whoever first does must bucket by `outcome`.
   */
  readonly jobsUnattempted: number;
  /** In scope but outside its `interval_seconds` or inside its backoff. Not a failure. */
  readonly jobsSkippedNotDue: number;
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
  /**
   * The fleet budget's CUMULATIVE remote-call count for this process — production passes
   * `() => remoteBudget.spent()` on the SAME `FleetRemoteBudget` instance the invoker caps against
   * (I38). `execute` persists the delta across a run, never this value verbatim.
   *
   * Optional because the scheduler is constructible without a budget (tests, and a fleet assembled
   * before a router exists), NOT because production may omit it: it did, and
   * `fleet_run.remote_calls_made` then recorded 0 on every run while the column claimed to count
   * remote model calls. Omitting it means "this run made no remote calls I can account for", which
   * is only honest when there is genuinely no budget to read.
   */
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
        // Nothing was evaluated for dueness, so nothing can be classified as not-due: every job in
        // scope is genuinely unattempted because another run held the lane.
        jobsUnattempted: jobs.length,
        jobsSkippedNotDue: 0,
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

    // ONE mutable tally, read by `close` rather than threaded through it as arguments. Every exit
    // (deferred, yielded, failed, completed) then reports the same numbers by construction — three
    // positional counters at four call sites is how one of them ends up stale on one path.
    const tally = { attempted: 0, completed: 0, skippedNotDue: 0 };

    // `remoteCallsMade` is CUMULATIVE for the gateway process: `platform/assemble.ts` builds ONE
    // `FleetRemoteBudget` at boot (the cap is a process-lifetime cap, which is what makes it a cap
    // at all), so the getter's value at `close` includes every earlier run's spend. Persisting it
    // verbatim would make run 2 report run 1's calls as its own — a false record on the one column
    // whose job is to say what THIS run spent. So the DELTA either side of the run is what is
    // written. This stays correct if the budget is ever made per-run: the opening read is then 0
    // and the delta is the whole of it. Captured HERE, before the first job, and before `close` can
    // be reached by any path including the deferred one (where the delta is 0, correctly).
    const remoteCallsAtStart = this.deps.remoteCallsMade?.() ?? 0;

    const close = (outcome: FleetRunOutcome): FleetRunSummary => {
      this.deps.store.closeRun(runId, {
        endedAt: this.deps.now(),
        outcome,
        // Written on EVERY exit, the deferred path included — that is the case the row could not
        // previously describe at all: attempted 0, skipped 0, and no record of how many jobs were
        // waiting behind the refusal.
        jobsInScope: jobs.length,
        jobsAttempted: tally.attempted,
        jobsCompleted: tally.completed,
        jobsSkippedNotDue: tally.skippedNotDue,
        remoteCallsMade: (this.deps.remoteCallsMade?.() ?? 0) - remoteCallsAtStart,
      });
      return {
        runId,
        outcome,
        jobsAttempted: tally.attempted,
        jobsCompleted: tally.completed,
        // Not-due jobs are subtracted OUT: they were never going to run this tick, so counting
        // them as unattempted would report an ordinary tick as a run that gave up.
        jobsUnattempted: jobs.length - tally.attempted - tally.skippedNotDue,
        jobsSkippedNotDue: tally.skippedNotDue,
      };
    };

    if (!admitted && !force) return close("deferred");

    const expiresAt = startedAt + this.deps.config.retentionDays * 86_400_000;

    try {
      for (const job of jobs) {
        // Re-probe BETWEEN jobs, not only at the start. Stopping at a boundary rather than
        // mid-brief is why the boundary exists: a half-written brief is worse than an absent one.
        if (tally.attempted > 0 && !force) {
          const again = await this.deps.hostActivity.probe();
          if (!this.admit(again).admitted) return close("yielded");
        }

        // Due check AND backoff, both inside `isJobDue`. `force` (an owner at a keyboard)
        // overrides the schedule; it does not override the capability, eligibility or I38's budget.
        if (!force && !isJobDue(job, this.deps.store.loadJobState(job.name), this.deps.now())) {
          tally.skippedNotDue += 1;
          continue;
        }

        tally.attempted += 1;
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
          tally.completed += 1;
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
      //
      // Guarded: `close` writes to SQLite and can itself throw (a closed handle, a disk error). If
      // it did, its error would replace `err` and the ACTUAL cause of the run's failure would never
      // be seen — the row would be unclosed either way, so losing the diagnosis buys nothing.
      try {
        close("failed");
      } catch {
        // Deliberately swallowed: `err` below is the failure worth surfacing.
      }
      throw err;
    }

    return close("completed");
  }
}
