import type { StateCreator } from "zustand";
import type {
  UpdaterCheckResult,
  UpdaterDownloadProgressPayload,
  UpdaterRestartingPayload,
  UpdaterRolledBackPayload,
  UpdaterStatus,
  UpdaterVerifyFailedPayload,
} from "../../ipc/types";

/**
 * Local UI-side state machine. A superset of the Gateway's `UpdaterStateName`
 * because the UI layers four extra states on top:
 *
 *   - `available` — `checkNow` returned `updateAvailable: true`; user has not clicked Apply yet.
 *   - `restarting` — `updater.restarting` notification fired; overlay is visible; socket may or may not have closed.
 *   - `reconnecting` — socket has dropped during apply; waiting for reconnect + version check.
 *   - `success` — post-reconnect `diag.getVersion` matched `toVersion`.
 *
 * The Gateway-level states (`idle`, `checking`, `downloading`, `verifying`, `applying`, `rolled_back`, `failed`)
 * are included verbatim so we can mirror `updater.getStatus` directly.
 */
export type UpdaterUiState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying"
  | "applying"
  | "restarting"
  | "reconnecting"
  | "success"
  | "rolled_back"
  | "failed";

/** Union of all failure shapes the UI can observe — Gateway-emitted plus the UI-synthesised reconnect timeout. */
export type UpdaterFailure =
  | UpdaterRolledBackPayload
  | UpdaterVerifyFailedPayload
  | { reason: "reconnect_timeout" };

export interface UpdaterSlice {
  /** Mirrors `updater.getStatus`; null until first fetch resolves. Transient. */
  readonly updaterStatus: UpdaterStatus | null;
  /** UI-side state — drives panel render and overlay visibility. Transient. */
  readonly updaterUiState: UpdaterUiState;
  /** Latest `checkNow` result; null until the user has run a check. Transient. */
  readonly updaterCheck: UpdaterCheckResult | null;
  /** Latest `updater.downloadProgress` payload. Transient. */
  readonly updaterDownload: UpdaterDownloadProgressPayload | null;
  /** Set when `updater.restarting` fires — drives overlay copy. Transient. */
  readonly updaterRestarting: UpdaterRestartingPayload | null;
  /** Set when `updater.rolledBack` or `updater.verifyFailed` fires. Transient. */
  readonly updaterFailure: UpdaterFailure | null;
  setUpdaterStatus: (status: UpdaterStatus | null) => void;
  setUpdaterUiState: (state: UpdaterUiState) => void;
  setUpdaterCheck: (check: UpdaterCheckResult | null) => void;
  setUpdaterDownload: (progress: UpdaterDownloadProgressPayload | null) => void;
  setUpdaterRestarting: (payload: UpdaterRestartingPayload | null) => void;
  setUpdaterFailure: (failure: UpdaterFailure | null) => void;
  resetUpdaterTransients: () => void;
}

export const createUpdaterSlice: StateCreator<UpdaterSlice, [], [], UpdaterSlice> = (set) => ({
  updaterStatus: null,
  updaterUiState: "idle",
  updaterCheck: null,
  updaterDownload: null,
  updaterRestarting: null,
  updaterFailure: null,
  setUpdaterStatus: (status) => set({ updaterStatus: status }),
  setUpdaterUiState: (state) => set({ updaterUiState: state }),
  setUpdaterCheck: (check) => set({ updaterCheck: check }),
  setUpdaterDownload: (progress) => set({ updaterDownload: progress }),
  setUpdaterRestarting: (payload) => set({ updaterRestarting: payload }),
  setUpdaterFailure: (failure) => set({ updaterFailure: failure }),
  resetUpdaterTransients: () =>
    set({
      updaterUiState: "idle",
      updaterCheck: null,
      updaterDownload: null,
      updaterRestarting: null,
      updaterFailure: null,
    }),
});
