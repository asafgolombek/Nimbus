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
    const provider = await router.selectProvider("reasoning", {
      preferLocal: mode === "local",
    });
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
