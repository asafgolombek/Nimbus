import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { createIpcClient } from "../../ipc/client";
import { useNimbusStore } from "../../store";

export function UpdatesPanel() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const status = useNimbusStore((s) => s.updaterStatus);
  const uiState = useNimbusStore((s) => s.updaterUiState);
  const check = useNimbusStore((s) => s.updaterCheck);
  const download = useNimbusStore((s) => s.updaterDownload);
  const failure = useNimbusStore((s) => s.updaterFailure);
  const setStatus = useNimbusStore((s) => s.setUpdaterStatus);
  const setUiState = useNimbusStore((s) => s.setUpdaterUiState);
  const setCheck = useNimbusStore((s) => s.setUpdaterCheck);
  const setFailure = useNimbusStore((s) => s.setUpdaterFailure);
  const resetTransients = useNimbusStore((s) => s.resetUpdaterTransients);

  const offline = connectionState === "disconnected";
  const writeDisabled =
    offline ||
    uiState === "checking" ||
    uiState === "downloading" ||
    uiState === "verifying" ||
    uiState === "applying" ||
    uiState === "restarting" ||
    uiState === "reconnecting";

  const [fetchError, setFetchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await createIpcClient().updaterGetStatus();
      setStatus(next);
      setFetchError(null);
    } catch (e) {
      setFetchError((e as Error).message);
    }
  }, [setStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // No subscriptions, no timer here — `UpdaterRestartChrome` (mounted in RootLayout)
  // owns all of that. This panel only reads from the slice and exposes user actions.

  const onCheckNow = useCallback(async () => {
    setUiState("checking");
    try {
      const result = await createIpcClient().updaterCheckNow();
      setCheck(result);
      setUiState(result.updateAvailable ? "available" : "idle");
    } catch (e) {
      setFetchError((e as Error).message);
      setUiState("idle");
    }
  }, [setCheck, setUiState]);

  const onApply = useCallback(async () => {
    setUiState("applying");
    setFailure(null);
    try {
      await invoke("updater_apply_started");
      await createIpcClient().updaterApplyUpdate();
      // From here, state advances via notifications:
      //   applying → restarting (notification) → reconnecting (Rust event) → success / rolled_back.
    } catch (e) {
      setFetchError((e as Error).message);
      setUiState("failed");
      void invoke("updater_apply_finished").catch(() => undefined);
    }
  }, [setFailure, setUiState]);

  const onRollback = useCallback(async () => {
    setUiState("checking");
    try {
      await createIpcClient().updaterRollback();
      resetTransients();
      await refresh();
    } catch (e) {
      setFetchError((e as Error).message);
      setUiState("failed");
    }
  }, [refresh, resetTransients, setUiState]);

  const downloadPct =
    download?.totalBytes !== undefined && download.totalBytes > 0
      ? Math.min(100, Math.floor((download.receivedBytes / download.totalBytes) * 100))
      : null;

  return (
    <section className="p-6 space-y-6 relative">
      <PanelHeader
        title="Updates"
        description="Local-first updater. Manifest is fetched on demand; binaries are Ed25519-verified before install. Roll back if a previous install failed."
        livePill={offline ? <StaleChip /> : undefined}
      />

      {fetchError !== null && (
        <PanelError message={`Updater error: ${fetchError}`} onRetry={() => void refresh()} />
      )}

      {status !== null && (
        <div className="text-sm space-y-1">
          <div>
            <span className="text-[var(--color-text-muted)]">Current version:</span>{" "}
            <span className="font-mono">{status.currentVersion}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Manifest URL:</span>{" "}
            <span className="font-mono text-xs">{status.configUrl}</span>
          </div>
          {status.lastCheckAt !== undefined && (
            <div>
              <span className="text-[var(--color-text-muted)]">Last checked:</span>{" "}
              {new Date(status.lastCheckAt).toLocaleString()}
            </div>
          )}
          {status.lastError !== undefined && (
            <div className="text-red-500 text-xs">Last error: {status.lastError}</div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onCheckNow()}
          disabled={writeDisabled}
          className="px-3 py-1.5 text-sm rounded bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          {uiState === "checking" ? "Checking…" : "Check now"}
        </button>
        {check?.updateAvailable && uiState === "available" && (
          <button
            type="button"
            onClick={() => void onApply()}
            disabled={writeDisabled}
            className="px-3 py-1.5 text-sm rounded border border-[var(--color-accent)] text-[var(--color-accent)] disabled:opacity-50"
          >
            Apply {check.latestVersion}
          </button>
        )}
        {(uiState === "rolled_back" ||
          uiState === "failed" ||
          status?.state === "rolled_back" ||
          status?.state === "failed") && (
          <button
            type="button"
            onClick={() => void onRollback()}
            disabled={writeDisabled}
            className="px-3 py-1.5 text-sm rounded border border-[var(--color-border)] disabled:opacity-50"
          >
            Rollback
          </button>
        )}
      </div>

      {check?.updateAvailable && (
        <div className="rounded border border-[var(--color-border)] p-3 text-sm">
          <div className="font-medium">New version available: {check.latestVersion}</div>
          {check.notes !== undefined && (
            <pre className="mt-2 whitespace-pre-wrap text-xs text-[var(--color-text-muted)]">
              {check.notes}
            </pre>
          )}
        </div>
      )}

      {uiState === "downloading" && download !== null && (
        <div className="text-sm">
          <div>Downloading update…</div>
          <div className="mt-1 h-1 w-48 bg-[var(--color-border)] rounded overflow-hidden">
            <div
              data-testid="download-progress-bar"
              className="h-full bg-[var(--color-accent)] transition-all"
              style={{ width: downloadPct !== null ? `${downloadPct}%` : "30%" }}
            />
          </div>
          {downloadPct !== null && (
            <div className="text-xs text-[var(--color-text-muted)] mt-1">{downloadPct}%</div>
          )}
        </div>
      )}

      {uiState === "success" && (
        <div role="status" className="text-sm text-green-600">
          Update applied successfully. Now running {status?.currentVersion ?? "new version"}.
        </div>
      )}

      {failure !== null && (uiState === "rolled_back" || uiState === "failed") && (
        <div role="alert" className="text-sm text-red-600">
          {failure.reason === "reconnect_timeout"
            ? "Gateway failed to restart within 2 minutes. Run `nimbus start` in a terminal, then reload."
            : failure.reason === "signature_invalid"
              ? "Update rejected: signature invalid. Your Nimbus is safe."
              : failure.reason === "hash_mismatch"
                ? "Update rejected: hash mismatch. Your Nimbus is safe."
                : `Update rolled back: ${failure.reason}.`}
        </div>
      )}
    </section>
  );
}
