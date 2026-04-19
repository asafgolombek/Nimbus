import type { StateCreator } from "zustand";
import type { HitlRequest } from "../../ipc/types";

export interface HitlSlice {
  pending: HitlRequest[];
  enqueue(r: HitlRequest): void;
  resolve(requestId: string, approved: boolean): void;
}

export const createHitlSlice: StateCreator<HitlSlice, [], [], HitlSlice> = (set) => ({
  pending: [],
  enqueue: (r) =>
    set((s) =>
      s.pending.some((x) => x.requestId === r.requestId) ? s : { pending: [...s.pending, r] },
    ),
  resolve: (requestId) =>
    set((s) => ({ pending: s.pending.filter((x) => x.requestId !== requestId) })),
});
