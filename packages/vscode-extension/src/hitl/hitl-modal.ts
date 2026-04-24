import type { HitlRequest } from "@nimbus-dev/client";

import type { WindowApi } from "../vscode-shim.js";
import type { HitlDecision } from "./hitl-router.js";

export function createModalSurface(window: WindowApi) {
  return async (req: HitlRequest): Promise<HitlDecision | undefined> => {
    const answer = await window.showInformationMessage(
      `Nimbus consent required: ${req.prompt}`,
      { modal: true },
      "Approve",
      "Reject",
    );
    if (answer === "Approve") return "approve";
    if (answer === "Reject") return "reject";
    return undefined;
  };
}
