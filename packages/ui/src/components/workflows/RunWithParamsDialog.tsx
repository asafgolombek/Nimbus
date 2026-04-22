import { useState } from "react";
import { createIpcClient } from "../../ipc/client";

interface RunWithParamsDialogProps {
  readonly workflowName: string;
  readonly dryRun: boolean;
  readonly onClose: () => void;
  readonly onRan: () => void;
}

export function RunWithParamsDialog({
  workflowName,
  dryRun,
  onClose,
  onRan,
}: RunWithParamsDialogProps) {
  const [json, setJson] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    let parsed: Record<string, Record<string, unknown>>;
    try {
      const maybe = JSON.parse(json) as unknown;
      if (typeof maybe !== "object" || maybe === null || Array.isArray(maybe)) {
        throw new Error("Params override must be a JSON object");
      }
      parsed = maybe as Record<string, Record<string, unknown>>;
    } catch (err) {
      setError(err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON");
      return;
    }
    setSubmitting(true);
    try {
      await createIpcClient().workflowRun({
        name: workflowName,
        dryRun,
        paramsOverride: parsed,
      });
      onRan();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`Run ${workflowName} with params override`}
      className="fixed inset-0 flex items-center justify-center bg-black/40 z-50"
    >
      <div className="bg-white dark:bg-neutral-900 rounded p-4 w-[520px] flex flex-col gap-3">
        <h2 className="text-base font-semibold">Run "{workflowName}" with parameter override</h2>
        <p className="text-xs text-neutral-500">
          Provide a JSON object keyed by step label. Values replace step parameters for this
          invocation only. Example: <code>{`{"step-1":{"greeting":"hello"}}`}</code>
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only">Params override JSON</span>
          <textarea
            aria-label="Params override JSON"
            className="font-mono border rounded p-2 text-xs h-32"
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
        </label>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {submitting ? "Running…" : "Confirm run"}
          </button>
        </div>
      </div>
    </div>
  );
}
