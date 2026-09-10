import { describe, expect, test } from "bun:test";
import { createToolgenDraftLlm, createToolgenDraftRouteProbe } from "./toolgen-draft-llm.ts";

function router(provider: { isLocal: boolean } | undefined) {
  const calls: unknown[] = [];
  return {
    calls,
    selectProvider: async (task: string) => {
      calls.push(task);
      return provider === undefined
        ? undefined
        : { ...provider, generate: async () => ({ text: "drafted" }) };
    },
  };
}

// Captures the FULL argument list `selectProvider` received (task + the raw options object, or
// `undefined` when no second argument was passed at all) — `router()` above only records the task,
// which cannot distinguish "no options" from "{ preferLocal: false }" and is exactly the shape that
// let the original `allow-remote` bug (forcing remote-first via an explicit `false`) pass unnoticed.
function routerCapturingArgs(provider: { isLocal: boolean } | undefined) {
  const calls: Array<[string, { preferLocal?: boolean } | undefined]> = [];
  return {
    calls,
    selectProvider: async (task: string, opts?: { preferLocal?: boolean }) => {
      calls.push([task, opts]);
      return provider === undefined
        ? undefined
        : { ...provider, generate: async () => ({ text: "drafted" }) };
    },
  };
}

// A router fake that actually HONOURS `preferLocal` the way `LlmRouter.selectRoute`/`byPreference`
// do (`llm/router.ts:84-87`): an explicit `preferLocal` overrides; an OMITTED one falls back to the
// router's own configured preference (`defaultPreferLocal`, standing in for `config.preferLocal`).
// This is the test that would have caught the original defect: if the adapter passed
// `{ preferLocal: false }` for `allow-remote`, it would override this fake's local-preferring
// config and select the remote provider instead.
function preferenceHonouringRouter(
  defaultPreferLocal: boolean,
  local: { isLocal: true },
  remote: { isLocal: false },
) {
  const calls: Array<[string, { preferLocal?: boolean } | undefined]> = [];
  return {
    calls,
    selectProvider: async (task: string, opts?: { preferLocal?: boolean }) => {
      calls.push([task, opts]);
      const preferLocal = opts?.preferLocal ?? defaultPreferLocal;
      const chosen = preferLocal ? local : remote;
      return { ...chosen, generate: async () => ({ text: "drafted" }) };
    },
  };
}

describe("createToolgenDraftLlm", () => {
  test('mode "off" never asks the router at all', async () => {
    const r = router({ isLocal: true });
    expect(await createToolgenDraftLlm(r as never, "off")("p")).toBeNull();
    expect(r.calls).toEqual([]);
  });

  test('mode "local" uses a local provider and reports isLocal', async () => {
    expect(await createToolgenDraftLlm(router({ isLocal: true }) as never, "local")("p")).toEqual({
      text: "drafted",
      isLocal: true,
    });
  });

  test('mode "local" REFUSES a remote provider rather than using it — and never calls generate', async () => {
    // `toBeNull()` alone proved only that nothing was RETURNED. The half that matters is that
    // nothing was SENT: a refusal that still calls `generate` has already put the owner's tool
    // description and indexed endpoint paths in a vendor's context, and would ledger a `model`-class
    // row for a draft the config forbade. Counting the calls is what pins that.
    let generates = 0;
    const remote = {
      calls: [] as unknown[],
      selectProvider: async (task: string) => {
        remote.calls.push(task);
        return {
          isLocal: false,
          generate: async () => {
            generates += 1;
            return { text: "drafted" };
          },
        };
      },
    };
    expect(await createToolgenDraftLlm(remote as never, "local")("p")).toBeNull();
    expect(generates).toBe(0);
  });

  test('mode "allow-remote" uses a remote provider and reports isLocal false', async () => {
    expect(
      await createToolgenDraftLlm(router({ isLocal: false }) as never, "allow-remote")("p"),
    ).toEqual({ text: "drafted", isLocal: false });
  });

  test("no provider at all yields null", async () => {
    expect(await createToolgenDraftLlm(router(undefined) as never, "local")("p")).toBeNull();
  });

  test('asks for the "reasoning" task so the capability floor applies', async () => {
    const r = router({ isLocal: true });
    await createToolgenDraftLlm(r as never, "local")("p");
    expect(r.calls).toEqual(["reasoning"]);
  });

  test('mode "allow-remote" passes NO preferLocal override — it defers to the owner\'s configured preference, it does not force remote-first', async () => {
    const r = routerCapturingArgs({ isLocal: false });
    await createToolgenDraftLlm(r as never, "allow-remote")("p");
    expect(r.calls).toEqual([["reasoning", undefined]]);
  });

  test('mode "local" passes { preferLocal: true } explicitly', async () => {
    const r = routerCapturingArgs({ isLocal: true });
    await createToolgenDraftLlm(r as never, "local")("p");
    expect(r.calls).toEqual([["reasoning", { preferLocal: true }]]);
  });

  test('mode "allow-remote" with a router configured to prefer local picks the LOCAL provider — the regression test for forcing remote-first', async () => {
    const r = preferenceHonouringRouter(true, { isLocal: true }, { isLocal: false });
    const result = await createToolgenDraftLlm(r as never, "allow-remote")("p");
    expect(result).toEqual({ text: "drafted", isLocal: true });
  });
});

describe("createToolgenDraftRouteProbe", () => {
  // The probe is what lets `draftGeneratedTool` refuse BEFORE it grounds — and grounding embeds the
  // owner's description, which is a real outbound request on a remote-embedder install. It shares
  // `resolveDraftProvider` with `createToolgenDraftLlm`, so these assert the same three answers the
  // generator gives, from the other side of that shared decision.
  test('"off" answers false without asking the router at all', async () => {
    const r = router({ isLocal: true });
    expect(await createToolgenDraftRouteProbe(r as never, "off")()).toBe(false);
    expect(r.calls).toEqual([]);
  });

  test("no provider at all answers false", async () => {
    expect(await createToolgenDraftRouteProbe(router(undefined) as never, "local")()).toBe(false);
  });

  test('"local" answers FALSE for a remote provider — matching what the generator would refuse', async () => {
    expect(await createToolgenDraftRouteProbe(router({ isLocal: false }) as never, "local")()).toBe(
      false,
    );
  });

  test('"allow-remote" answers true for a remote provider', async () => {
    expect(
      await createToolgenDraftRouteProbe(router({ isLocal: false }) as never, "allow-remote")(),
    ).toBe(true);
  });

  test("a local provider answers true in both non-off modes", async () => {
    expect(await createToolgenDraftRouteProbe(router({ isLocal: true }) as never, "local")()).toBe(
      true,
    );
    expect(
      await createToolgenDraftRouteProbe(router({ isLocal: true }) as never, "allow-remote")(),
    ).toBe(true);
  });

  test("it never GENERATES — asking whether a route exists must not send a prompt", async () => {
    let generates = 0;
    const r = {
      selectProvider: async () => ({
        isLocal: true,
        generate: async () => {
          generates += 1;
          return { text: "drafted" };
        },
      }),
    };
    expect(await createToolgenDraftRouteProbe(r as never, "local")()).toBe(true);
    expect(generates).toBe(0);
  });
});
