import type { StateCreator } from "zustand";
import type { ProfileListResult, ProfileSummary } from "../../ipc/types";

export interface ProfileSlice {
  readonly active: string | null;
  readonly profiles: ReadonlyArray<ProfileSummary>;
  readonly lastFetchAt: number | null;
  readonly actionInFlight: boolean;
  setProfileList: (r: ProfileListResult) => void;
  setActiveProfileOptimistic: (name: string) => void;
  setProfileActionInFlight: (v: boolean) => void;
}

export const createProfileSlice: StateCreator<ProfileSlice, [], [], ProfileSlice> = (set) => ({
  active: null,
  profiles: [],
  lastFetchAt: null,
  actionInFlight: false,
  setProfileList: (r) =>
    set({
      profiles: r.profiles,
      active: r.active,
      lastFetchAt: Date.now(),
    }),
  setActiveProfileOptimistic: (name) => set({ active: name }),
  setProfileActionInFlight: (v) => set({ actionInFlight: v }),
});
