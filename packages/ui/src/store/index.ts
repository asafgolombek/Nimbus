import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { persistPartialize } from "./partialize";
import { type AuditSlice, createAuditSlice } from "./slices/audit";
import { type ConnectionSlice, createConnectionSlice } from "./slices/connection";
import { type ConnectorsSlice, createConnectorsSlice } from "./slices/connectors";
import { createDashboardSlice, type DashboardSlice } from "./slices/dashboard";
import { createHitlSlice, type HitlSlice } from "./slices/hitl";
import { createModelSlice, type ModelSlice } from "./slices/model";
import { createOnboardingSlice, type OnboardingSlice } from "./slices/onboarding";
import { createProfileSlice, type ProfileSlice } from "./slices/profile";
import { createQuickQuerySlice, type QuickQuerySlice } from "./slices/quickQuery";
import { createSettingsSlice, type SettingsSlice } from "./slices/settings";
import { createTelemetrySlice, type TelemetrySlice } from "./slices/telemetry";
import { createTraySlice, type TraySlice } from "./slices/tray";

export type NimbusStore = ConnectionSlice &
  TraySlice &
  QuickQuerySlice &
  OnboardingSlice &
  DashboardSlice &
  HitlSlice &
  SettingsSlice &
  ProfileSlice &
  TelemetrySlice &
  ConnectorsSlice &
  ModelSlice &
  AuditSlice;

export const useNimbusStore = create<NimbusStore>()(
  persist(
    (...a) => ({
      ...createConnectionSlice(...a),
      ...createTraySlice(...a),
      ...createQuickQuerySlice(...a),
      ...createOnboardingSlice(...a),
      ...createDashboardSlice(...a),
      ...createHitlSlice(...a),
      ...createSettingsSlice(...a),
      ...createProfileSlice(...a),
      ...createTelemetrySlice(...a),
      ...createConnectorsSlice(...a),
      ...createModelSlice(...a),
      ...createAuditSlice(...a),
    }),
    {
      name: "nimbus-ui-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => persistPartialize(state as unknown as Record<string, unknown>),
    },
  ),
);
