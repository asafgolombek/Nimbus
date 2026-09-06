import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SynthesisRouter } from "../agents/_lib/synthesis-llm.ts";
import type { NimbusFleetJobToml } from "../config/fleet-toml.ts";
import { LocalIndex } from "../index/local-index.ts";
import {
  buildFleetInvoker,
  DEFAULT_JOB_TIMEOUT_MS,
  type FleetInvokerDeps,
} from "./fleet-invoker.ts";
import { createFleetRemoteBudget } from "./fleet-synthesis-router.ts";

/**
 * Deliberately WIDER than `FleetDispatch`: a test double should not have to name the production
 * context type to stand in for it. That it is assignable at all is itself part of what this file
 * checks — the seam typechecks with no assertion on either side.
 */
type FleetInvokerTestDispatch = (
  method: string,
  params: unknown,
  ctx: { notify: (m: string, p: unknown) => void; caller?: { clientId: string; kind: string } },
) => Promise<unknown>;

function deps(dispatch: FleetInvokerTestDispatch): FleetInvokerDeps {
  return {
    db: new Database(":memory:"),
    router: undefined,
    budget: createFleetRemoteBudget(false, 0),
    timeoutMs: 50,
    dispatch,
  };
}

const JOB: NimbusFleetJobToml = { name: "j", agent: "catchup", intervalSeconds: 1, params: {} };

describe("buildFleetInvoker", () => {
  test("resolves only after briefReady, not when dispatch returns", async () => {
    const order: string[] = [];
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        order.push("dispatch-returned");
        setTimeout(() => {
          order.push("brief-notified");
          ctx.notify("catchup.briefReady", {
            sessionId: "s1",
            brief: "# hi",
            findings: { a: 1 },
            synthesis: null,
          });
        }, 5);
        return { sessionId: "s1" };
      }),
    );
    const out = await invoke(JOB);
    order.push("invoke-resolved");
    // The whole point: dispatch returning is NOT the job finishing.
    // `order` alone must be able to go red: a bare `await dispatch(...)` implementation resolves
    // BEFORE the notification is emitted, so it produces ["dispatch-returned", "invoke-resolved"]
    // and the middle element is missing. Without the emission recorded here, both implementations
    // append in the same order and the assertion proves nothing.
    expect(order).toEqual(["dispatch-returned", "brief-notified", "invoke-resolved"]);
    expect(out).toEqual({
      status: "done",
      briefMarkdown: "# hi",
      findingsJson: JSON.stringify({ a: 1 }),
      synthesisJson: null,
    });
  });

  test("a notification that arrives BEFORE dispatch returns is replayed, not dropped", async () => {
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        // Synchronous emitter: the sessionId is not known to the invoker yet.
        ctx.notify("catchup.briefReady", {
          sessionId: "s1",
          brief: "early",
          findings: { ok: true },
          synthesis: { provider: "local" },
        });
        return { sessionId: "s1" };
      }),
    );
    expect(await invoke(JOB)).toEqual({
      status: "done",
      briefMarkdown: "early",
      findingsJson: JSON.stringify({ ok: true }),
      synthesisJson: JSON.stringify({ provider: "local" }),
    });
  });

  test("briefError settles as failed", async () => {
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        ctx.notify("catchup.briefError", { sessionId: "s1", error: "boom" });
        return { sessionId: "s1" };
      }),
    );
    expect(await invoke(JOB)).toEqual({ status: "failed", error: "boom" });
  });

  test("a briefError with no readable message still settles", async () => {
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        ctx.notify("catchup.briefError", { sessionId: "s1" });
        return { sessionId: "s1" };
      }),
    );
    expect(await invoke(JOB)).toEqual({ status: "failed", error: "unknown error" });
  });

  test("a brief that never arrives times out rather than wedging the fleet", async () => {
    const invoke = buildFleetInvoker(deps(async () => ({ sessionId: "s1" })));
    const out = await invoke(JOB);
    expect(out.status).toBe("failed");
    expect("error" in out && out.error).toMatch(/timed out/);
  });

  test("a notification for a DIFFERENT sessionId is ignored", async () => {
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        ctx.notify("catchup.briefReady", { sessionId: "other", brief: "x", findings: {} });
        return { sessionId: "s1" };
      }),
    );
    expect((await invoke(JOB)).status).toBe("failed"); // times out; the stray notify did not settle it
  });

  test("an unrelated notification method for the right session is ignored", async () => {
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        ctx.notify("catchup.progress", { sessionId: "s1" });
        return { sessionId: "s1" };
      }),
    );
    expect((await invoke(JOB)).status).toBe("failed"); // times out
  });

  test("an ineligible agent is refused before any dispatch", async () => {
    let dispatched = false;
    const invoke = buildFleetInvoker(
      deps(async () => {
        dispatched = true;
        return { sessionId: "s" };
      }),
    );
    const out = await invoke({ ...JOB, agent: "premortem" });
    expect(out).toEqual({ status: "failed", error: "agent not fleet-eligible: premortem" });
    expect(dispatched).toBe(false);
  });

  test("an unknown agent name is refused too", async () => {
    const invoke = buildFleetInvoker(deps(async () => ({ sessionId: "s" })));
    expect(await invoke({ ...JOB, agent: "constructor" })).toEqual({
      status: "failed",
      error: "agent not fleet-eligible: constructor",
    });
  });

  test("the caller kind is fleet and the clientId is the job name", async () => {
    let seen: { clientId: string; kind: string } | undefined;
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        seen = ctx.caller;
        ctx.notify("catchup.briefReady", { sessionId: "s1", brief: "x", findings: {} });
        return { sessionId: "s1" };
      }),
    );
    await invoke(JOB);
    expect(seen).toEqual({ clientId: "j", kind: "fleet" });
  });

  test("the resolved method and the job params reach dispatch verbatim", async () => {
    let seenMethod: string | undefined;
    let seenParams: unknown;
    const invoke = buildFleetInvoker(
      deps(async (m, p, ctx) => {
        seenMethod = m;
        seenParams = p;
        ctx.notify("catchup.briefReady", { sessionId: "s1", brief: "x", findings: {} });
        return { sessionId: "s1" };
      }),
    );
    await invoke({ ...JOB, params: { sinceMs: 3600000 } });
    expect(seenMethod).toBe("agents.catchup");
    expect(seenParams).toEqual({ sinceMs: 3600000 });
  });

  test("a dispatch that returns no sessionId fails rather than waiting for a notification", async () => {
    const started = Date.now();
    const invoke = buildFleetInvoker(deps(async () => ({})));
    expect(await invoke(JOB)).toEqual({
      status: "failed",
      error: "agent catchup returned no sessionId",
    });
    // Settled on the return, not on the 50ms timeout.
    expect(Date.now() - started).toBeLessThan(50);
  });

  test("a thrown dispatch settles as failed with the error message", async () => {
    const invoke = buildFleetInvoker(
      deps(async () => {
        throw new Error("index locked");
      }),
    );
    expect(await invoke(JOB)).toEqual({ status: "failed", error: "index locked" });
  });

  test("a non-Error throw is stringified rather than lost", async () => {
    const invoke = buildFleetInvoker(
      deps(async () => {
        // A connector or agent can reject with a non-Error; the outcome must still carry a message.
        throw "nope";
      }),
    );
    expect(await invoke(JOB)).toEqual({ status: "failed", error: "nope" });
  });

  test("a briefReady with no markdown records a null body rather than failing", async () => {
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        ctx.notify("catchup.briefReady", { sessionId: "s1" });
        return { sessionId: "s1" };
      }),
    );
    expect(await invoke(JOB)).toEqual({
      status: "done",
      briefMarkdown: null,
      findingsJson: "{}",
      synthesisJson: null,
    });
  });

  test("a second notification after the outcome is settled changes nothing", async () => {
    let notifyAgain: (() => void) | undefined;
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        ctx.notify("catchup.briefReady", { sessionId: "s1", brief: "first", findings: {} });
        notifyAgain = () => {
          ctx.notify("catchup.briefError", { sessionId: "s1", error: "late" });
        };
        return { sessionId: "s1" };
      }),
    );
    const out = await invoke(JOB);
    notifyAgain?.();
    expect(out).toEqual({
      status: "done",
      briefMarkdown: "first",
      findingsJson: "{}",
      synthesisJson: null,
    });
  });

  test("index, configDir and a router are all threaded through, and the router is wrapped", async () => {
    const db = new Database(":memory:");
    let sawRunner = false;
    let resolveCalls = 0;
    // I38: whatever the invoker builds the runner with must be the WRAPPED router. A wrapped
    // router with an exhausted budget withholds a remote provider; the raw one would not.
    const router: SynthesisRouter = {
      resolveForSynthesis: async (_preferLocal?: boolean) => {
        resolveCalls += 1;
        return { isLocal: false, providerId: "anthropic", modelName: "m" };
      },
      generateMarkdown: async () => "unused",
    };
    const invoke = buildFleetInvoker({
      db,
      router,
      budget: createFleetRemoteBudget(false, 0),
      index: new LocalIndex(db),
      configDir: mkdtempSync(join(tmpdir(), "nimbus-fleet-invoker-")),
      // No timeoutMs: the DEFAULT applies, and the job still settles on the notification.
      dispatch: async (_m, _p, ctx) => {
        sawRunner = ctx.runner !== undefined;
        if (ctx.runner?.run !== undefined) {
          // Reaching the router THROUGH the runner is what proves the wrap is on the live path.
          await ctx.runner.run("summarise this brief");
        }
        ctx.notify("catchup.briefReady", { sessionId: "s1", brief: "x", findings: {} });
        return { sessionId: "s1" };
      },
    });
    expect((await invoke(JOB)).status).toBe("done");
    expect(sawRunner).toBe(true);
    expect(resolveCalls).toBeGreaterThan(0);
  });

  test("the default timeout is bounded but generous", () => {
    expect(DEFAULT_JOB_TIMEOUT_MS).toBe(600_000);
  });
});
