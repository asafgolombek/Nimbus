import type { ReactNode } from "react";
import type { UpdaterRestartingPayload } from "../../../ipc/types";
import type { UpdaterUiState } from "../../../store/slices/updater";

interface Props {
  readonly state: UpdaterUiState;
  readonly restarting: UpdaterRestartingPayload | null;
  readonly elapsedSec: number;
}

export function RestartOverlay({ state, restarting, elapsedSec }: Props): ReactNode | null {
  if (state !== "restarting" && state !== "reconnecting") {
    return null;
  }

  const heading = state === "restarting" ? "Restarting Nimbus…" : "Reconnecting to Gateway…";
  const subline =
    restarting !== null
      ? `Updating from ${restarting.fromVersion} → ${restarting.toVersion}.`
      : "Apply in progress.";
  const hint =
    state === "reconnecting" ? `Up to 2 minutes — elapsed ${elapsedSec}s.` : "Up to 30 seconds.";

  return (
    <div
      role="alert"
      data-testid="restart-overlay"
      className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center text-white px-6 text-center"
    >
      <h2 className="text-xl font-semibold">{heading}</h2>
      <p className="mt-2 text-sm">{subline}</p>
      <p className="mt-1 text-xs text-white/70">{hint}</p>
      <div className="mt-6 h-1 w-48 bg-white/20 rounded overflow-hidden">
        <div className="h-full w-1/3 bg-white animate-pulse" />
      </div>
    </div>
  );
}
