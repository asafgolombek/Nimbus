import type { StateCreator } from "zustand";

export interface QuickQuerySlice {
  readonly streamId: string | null;
  readonly tokens: readonly string[];
  readonly modelLabel: string | null;
  readonly doneAt: number | null;
  startStream: (streamId: string) => void;
  appendToken: (streamId: string, token: string) => void;
  markDone: (streamId: string, modelLabel: string) => void;
  reset: () => void;
}

export const createQuickQuerySlice: StateCreator<QuickQuerySlice, [], [], QuickQuerySlice> = (
  set,
) => ({
  streamId: null,
  tokens: [],
  modelLabel: null,
  doneAt: null,
  startStream: (streamId) => set({ streamId, tokens: [], modelLabel: null, doneAt: null }),
  appendToken: (streamId, token) =>
    set((state) => (state.streamId === streamId ? { tokens: [...state.tokens, token] } : {})),
  markDone: (streamId, modelLabel) =>
    set((state) => (state.streamId === streamId ? { modelLabel, doneAt: Date.now() } : {})),
  reset: () => set({ streamId: null, tokens: [], modelLabel: null, doneAt: null }),
});
