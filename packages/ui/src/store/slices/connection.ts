import type { StateCreator } from "zustand";
import type { ConnectionState } from "../../ipc/types";

export interface ConnectionSlice {
  readonly connectionState: ConnectionState;
  readonly lastConnectedAt: number | null;
  readonly reconnectAttempts: number;
  setConnectionState: (s: ConnectionState) => void;
}

export const createConnectionSlice: StateCreator<ConnectionSlice, [], [], ConnectionSlice> = (
  set,
) => ({
  connectionState: "initializing",
  lastConnectedAt: null,
  reconnectAttempts: 0,
  setConnectionState: (s) =>
    set((state) => {
      let reconnectAttempts: number;
      if (s === "connecting") {
        reconnectAttempts = state.reconnectAttempts + 1;
      } else if (s === "connected") {
        reconnectAttempts = 0;
      } else {
        reconnectAttempts = state.reconnectAttempts;
      }
      return {
        connectionState: s,
        lastConnectedAt: s === "connected" ? Date.now() : state.lastConnectedAt,
        reconnectAttempts,
      };
    }),
});
