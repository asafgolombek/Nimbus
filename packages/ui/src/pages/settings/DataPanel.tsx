import { useCallback, useEffect, useState } from "react";
import { DeleteServiceDialog } from "../../components/settings/data/DeleteServiceDialog";
import { ExportWizard } from "../../components/settings/data/ExportWizard";
import { ImportWizard } from "../../components/settings/data/ImportWizard";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { createIpcClient } from "../../ipc/client";
import { useNimbusStore } from "../../store";

type OpenWizard = "none" | "export" | "import" | "delete";

function getDisabledReason(offline: boolean, anyRunning: boolean): string | null {
  if (offline) return "Gateway offline";
  if (anyRunning) return "An export / import / delete is already in progress.";
  return null;
}

function formatTs(ms: number | null): string {
  if (ms === null) return "Never";
  const d = new Date(ms);
  return d.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function DataPanel() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const exportFlow = useNimbusStore((s) => s.exportFlow);
  const importFlow = useNimbusStore((s) => s.importFlow);
  const deleteFlow = useNimbusStore((s) => s.deleteFlow);
  const lastExportPreflight = useNimbusStore((s) => s.lastExportPreflight);
  const setLastExportPreflight = useNimbusStore((s) => s.setLastExportPreflight);
  const markDisconnected = useNimbusStore((s) => s.markDisconnected);

  const [fetchError, setFetchError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenWizard>("none");

  const offline = connectionState === "disconnected";
  const anyRunning =
    exportFlow.status === "running" ||
    importFlow.status === "running" ||
    deleteFlow.status === "running";

  const refreshPreflight = useCallback(async () => {
    try {
      const res = await createIpcClient().dataGetExportPreflight();
      setLastExportPreflight(res);
      setFetchError(null);
    } catch (err) {
      setFetchError((err as Error).message);
    }
  }, [setLastExportPreflight]);

  useEffect(() => {
    if (!offline) refreshPreflight().catch(() => undefined);
  }, [offline, refreshPreflight]);

  useEffect(() => {
    if (offline && anyRunning) markDisconnected();
  }, [offline, anyRunning, markDisconnected]);

  const disabledReason = getDisabledReason(offline, anyRunning);
  const writeDisabled = disabledReason !== null;

  return (
    <section className="p-6 space-y-6">
      <PanelHeader
        title="Data"
        description="Back up, restore, and selectively delete your Nimbus data."
        livePill={offline ? <StaleChip /> : undefined}
      />
      {fetchError !== null && (
        <PanelError
          message={`Failed to load preflight: ${fetchError}`}
          onRetry={refreshPreflight}
        />
      )}

      {/* Export card */}
      <article
        data-testid="data-card-export"
        className="p-4 rounded-md border border-[var(--color-border)] space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Back up your data</h3>
          {offline && lastExportPreflight ? <StaleChip /> : null}
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          Exports an encrypted <code>.tar.gz</code> containing your index, vault, and settings.
          Requires a passphrase; also produces a recovery seed.
        </p>
        <dl className="text-xs grid grid-cols-2 gap-1 max-w-md">
          <dt className="text-[var(--color-text-muted)]">Last export</dt>
          <dd>{formatTs(lastExportPreflight?.lastExportAt ?? null)}</dd>
          <dt className="text-[var(--color-text-muted)]">Index size</dt>
          <dd>{formatBytes(lastExportPreflight?.estimatedSizeBytes ?? 0)}</dd>
          <dt className="text-[var(--color-text-muted)]">Items</dt>
          <dd>{lastExportPreflight?.itemCount ?? 0}</dd>
        </dl>
        <button
          type="button"
          disabled={writeDisabled}
          onClick={() => setOpen("export")}
          title={disabledReason ?? undefined}
          className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          Export backup…
        </button>
      </article>

      {/* Import card */}
      <article
        data-testid="data-card-import"
        className="p-4 rounded-md border border-[var(--color-border)] space-y-3"
      >
        <h3 className="text-lg font-semibold">Restore from backup</h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          Replaces your current index and vault with the contents of a Nimbus backup. Requires
          either the passphrase or the 12-word recovery seed.
        </p>
        <button
          type="button"
          disabled={writeDisabled}
          onClick={() => setOpen("import")}
          title={disabledReason ?? undefined}
          className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          Restore backup…
        </button>
      </article>

      {/* Delete card */}
      <article
        data-testid="data-card-delete"
        className="p-4 rounded-md border border-[var(--color-border)] space-y-3"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Delete service data</h3>
          <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-warn-bg)] text-[var(--color-warn-fg)]">
            destructive
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          Permanently removes all items, embeddings, and vault credentials for one service
          (GDPR-style delete). The action is recorded in the audit log.
        </p>
        <button
          type="button"
          disabled={writeDisabled}
          onClick={() => setOpen("delete")}
          title={disabledReason ?? undefined}
          className="px-3 py-1.5 rounded-md border border-[var(--color-border)] disabled:opacity-50"
        >
          Delete service…
        </button>
      </article>

      {open === "export" && (
        <ExportWizard
          onClose={() => {
            setOpen("none");
            refreshPreflight().catch(() => undefined);
          }}
        />
      )}
      {open === "import" && <ImportWizard onClose={() => setOpen("none")} />}
      {open === "delete" && (
        <DeleteServiceDialog
          onClose={() => {
            setOpen("none");
            refreshPreflight().catch(() => undefined);
          }}
        />
      )}
    </section>
  );
}
