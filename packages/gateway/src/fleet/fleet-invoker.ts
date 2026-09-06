import type { Database } from "bun:sqlite";
import { buildAgentSynthesisRunner } from "../agents/_lib/agent-synthesis-runner.ts";
import type { SynthesisRouter } from "../agents/_lib/synthesis-llm.ts";
import type { NimbusFleetJobToml } from "../config/fleet-toml.ts";
import type { LocalIndex } from "../index/local-index.ts";
import type { AgentMethod, AgentsRpcContext } from "../ipc/agents-rpc.ts";
import { AgentsRpcError, dispatchAgentsRpc, resolveFleetAgentMethod } from "../ipc/agents-rpc.ts";
import type { FleetRemoteBudget } from "./fleet-synthesis-router.ts";
import { wrapFleetSynthesisRouter } from "./fleet-synthesis-router.ts";

/** Generous: a cold `impact` on a large index is slow. Bounded because unbounded wedges the fleet. */
export const DEFAULT_JOB_TIMEOUT_MS = 10 * 60_000;

export type FleetJobOutcome =
  | {
      readonly status: "done";
      readonly briefMarkdown: string | null;
      readonly findingsJson: string;
      readonly synthesisJson: string | null;
    }
  | { readonly status: "failed"; readonly error: string };

/**
 * The context a fleet dispatch receives.
 *
 * DERIVED from `AgentsRpcContext` rather than restated, so it cannot drift from the shape the real
 * dispatcher accepts — the drift that a second hand-written copy invites is exactly what makes an
 * injected seam typecheck while the production call does something else. The one narrowing is
 * `caller`: REQUIRED (a fleet call is never anonymous) and pinned to `kind: "fleet"`, which is the
 * attribution D28 confines to this file.
 */
export type FleetDispatchContext = Omit<AgentsRpcContext, "caller"> & {
  readonly caller: { readonly clientId: string; readonly kind: "fleet" };
};

/**
 * The dispatch seam, injected so the invoker is testable without a live agent stack.
 *
 * It resolves to the agent handler's OWN value (`{ sessionId }`), not to the `RpcMissOrHit`
 * envelope `dispatchAgentsRpc` returns — `defaultFleetDispatch` below unwraps that. Two shapes
 * behind one seam is how a test double ends up agreeing with a contract production never sees.
 */
export type FleetDispatch = (
  method: AgentMethod,
  params: unknown,
  ctx: FleetDispatchContext,
) => Promise<unknown>;

export interface FleetInvokerDeps {
  readonly db: Database;
  readonly router: SynthesisRouter | undefined;
  readonly budget: FleetRemoteBudget;
  readonly index?: LocalIndex;
  readonly configDir?: string;
  readonly timeoutMs?: number;
  /** Defaults to `defaultFleetDispatch`, i.e. the real `dispatchAgentsRpc`. */
  readonly dispatch?: FleetDispatch;
}

export type FleetInvoker = (job: NimbusFleetJobToml) => Promise<FleetJobOutcome>;

/**
 * The real dispatcher, adapted to `FleetDispatch`.
 *
 * A plain function rather than a cast: `dispatchAgentsRpc` returns `RpcMissOrHit`, so handing it in
 * directly — even where the types could be forced to line up — would make every production run
 * report "returned no sessionId", since the id sits under `.value`. The adapter is also where the
 * structurally-impossible `miss` becomes a loud failure: `resolveFleetAgentMethod` and
 * `dispatchByMethod` consult the SAME handler map, so a resolved method cannot miss, and the
 * alternative to throwing is waiting out the whole job timeout on a call that never started.
 */
const defaultFleetDispatch: FleetDispatch = async (method, params, ctx) => {
  const out = await dispatchAgentsRpc(method, params, ctx);
  if (out.kind === "miss") {
    throw new AgentsRpcError(-32601, `agent method not served: ${method}`);
  }
  return out.value;
};

/**
 * Notification payloads arrive as `unknown` and are read with `in` narrowing rather than a cast:
 * a `as { sessionId?: unknown }` would let a future shape change compile while reading nothing.
 */
function sessionIdOf(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || !("sessionId" in value)) return undefined;
  const id: unknown = value.sessionId;
  return typeof id === "string" && id !== "" ? id : undefined;
}

function readReady(p: unknown): { brief: string | null; findings: unknown; synthesis: unknown } {
  const isObj = p !== null && typeof p === "object";
  const brief = isObj && "brief" in p && typeof p.brief === "string" ? p.brief : null;
  const findings = isObj && "findings" in p ? p.findings : undefined;
  const synthesis = isObj && "synthesis" in p ? p.synthesis : undefined;
  return { brief, findings: findings ?? {}, synthesis: synthesis ?? null };
}

function readError(p: unknown): string {
  const isObj = p !== null && typeof p === "object";
  const err = isObj && "error" in p ? p.error : undefined;
  return typeof err === "string" && err !== "" ? err : "unknown error";
}

/**
 * Runs ONE fleet job to completion.
 *
 * `agents/_lib/emit-brief.ts` builds and synthesises on a DETACHED promise and returns
 * `{ sessionId }` immediately, so awaiting `dispatchAgentsRpc` awaits the SCHEDULING of the work,
 * not the work. A scheduler looping over that would launch every job concurrently — saturating the
 * machine it was meant to use gently, and making both the between-jobs re-probe and
 * yield-at-job-boundary unreachable. So this settles on the completion NOTIFICATION instead.
 *
 * The `notify` this passes down is the invoker's own listener and nothing else: a fleet brief is
 * not broadcast onto the socket, the same choice `agent-runs/agent-http-invoke.ts` makes for an
 * HTTP-originated run.
 */
export function buildFleetInvoker(deps: FleetInvokerDeps): FleetInvoker {
  const dispatch: FleetDispatch = deps.dispatch ?? defaultFleetDispatch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;

  return async (job) => {
    const method = resolveFleetAgentMethod(job.agent);
    if (method === null) {
      return { status: "failed", error: `agent not fleet-eligible: ${job.agent}` };
    }

    const runner = buildAgentSynthesisRunner({
      db: deps.db,
      method,
      configDir: deps.configDir,
      // I38: the router the runner sees is always the wrapped one. Wrapping HERE, at the single
      // place a fleet job's runner is built, is what makes the budget unavoidable — the runner
      // cannot be handed the raw router by a caller that forgot.
      router:
        deps.router === undefined ? undefined : wrapFleetSynthesisRouter(deps.router, deps.budget),
    });

    return await new Promise<FleetJobOutcome>((resolve) => {
      let settled = false;
      let expected: string | undefined;
      const pending: Array<{ m: string; p: unknown }> = [];

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ status: "failed", error: `job ${job.name} timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      const settle = (outcome: FleetJobOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      const consider = (m: string, p: unknown): void => {
        if (settled) return;
        // The notification can arrive BEFORE dispatch returns (a synchronous emitter), so the
        // sessionId may not be known yet. Queue until it is rather than dropping the answer.
        if (expected === undefined) {
          pending.push({ m, p });
          return;
        }
        if (sessionIdOf(p) !== expected) return;
        if (m.endsWith(".briefReady")) {
          const r = readReady(p);
          settle({
            status: "done",
            briefMarkdown: r.brief,
            findingsJson: JSON.stringify(r.findings),
            synthesisJson: r.synthesis === null ? null : JSON.stringify(r.synthesis),
          });
        } else if (m.endsWith(".briefError")) {
          settle({ status: "failed", error: readError(p) });
        }
      };

      void (async () => {
        try {
          const out = await dispatch(method, job.params, {
            db: deps.db,
            notify: consider,
            ...(deps.index === undefined ? {} : { index: deps.index }),
            ...(deps.configDir === undefined ? {} : { configDir: deps.configDir }),
            ...(runner === undefined ? {} : { runner }),
            // Server-derived on both fields: the gateway's own scheduler is calling, so this is a
            // fact, not a client's claim (D28 confines this literal to this file).
            caller: { clientId: job.name, kind: "fleet" },
          });
          expected = sessionIdOf(out);
          if (expected === undefined) {
            settle({ status: "failed", error: `agent ${job.agent} returned no sessionId` });
            return;
          }
          for (const q of pending.splice(0)) consider(q.m, q.p);
        } catch (e) {
          settle({ status: "failed", error: e instanceof Error ? e.message : String(e) });
        }
      })();
    });
  };
}
