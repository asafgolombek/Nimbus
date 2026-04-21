import type { StateCreator } from "zustand";

export interface PersistedModelRow {
  readonly id: string;
  readonly provider: "ollama" | "llamacpp";
}

export interface ModelSlice {
  readonly installedModels: ReadonlyArray<PersistedModelRow>;
  readonly activePullId: string | null;
  setInstalledModels: (list: ReadonlyArray<PersistedModelRow>) => void;
  setActivePullId: (id: string | null) => void;
}

export const createModelSlice: StateCreator<ModelSlice, [], [], ModelSlice> = (set) => ({
  installedModels: [],
  activePullId: null,
  setInstalledModels: (list) => set({ installedModels: list }),
  setActivePullId: (id) => set({ activePullId: id }),
});
