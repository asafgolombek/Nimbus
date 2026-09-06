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
}

export function createFleetRemoteBudget(allowRemote: boolean, budget: number): FleetRemoteBudget {
  let used = 0;
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
      return remoteAllowedNow() ? resolved : undefined;
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
