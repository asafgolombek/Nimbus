import type { ToolgenDraftingMode } from "../config/nimbus-toml.ts";
import type { LlmRouter } from "../llm/router.ts";
import type { LlmProvider } from "../llm/types.ts";
import type { DraftGeneration } from "./toolgen-types.ts";

/**
 * The ONE place `[tool_generation] drafting` is turned into "which provider, if any".
 *
 * Both consumers below go through it — the generator that actually drafts, and the route PROBE
 * `draftGeneratedTool` calls BEFORE it grounds. Two independent copies of this decision is exactly
 * the shape that drifts: the probe would say "a model is available" while the generator refused the
 * same provider on locality, and the owner's description would have reached the index — and, when
 * `[embedding]` is remote, the embedding vendor — for a draft that was never going to happen.
 *
 * `null` rather than `undefined` for "nothing eligible", so a mode refusal and an empty route table
 * are one answer at the call site; neither ever falls through to a provider.
 */
async function resolveDraftProvider(
  router: Pick<LlmRouter, "selectProvider">,
  mode: ToolgenDraftingMode,
): Promise<LlmProvider | null> {
  if (mode === "off") return null;
  const provider =
    mode === "local"
      ? await router.selectProvider("reasoning", { preferLocal: true })
      : await router.selectProvider("reasoning");
  if (provider === undefined) return null;
  if (mode === "local" && !provider.isLocal) return null;
  return provider;
}

/**
 * Whether a drafting route exists AT ALL, asked without generating anything.
 *
 * `draftGeneratedTool` calls this before `findEndpoints`, so `drafting = "off"` (and a machine with
 * no eligible provider) refuses BEFORE the grounding search — whose query embedding is a real
 * outbound request when `[embedding]` is configured against a remote vendor. Refusal-before-egress,
 * mirroring the gate's own refusal-before-consent ordering.
 *
 * It resolves the provider a SECOND time rather than handing the resolved one to the drafter. That
 * is deliberate: the drafter's own `null` return is what produces the two-part
 * `ERR_TOOLGEN_NO_DRAFT_MODEL` message when the REDRAFT cannot reach a model, and caching a
 * provider from before the (possibly slow) grounding search would report a route that has since
 * gone away. `selectProvider` is a route-table walk plus a cached availability probe, not a model
 * call, and it appends no egress row.
 */
export function createToolgenDraftRouteProbe(
  router: Pick<LlmRouter, "selectProvider">,
  mode: ToolgenDraftingMode,
): () => Promise<boolean> {
  return async () => (await resolveDraftProvider(router, mode)) !== null;
}

/**
 * The narrowed router view the drafter receives.
 *
 * Narrowed rather than handed the router because `setTaskPin` is router-WIDE — I38 rejected it for
 * exactly this reason, since a background caller must not re-route a concurrent `nimbus ask`.
 *
 * Locality is enforced HERE and derived from `provider.isLocal` (I34), never from a vendor id. A
 * remote provider under `drafting = "local"` is REFUSED, not silently used: the same fail-closed
 * posture as `enforce_air_gap`.
 *
 * `drafting = "allow-remote"` WIDENS what may happen and never REDIRECTS it: it asks
 * `selectProvider` with no `preferLocal` override at all, so the router falls back to the owner's
 * own configured `[llm] prefer_local` preference (`llm/router.ts`'s `selectRoute`/`selectProvider`
 * doc: an omitted `preferLocal` "defaults to `config.preferLocal`"). Passing `preferLocal: false`
 * here would be wrong: `byPreference` (`llm/router.ts:84-87`) orders remote candidates AHEAD of
 * local ones on `false`, which would send an owner's description and indexed endpoint paths to a
 * vendor even with `[llm] prefer_local = true` and a perfectly capable local model registered —
 * exactly the silent override a `allow-remote` GRANT must not cause. This mirrors the fleet's
 * `[fleet] allow_remote` (I38), which also only permits, never redirects.
 *
 * Asks for the `"reasoning"` task, which is what makes `minReasoningParams` apply and what puts
 * the call under the existing `model` egress class via `wrapLedgeredProvider` — no new coverage
 * class, and no cooperation required from this file.
 */
export function createToolgenDraftLlm(
  router: Pick<LlmRouter, "selectProvider">,
  mode: ToolgenDraftingMode,
): (prompt: string) => Promise<DraftGeneration | null> {
  return async (prompt) => {
    const provider = await resolveDraftProvider(router, mode);
    if (provider === null) return null;
    const result = await provider.generate({
      task: "reasoning",
      prompt,
      temperature: 0,
      egressMethod: "toolgen.draft",
    });
    // `isLocal` travels WITH the text so the caller records what actually answered, not what the
    // config permitted: `allow-remote` with a local provider registered still drafts locally.
    return { text: result.text, isLocal: provider.isLocal };
  };
}
