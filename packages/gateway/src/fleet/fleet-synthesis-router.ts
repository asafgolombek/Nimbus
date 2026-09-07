import type { SynthesisRouter } from "../agents/_lib/synthesis-llm.ts";
import type { ResolvedSynthesisProvider } from "../llm/router.ts";

export class FleetRemoteRefusedError extends Error {}

export interface FleetRemoteBudget {
  readonly allowRemote: boolean;
  remaining(): number;
  spent(): number;
  exhausted(): boolean;
  /** Reserves one remote call. Returns false when none is left. */
  consume(): boolean;
  /**
   * Record that a REMOTE provider was withheld — either because `allow_remote` is false or because
   * the budget is spent.
   *
   * This exists so the withholding is DISCLOSABLE. Without it the fleet cannot tell its own briefs
   * apart from ordinary ones: the wrapper returns `undefined` from `resolveForSynthesis`, and
   * `agents/_lib/synthesis-llm.ts` turns that into `no_eligible_provider` with no detail — the same
   * answer it gives when no provider is configured at all. I38's row claimed budget exhaustion was
   * disclosed per brief; it was only disclosed per run, and this closes the difference without
   * widening `SynthesisAttempt`, a union every brief in the repo flows through.
   */
  noteWithheld(): void;
  /** How many times a remote provider was withheld since the last `reset`. */
  withheld(): number;
  /**
   * Returns the budget to its full cap.
   *
   * `[fleet] remote_call_budget` is documented PER RUN, and this is what makes that true.
   * `platform/assemble.ts` builds ONE instance at boot — re-threading a fresh budget through the
   * invoker on every run would mean restructuring the seam Tasks 4-8 settled — so without a reset a
   * cap of 5 would mean five remote calls for the gateway's entire LIFETIME: a machine up for a
   * week would get five, total, which is not what any reader of that key expects. Worse, it would
   * make `fleet_run.remote_call_budget` a false record, claiming 5 on a run that in fact had 5
   * minus everything spent since boot.
   *
   * Called ONLY from `FleetScheduler.execute`, at the run boundary, where the `inFlight` guard
   * serialises runs so a reset can never land mid-run. The scheduler holds a narrowed view of this
   * interface (`FleetRunBudget`) that excludes `consume`, since spending is the invoker's
   * capability and not the scheduler's.
   */
  reset(): void;
}

export function createFleetRemoteBudget(allowRemote: boolean, budget: number): FleetRemoteBudget {
  let used = 0;
  let withheldCount = 0;
  const cap = allowRemote ? Math.max(0, budget) : 0;
  return {
    allowRemote,
    remaining: () => cap - used,
    spent: () => used,
    exhausted: () => used >= cap,
    consume: () => {
      if (used >= cap) return false;
      used += 1;
      return true;
    },
    noteWithheld: () => {
      withheldCount += 1;
    },
    withheld: () => withheldCount,
    reset: () => {
      used = 0;
      // Reset with `used`, not separately: both describe one run, and a withholding count that
      // outlived its run would attribute an earlier run's refusals to this one — the same
      // per-process-vs-per-run confusion the reset itself exists to fix.
      withheldCount = 0;
    },
  };
}

/**
 * I38 — a fleet run reaches a NON-LOCAL model only when `[fleet] allow_remote` is set AND the run's
 * remaining budget covers the call.
 *
 * A DECORATOR over `SynthesisRouter`, not a call-site check, for the reason `wrapLedgeredProvider`
 * (I29), `wrapServerSpec` (I15) and `wrapLedgeredVlm` (D22(g)) are decorators: it covers every
 * caller including ones written later, without their cooperation.
 *
 * BOTH methods are guarded, which is not redundant. `resolveForSynthesis` withholding a remote
 * provider is the normal path and degrades gracefully — `undefined` means the runner falls back to
 * the deterministic render, exactly as `[agents] synthesis = "off"` would. `generateMarkdown`
 * refusing is the second door, for a caller that obtained a provider some other way; fixing one
 * door and leaving the adjacent one open is a defect shape this repo has shipped before.
 *
 * Locality is DERIVED from `provider.isLocal` (I34's single source), never recomputed from a
 * vendor id — a wrong `true` would fail silently in both directions at once.
 *
 * Rejected alternatives: `LlmRouter.setTaskPin` mutates a router-wide map shared with a concurrent
 * interactive `nimbus ask`, so a fleet pin would silently re-route the user's own question and
 * un-setting it races; `enforce_air_gap` is gateway-wide and would disable remote for everything.
 */
export function wrapFleetSynthesisRouter(
  inner: SynthesisRouter,
  budget: FleetRemoteBudget,
): SynthesisRouter {
  const remoteAllowedNow = (): boolean => budget.allowRemote && budget.remaining() > 0;

  return {
    async resolveForSynthesis(
      preferLocal?: boolean,
    ): Promise<ResolvedSynthesisProvider | undefined> {
      const resolved = await inner.resolveForSynthesis(preferLocal);
      if (resolved === undefined || resolved.isLocal) return resolved;
      if (remoteAllowedNow()) return resolved;
      // Withholding is the graceful path — the runner falls back to the deterministic render — but
      // it is indistinguishable downstream from "no provider configured". Record it so the fleet
      // can say which happened.
      budget.noteWithheld();
      return undefined;
    },

    async generateMarkdown(
      prompt: string,
      provider: ResolvedSynthesisProvider,
      egressMethod?: string,
    ): Promise<string> {
      if (!provider.isLocal) {
        if (!budget.allowRemote) {
          throw new FleetRemoteRefusedError(
            "fleet run may not use a remote model: [fleet] allow_remote is false",
          );
        }
        if (!budget.consume()) {
          throw new FleetRemoteRefusedError(
            `fleet run exhausted its remote_call_budget after ${budget.spent()} call(s)`,
          );
        }
      }
      return inner.generateMarkdown(prompt, provider, egressMethod);
    },
  };
}
