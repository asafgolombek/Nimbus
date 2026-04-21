import { useCallback, useEffect, useState } from "react";
import { createIpcClient } from "../../../ipc/client";
import type { DataDeleteResult, DeletePreflightResult } from "../../../ipc/types";
import { useNimbusStore } from "../../../store";

type Step = "pick" | "preview" | "confirming" | "deleting" | "done" | "error";

interface DeleteServiceDialogProps {
  readonly onClose: () => void;
}

export function DeleteServiceDialog({ onClose }: DeleteServiceDialogProps) {
  const [step, setStep] = useState<Step>("pick");
  const [service, setService] = useState<string>("");
  const [preflight, setPreflight] = useState<DeletePreflightResult | null>(null);
  const [typedName, setTypedName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [result, setResult] = useState<DataDeleteResult | null>(null);

  const connectors = useNimbusStore((s) => s.connectorsList) ?? [];
  const setDeleteFlow = useNimbusStore((s) => s.setDeleteFlow);

  const configuredServices = connectors.map((c) => c.service);

  useEffect(() => {
    if (configuredServices.length > 0 && service === "") {
      setService(configuredServices[0] as string);
    }
  }, [configuredServices, service]);

  const onLoadPreflight = useCallback(async () => {
    if (service === "") return;
    setPreflightLoading(true);
    try {
      const res = await createIpcClient().dataGetDeletePreflight({ service });
      setPreflight(res);
      setStep("preview");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStep("error");
    } finally {
      setPreflightLoading(false);
    }
  }, [service]);

  const onDelete = useCallback(async () => {
    setStep("deleting");
    setDeleteFlow({ status: "running", service });
    try {
      const res = await createIpcClient().dataDelete({ service, dryRun: false });
      setResult(res);
      setDeleteFlow({ status: "idle" });
      setStep("done");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setDeleteFlow({
        status: "error",
        errorKind: "rpc_failed",
        errorMessage: (err as Error).message,
        service,
      });
      setStep("error");
    }
  }, [service, setDeleteFlow]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="delete-dialog"
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
    >
      <div className="bg-[var(--color-bg)] rounded-lg max-w-lg w-full p-6 space-y-4 border border-[var(--color-border)]">
        {step === "pick" && (
          <>
            <h2 className="text-xl font-semibold">Delete service data</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Pick a configured service to permanently delete all its items, embeddings, and vault
              credentials.
            </p>
            <select
              aria-label="Service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              disabled={configuredServices.length === 0}
              className="w-full px-2 py-1 border border-[var(--color-border)] rounded"
            >
              {configuredServices.length === 0 && <option value="">No services configured</option>}
              {configuredServices.map((sv) => (
                <option key={sv} value={sv}>
                  {sv}
                </option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                disabled={service === ""}
                onClick={() => void onLoadPreflight()}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </>
        )}

        {preflightLoading && step === "pick" && (
          <p data-testid="preflight-loading" className="text-sm text-[var(--color-text-muted)]">
            Calculating…
          </p>
        )}

        {step === "preview" && preflight !== null && (
          <>
            <h2 className="text-xl font-semibold">
              Confirm deletion of <code>{service}</code>
            </h2>
            <ul className="text-sm list-disc pl-5 space-y-1">
              <li>
                Deletes <strong>{preflight.itemCount}</strong> items
              </li>
              <li>
                Deletes <strong>{preflight.embeddingCount}</strong> embeddings
              </li>
              <li>
                Deletes <strong>{preflight.vaultKeyCount}</strong> vault keys
              </li>
            </ul>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("pick")}>
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep("confirming")}
                className="px-3 py-1.5 rounded-md bg-[var(--color-danger)] text-white"
              >
                Proceed
              </button>
            </div>
          </>
        )}

        {step === "confirming" && (
          <>
            <h2 className="text-xl font-semibold">Type to confirm</h2>
            <p className="text-sm">
              Type the service id <code>{service}</code> exactly to confirm. This comparison is
              case-sensitive.
            </p>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={service}
              className="w-full px-2 py-1 border border-[var(--color-border)] rounded"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("preview")}>
                Back
              </button>
              <button
                type="button"
                disabled={typedName !== service}
                onClick={() => void onDelete()}
                className="px-3 py-1.5 rounded-md bg-[var(--color-danger)] text-white disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </>
        )}

        {step === "deleting" && (
          <>
            <h2 className="text-xl font-semibold">Deleting…</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Removing data for {service}.</p>
          </>
        )}

        {step === "done" && result !== null && (
          <>
            <h2 className="text-xl font-semibold">Deleted</h2>
            <p className="text-sm">
              {result.deleted ? (
                <>
                  Deleted {result.preflight.itemsToDelete} items from <code>{service}</code>.
                </>
              ) : (
                <>Nothing was deleted (server returned `deleted: false`).</>
              )}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
              >
                Close
              </button>
            </div>
          </>
        )}

        {step === "error" && (
          <>
            <h2 className="text-xl font-semibold">Delete failed</h2>
            <p className="text-sm">{errorMessage ?? "Delete failed — data unchanged."}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md border border-[var(--color-border)]"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
