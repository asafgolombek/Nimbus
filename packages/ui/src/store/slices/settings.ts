import type { StateCreator } from "zustand";

export type SettingsPanelKey =
  | "model"
  | "connectors"
  | "profiles"
  | "audit"
  | "data"
  | "telemetry"
  | "updates";

export interface SettingsSlice {
  readonly activePanel: SettingsPanelKey | null;
  setActivePanel: (p: SettingsPanelKey | null) => void;
}

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
  activePanel: null,
  setActivePanel: (p) => set({ activePanel: p }),
});
