/**
 * dispatchers-fleet.test.ts
 *
 * `tryDispatchFleetRpc` — the ONLY seam between the JSON-RPC socket and the `fleet.*` namespace.
 * It shipped with nothing past its `method.startsWith("fleet.")` guard exercised: 8 of the 9
 * executable lines it added to `dispatchers.ts` were uncovered, which is what dragged that file
 * from 85.76% to 84.96% and reded the Linux coverage floor. The number is the symptom; the gap is
 * that every fleet RPC a client can actually issue reached production through an untested function.
 *
 * Behaviour asserted, not execution: the skip sentinel is returned by IDENTITY, the not-wired case
 * is distinguished from the unknown-method case, and `FleetRpcError`'s code survives the remap to
 * `RpcMethodError` (the CLI's exit-code vocabulary reads that code, so losing it would collapse
 * "no such job" and "fleet disabled" into one answer at the socket boundary).
 *
 * Rules observed: no `any`, no `mock.module` — the ctx is built by hand and the `FleetRpcCtx` is a
 * DI seam already.
 */

import { describe, expect, test } from "bun:test";

import { DEFAULT_FLEET_CONFIG } from "../../config/fleet-toml.ts";
import type { HostActivity, HostActivityProbe } from "../../platform/host-activity.ts";
import { createMockVault } from "../../vault/mock.ts";
import { ConsentCoordinatorImpl } from "../consent.ts";
import { createStreamRegistry } from "../engine-ask-stream.ts";
import type { FleetRpcCtx } from "../fleet-rpc.ts";
import { phase4RpcSkipped, type ServerCtx } from "./context.ts";
import { tryDispatchFleetRpc } from "./dispatchers.ts";
import { RpcMethodError } from "./rpc-error.ts";

const AC_PROBE: HostActivityProbe = { power: "ac", idleMs: 1_000_000, source: "measured" };

const hostActivity: HostActivity = { probe: async () => AC_PROBE };

function makeCtx(fleetRpcCtx?: FleetRpcCtx): ServerCtx {
  return {
    options: {
      listenPath: "",
      vault: createMockVault(),
      version: "test",
      ...(fleetRpcCtx === undefined ? {} : { fleetRpcCtx }),
    },
    consentImpl: new ConsentCoordinatorImpl(() => undefined),
    startedAtMs: Date.now(),
    streamRegistry: createStreamRegistry(),
    broadcastNotification: () => {},
    getAgentInvokeHandler: () => undefined,
    getWorkflowRunHandler: () => undefined,
    getClientKind: () => "unknown",
  };
}

/** A ctx with no scheduler and no store — the shape `assembleFleetRuntime` yields when the fleet
 * is off but the process is otherwise healthy. `fleet.status` must still answer from it. */
function offButPresentCtx(): FleetRpcCtx {
  return { hostActivity, config: DEFAULT_FLEET_CONFIG, jobs: [], now: () => 1_757_200_000_000 };
}

describe("tryDispatchFleetRpc", () => {
  test("a non-fleet method never touches the fleet ctx — the prefix guard short-circuits first", async () => {
    // This test needs an OBSERVABLE, not just a return value. Asserting `phase4RpcSkipped` alone
    // cannot fail for the reason it names: `dispatchByMethod` misses on "agents.catchup" anyway,
    // so deleting the `method.startsWith("fleet.")` guard leaves the assertion green. (It did.)
    //
    // The exploding getter is the observable. `ctx.options.fleetRpcCtx` is the FIRST thing
    // `tryDispatchFleetRpc` reads after the guard, so reading it at all is exactly the behaviour
    // the guard exists to prevent — and removing the guard turns this test red with a throw.
    let reads = 0;
    const ctx = makeCtx();
    Object.defineProperty(ctx.options, "fleetRpcCtx", {
      configurable: true,
      get(): never {
        reads += 1;
        throw new Error("fleetRpcCtx must not be read for a non-fleet method");
      },
    });

    const out = await tryDispatchFleetRpc(ctx, "agents.catchup", {});

    expect(out).toBe(phase4RpcSkipped);
    // Asserted as a COUNT rather than "did not throw": a future guard that reads the ctx and then
    // discards the value would still return the sentinel, and only the count would notice.
    expect(reads).toBe(0);
  });

  test("a fleet method with NO fleet ctx wired skips rather than throwing", async () => {
    // `fleetRpcCtx` is absent only when the gateway was assembled without it. Skipping (rather
    // than throwing) is what lets the outer chain fall through to its own unknown-method error,
    // so the client sees "no such method", not a fleet-specific failure from a fleet that does
    // not exist in this process at all.
    const out = await tryDispatchFleetRpc(makeCtx(), "fleet.status", {});
    expect(out).toBe(phase4RpcSkipped);
  });

  test("fleet.status is answered from config + a live probe with no scheduler and no store", async () => {
    const out = (await tryDispatchFleetRpc(
      makeCtx(offButPresentCtx()),
      "fleet.status",
      {},
    )) as Record<string, unknown>;
    expect(out).not.toBe(phase4RpcSkipped);
    expect(out["enabled"]).toBe(false);
    // `running` is a SEPARATE fact from `enabled`: no scheduler was wired, so it must be false
    // even though the handler was reached and answered.
    expect(out["running"]).toBe(false);
    expect(out["jobsConfigured"]).toBe(0);
    expect(out["probe"]).toEqual(AC_PROBE);
  });

  test("an unknown fleet.* verb misses and is skipped, not answered", async () => {
    // The namespace prefix matches but no handler claims it. This is the `out.kind !== "hit"`
    // fall-through — without it a typo'd verb would return `undefined` as a successful result.
    const out = await tryDispatchFleetRpc(makeCtx(offButPresentCtx()), "fleet.frobnicate", {});
    expect(out).toBe(phase4RpcSkipped);
  });

  test("FleetRpcError is remapped to RpcMethodError with its code preserved", async () => {
    // -32602 is "no such job"; -32000 is "fleet not running". The CLI maps those to DIFFERENT
    // exit codes, so a remap that kept the message but flattened the code would make a mistyped
    // job name indistinguishable from a disabled fleet at every scripted caller.
    // A store MUST be present for this test to prove what it claims: `handleShow` calls
    // `requireStore` before it validates params, so an absent store would answer -32000 and the
    // assertion below would be checking the wrong refusal. (It did, on the first run.)
    const ctx = makeCtx({
      ...offButPresentCtx(),
      store: { getBrief: () => undefined } as unknown as FleetRpcCtx["store"],
    });
    // With the store present, `fleet.show` with no `id` is a real -32602 from param validation.
    await expect(tryDispatchFleetRpc(ctx, "fleet.show", {})).rejects.toThrow(RpcMethodError);
    try {
      await tryDispatchFleetRpc(ctx, "fleet.show", {});
      throw new Error("expected fleet.show with no id to reject");
    } catch (e) {
      expect(e).toBeInstanceOf(RpcMethodError);
      expect((e as RpcMethodError).rpcCode).toBe(-32602);
      expect((e as RpcMethodError).message).toContain("id");
    }
  });

  test("fleet.runNow with no scheduler rejects -32000, distinct from the -32602 above", async () => {
    const ctx = makeCtx(offButPresentCtx());
    try {
      await tryDispatchFleetRpc(ctx, "fleet.runNow", { job: "morning-catchup" });
      throw new Error("expected fleet.runNow to reject when no scheduler is wired");
    } catch (e) {
      expect(e).toBeInstanceOf(RpcMethodError);
      expect((e as RpcMethodError).rpcCode).toBe(-32000);
    }
  });

  test("a non-FleetRpcError from the handler propagates unchanged, never as an RPC code", async () => {
    // The `throw e` arm. A genuine bug (here: a store that throws) must NOT be dressed up as a
    // protocol-level error — that would report an internal fault to the client as if the request
    // were malformed, and hide it from whatever watches for unexpected throws.
    const boom = new TypeError("store exploded");
    const ctx = makeCtx({
      ...offButPresentCtx(),
      store: {
        listBriefs: () => {
          throw boom;
        },
      } as unknown as FleetRpcCtx["store"],
    });
    await expect(tryDispatchFleetRpc(ctx, "fleet.briefs", {})).rejects.toThrow(boom);
    await expect(tryDispatchFleetRpc(ctx, "fleet.briefs", {})).rejects.not.toBeInstanceOf(
      RpcMethodError,
    );
  });
});
