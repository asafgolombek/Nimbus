import { create } from "zustand";
import { type ConnectionSlice, createConnectionSlice } from "./slices/connection";
import { createDashboardSlice, type DashboardSlice } from "./slices/dashboard";
import { createOnboardingSlice, type OnboardingSlice } from "./slices/onboarding";
import { createQuickQuerySlice, type QuickQuerySlice } from "./slices/quickQuery";
import { createTraySlice, type TraySlice } from "./slices/tray";

export type NimbusStore = ConnectionSlice &
  TraySlice &
  QuickQuerySlice &
  OnboardingSlice &
  DashboardSlice;

export const useNimbusStore = create<NimbusStore>()((...a) => ({
  ...createConnectionSlice(...a),
  ...createTraySlice(...a),
  ...createQuickQuerySlice(...a),
  ...createOnboardingSlice(...a),
  ...createDashboardSlice(...a),
}));
