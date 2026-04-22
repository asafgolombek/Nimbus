import { Fragment, useState } from "react";
import { WorkflowRunHistoryDrawer } from "../components/workflows/WorkflowRunHistoryDrawer";
import { useIpcQuery } from "../hooks/useIpcQuery";
import { createIpcClient } from "../ipc/client";
import type { WorkflowListResult, WorkflowSummary } from "../ipc/types";
import { useNimbusStore } from "../store";

// ---------------------------------------------------------------------------
// Step-list editor
// ---------------------------------------------------------------------------

interface StepDraft {
  tool: string;
  paramsJson: string;
}

function emptyStep(): StepDraft {
  return { tool: "", paramsJson: "{}" };
}

function stepsFromJson(json: string): StepDraft[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return [emptyStep()];
    return arr.map((s: unknown) => {
      if (typeof s !== "object" || s === null) return emptyStep();
      const step = s as { tool?: unknown; params?: unknown };
      return {
        tool: typeof step.tool === "string" ? step.tool : "",
        paramsJson: step.params !== undefined ? JSON.stringify(step.params, null, 2) : "{}",
      };
    });
  } catch {
    return [emptyStep()];
  }
}

function stepsToJson(steps: StepDraft[]): string {
  return JSON.stringify(
    steps.map((s) => {
      let params: unknown = {};
      try {
        params = JSON.parse(s.paramsJson);
      } catch {
        params = {};
      }
      return { tool: s.tool, params };
    }),
  );
}

interface StepListEditorProps {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
}

function StepListEditor({ steps, onChange }: StepListEditorProps) {
  function update(index: number, patch: Partial<StepDraft>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function remove(index: number) {
    const next = steps.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [emptyStep()]);
  }

  function add() {
    onChange([...steps, emptyStep()]);
  }

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable draft list keyed by position
        <div
          key={index}
          className="border rounded p-3 flex flex-col gap-2 bg-neutral-50 dark:bg-neutral-900"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500">Step {index + 1}</span>
            <button
              type="button"
              aria-label={`Remove step ${index + 1}`}
              onClick={() => remove(index)}
              className="text-red-500 text-xs"
            >
              Remove
            </button>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Tool
            <input
              aria-label={`Step ${index + 1} tool`}
              placeholder="e.g. github.searchPRs"
              className="border rounded px-2 py-1 font-mono text-sm"
              value={step.tool}
              onChange={(e) => update(index, { tool: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Params (JSON)
            <textarea
              aria-label={`Step ${index + 1} params`}
              className="border rounded px-2 py-1 font-mono text-xs"
              rows={3}
              value={step.paramsJson}
              onChange={(e) => update(index, { paramsJson: e.target.value })}
            />
          </label>
        </div>
      ))}

      <button type="button" onClick={add} className="self-start px-3 py-1 rounded border text-sm">
        Add step
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save dialog
// ---------------------------------------------------------------------------

interface SaveDialogProps {
  initial?: WorkflowSummary;
  onClose: () => void;
  onSaved: () => void;
}

function SaveWorkflowDialog({ initial, onClose, onSaved }: SaveDialogProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [steps, setSteps] = useState<StepDraft[]>(() => stepsFromJson(initial?.steps_json ?? "[]"));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const trimmedDesc = description.trim();
      await createIpcClient().workflowSave({
        name: name.trim(),
        stepsJson: stepsToJson(steps),
        ...(trimmedDesc ? { description: trimmedDesc } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save workflow"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-neutral-800 rounded-lg shadow-xl p-6 w-full max-w-lg flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-semibold">{initial ? "Edit Workflow" : "New Workflow"}</h2>

        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            aria-label="Workflow name"
            className="border rounded px-2 py-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            readOnly={!!initial}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Description (optional)
          <input
            aria-label="Workflow description"
            className="border rounded px-2 py-1"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Steps</span>
          <StepListEditor steps={steps} onChange={setSteps} />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim() === ""}
            className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflow list row
// ---------------------------------------------------------------------------

interface WorkflowRowProps {
  workflow: WorkflowSummary;
  dryRun: boolean;
  disabled: boolean;
  historyOpen: boolean;
  onRun: (w: WorkflowSummary) => void;
  onEdit: (w: WorkflowSummary) => void;
  onDelete: (w: WorkflowSummary) => void;
  onToggleHistory: (name: string) => void;
}

function WorkflowRow({
  workflow,
  dryRun,
  disabled,
  onRun,
  onEdit,
  onDelete,
  onToggleHistory,
}: WorkflowRowProps) {
  return (
    <tr>
      <td className="py-2 px-3 font-medium">{workflow.name}</td>
      <td className="py-2 px-3 text-sm text-neutral-500">{workflow.description ?? "—"}</td>
      <td className="py-2 px-3 flex gap-2">
        <button
          type="button"
          aria-label={`Run workflow ${workflow.name}`}
          disabled={disabled}
          onClick={() => onRun(workflow)}
          className="px-2 py-0.5 rounded bg-green-600 text-white text-xs disabled:opacity-40"
        >
          {dryRun ? "Dry run" : "Run"}
        </button>
        <button
          type="button"
          aria-label={`Edit workflow ${workflow.name}`}
          disabled={disabled}
          onClick={() => onEdit(workflow)}
          className="px-2 py-0.5 rounded border text-xs disabled:opacity-40"
        >
          Edit
        </button>
        <button
          type="button"
          aria-label={`Delete workflow ${workflow.name}`}
          disabled={disabled}
          onClick={() => onDelete(workflow)}
          className="px-2 py-0.5 rounded text-red-600 text-xs disabled:opacity-40"
        >
          Delete
        </button>
        <button
          type="button"
          aria-label={`Show history for ${workflow.name}`}
          disabled={disabled}
          onClick={() => onToggleHistory(workflow.name)}
          className="px-2 py-0.5 rounded border text-xs disabled:opacity-40"
        >
          History
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Workflows() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const offline = connectionState !== "connected";

  const { data, error, isLoading, refetch } = useIpcQuery<WorkflowListResult>(
    "workflow.list",
    30_000,
  );

  const [showSave, setShowSave] = useState<WorkflowSummary | "new" | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [openHistoryForName, setOpenHistoryForName] = useState<string | null>(null);

  async function handleRun(w: WorkflowSummary) {
    if (actionInFlight) return;
    setActionInFlight(w.name);
    try {
      await createIpcClient().workflowRun({ name: w.name, dryRun });
    } finally {
      setActionInFlight(null);
    }
  }

  async function handleDelete(w: WorkflowSummary) {
    if (!window.confirm(`Delete workflow "${w.name}"?`)) return;
    setActionInFlight(w.name);
    try {
      await createIpcClient().workflowDelete(w.name);
      refetch();
    } finally {
      setActionInFlight(null);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workflows</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm select-none">
            <input
              type="checkbox"
              aria-label="Dry run"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            Dry run
          </label>
          <button
            type="button"
            disabled={offline}
            onClick={() => setShowSave("new")}
            className="px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:opacity-40"
          >
            New workflow
          </button>
        </div>
      </div>

      {isLoading && <p className="text-neutral-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {data && (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b text-sm text-neutral-500">
              <th className="py-2 px-3">Name</th>
              <th className="py-2 px-3">Description</th>
              <th className="py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.workflows.map((w) => (
              <Fragment key={w.id}>
                <WorkflowRow
                  workflow={w}
                  dryRun={dryRun}
                  disabled={offline || actionInFlight !== null}
                  historyOpen={openHistoryForName === w.name}
                  onRun={handleRun}
                  onEdit={(wf) => setShowSave(wf)}
                  onDelete={handleDelete}
                  onToggleHistory={(name) =>
                    setOpenHistoryForName(openHistoryForName === name ? null : name)
                  }
                />
                {openHistoryForName === w.name && (
                  <WorkflowRunHistoryDrawer
                    workflowName={w.name}
                    onClose={() => setOpenHistoryForName(null)}
                    colSpan={3}
                  />
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {showSave !== null && (
        <SaveWorkflowDialog
          {...(showSave !== "new" ? { initial: showSave } : {})}
          onClose={() => setShowSave(null)}
          onSaved={() => {
            setShowSave(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}
