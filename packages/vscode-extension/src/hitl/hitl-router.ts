import type { HitlRequest } from "@nimbus-dev/client";

export type HitlDecision = "approve" | "reject";

export interface HitlRouterDeps {
  chatPanelVisibleAndFocused(): boolean;
  streamRegistered(streamId: string): boolean;
  showInline(req: HitlRequest): Promise<HitlDecision | undefined>;
  showToast(req: HitlRequest): Promise<HitlDecision | undefined>;
  showModal(req: HitlRequest): Promise<HitlDecision | undefined>;
  sendResponse(requestId: string, decision: HitlDecision): Promise<void>;
  onCountChange(count: number): void;
  alwaysModal(): boolean;
}

export interface HitlRouter {
  handle(req: HitlRequest): Promise<void>;
  snapshot(): HitlRequest[];
}

export function createHitlRouter(deps: HitlRouterDeps): HitlRouter {
  const pending = new Map<string, HitlRequest>();

  const emitCount = (): void => {
    deps.onCountChange(pending.size);
  };

  const handleOne = async (req: HitlRequest): Promise<void> => {
    if (pending.has(req.requestId)) return;
    pending.set(req.requestId, req);
    emitCount();
    try {
      const useInline =
        typeof req.streamId === "string" &&
        deps.streamRegistered(req.streamId) &&
        deps.chatPanelVisibleAndFocused();
      let decision: HitlDecision | undefined;
      if (useInline) {
        decision = await deps.showInline(req);
      } else if (deps.alwaysModal()) {
        decision = await deps.showModal(req);
      } else {
        decision = await deps.showToast(req);
      }
      if (decision !== undefined) {
        await deps.sendResponse(req.requestId, decision);
      }
    } finally {
      pending.delete(req.requestId);
      emitCount();
    }
  };

  return {
    handle: handleOne,
    snapshot: () => Array.from(pending.values()),
  };
}
