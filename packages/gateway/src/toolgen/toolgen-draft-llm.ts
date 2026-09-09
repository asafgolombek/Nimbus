import type { ToolgenDraftingMode } from "../config/nimbus-toml.ts";
import type { LlmRouter } from "../llm/router.ts";
import type { DraftGeneration } from "./toolgen-types.ts";

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
    if (mode === "off") return null;
    const provider =
      mode === "local"
        ? await router.selectProvider("reasoning", { preferLocal: true })
        : await router.selectProvider("reasoning");
    if (provider === undefined) return null;
    if (mode === "local" && !provider.isLocal) return null;
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
