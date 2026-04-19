import type { StateCreator } from "zustand";

export type TrayIconState = "normal" | "amber" | "red";

export interface TraySlice {
  readonly trayIcon: TrayIconState;
  readonly hitlBadgeCount: number;
  setTrayIcon: (icon: TrayIconState) => void;
  setHitlBadgeCount: (n: number) => void;
}

export const createTraySlice: StateCreator<TraySlice, [], [], TraySlice> = (set) => ({
  trayIcon: "normal",
  hitlBadgeCount: 0,
  setTrayIcon: (trayIcon) => set({ trayIcon }),
  setHitlBadgeCount: (hitlBadgeCount) => set({ hitlBadgeCount: Math.max(0, hitlBadgeCount) }),
});
