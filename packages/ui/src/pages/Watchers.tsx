import { useEffect, useRef, useState } from "react";
import { WatcherHistoryDrawer } from "../components/watchers/WatcherHistoryDrawer";
import { useIpcQuery } from "../hooks/useIpcQuery";
import { createIpcClient } from "../ipc/client";
import type {
  CandidateRelation,
  GraphRelationKind,
  WatcherCreateParams,
  WatcherListResult,
  WatcherSummary,
} from "../ipc/types";
import { useNimbusStore } from "../store";

const NON_GRAPH_CONDITION_TYPES = ["schedule", "metric"] as const;
const ACTION_TYPES = ["notify", "webhook", "workflow"] as const;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const VALIDATE_DEBOUNCE_MS = 500;

function formatTimestamp(ms: number | null): string {
  if (ms === null) return "Never fired";
  return new Date(ms).toLocaleString();
}

// ---------------------------------------------------------------------------
// Graph condition builder
// ---------------------------------------------------------------------------

interface GraphPredicateFields {
  relation: GraphRelationKind;
  targetType: string;
  targetId: string;
}

function buildGraphPredicateJson(fields: GraphPredicateFields): string {
  return JSON.stringify({
    relation: fields.relation,
    target: { type: fields.targetType, externalId: fields.targetId },
  });
}

interface GraphConditionBuilderProps {
  value: GraphPredicateFields;
  onChange: (v: GraphPredicateFields) => void;
  candidateRelations: readonly CandidateRelation[];
}

function GraphConditionBuilder({
  value,
  onChange,
  candidateRelations,
}: GraphConditionBuilderProps) {
  const [validationResult, setValidationResult] = useState<
    { matchCount: number } | { error: string } | null
  >(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced validation — fires only when all three fields are non-empty
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.relation || !value.targetType.trim() || !value.targetId.trim()) {
      setValidationResult(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const json = buildGraphPredicateJson(value);
        const res = await createIpcClient().watcherValidateCondition(json, THIRTY_DAYS_MS);
        setValidationResult({ matchCount: res.matchCount });
      } catch (err) {
        setValidationResult({ error: err instanceof Error ? err.message : String(err) });
      }
    }, VALIDATE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Relation
        <select
          aria-label="Graph relation"
          className="border rounded px-2 py-1"
          value={value.relation}
          onChange={(e) => onChange({ ...value, relation: e.target.value as GraphRelationKind })}
        >
          {candidateRelations.map((r) => (
            <option key={r.relation} value={r.relation} title={r.description}>
              {r.relation}
            </option>
          ))}
        </select>
        {candidateRelations.find((r) => r.relation === value.relation) && (
          <span className="text-xs text-neutral-500">
            {candidateRelations.find((r) => r.relation === value.relation)?.description}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Target entity type
        <input
          aria-label="Target entity type"
          placeholder="e.g. person, repo"
          className="border rounded px-2 py-1"
          value={value.targetType}
          onChange={(e) => onChange({ ...value, targetType: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Target entity ID
        <input
          aria-label="Target entity ID"
          placeholder="external ID of the target"
          className="border rounded px-2 py-1"
          value={value.targetId}
          onChange={(e) => onChange({ ...value, targetId: e.target.value })}
        />
      </label>

      {validationResult !== null && (
        <p
          data-testid="validation-result"
          className={
            "error" in validationResult ? "text-red-600 text-xs" : "text-green-700 text-xs"
          }
        >
          {"error" in validationResult
            ? validationResult.error
            : `${validationResult.matchCount} matching item(s) in the last 30 days`}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

interface CreateDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateWatcherDialog({ onClose, onCreated }: CreateDialogProps) {
  const [name, setName] = useState("");
  const [conditionType, setConditionType] = useState<"graph" | "schedule" | "metric">("graph");
  const [conditionJson, setConditionJson] = useState("{}");
  const [graphFields, setGraphFields] = useState<GraphPredicateFields>({
    relation: "owned_by",
    targetType: "",
    targetId: "",
  });
  const [actionType, setActionType] = useState<string>(ACTION_TYPES[0]);
  const [actionJson, setActionJson] = useState("{}");
  const [candidateRelations, setCandidateRelations] = useState<readonly CandidateRelation[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load static candidate relations once on mount
  useEffect(() => {
    createIpcClient()
      .watcherListCandidateRelations()
      .then((r) => {
        setCandidateRelations(r.relations);
        const first = r.relations[0];
        if (first) {
          setGraphFields((prev) => ({ ...prev, relation: first.relation }));
        }
      })
      .catch(() => {
        // Fall back to static list on failure
        setCandidateRelations([
          {
            relation: "owned_by",
            description: "Authored, opened, or posted by target",
            underlyingRelationTypes: [],
          },
          {
            relation: "upstream_of",
            description: "Direct outgoing edge to target",
            underlyingRelationTypes: [],
          },
          {
            relation: "downstream_of",
            description: "Target has outgoing edge to item",
            underlyingRelationTypes: [],
          },
        ]);
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const params: WatcherCreateParams = {
        name: name.trim(),
        conditionType,
        conditionJson: conditionType === "graph" ? "{}" : conditionJson,
        actionType,
        actionJson,
        ...(conditionType === "graph"
          ? { graphPredicateJson: buildGraphPredicateJson(graphFields) }
          : {}),
      };
      await createIpcClient().watcherCreate(params);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const graphSubmitDisabled =
    conditionType === "graph" &&
    (graphFields.targetType.trim() === "" || graphFields.targetId.trim() === "");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create watcher"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-neutral-800 rounded-lg shadow-xl p-6 w-full max-w-md flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-semibold">Create Watcher</h2>

        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            aria-label="Watcher name"
            className="border rounded px-2 py-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Condition type
          <select
            aria-label="Condition type"
            className="border rounded px-2 py-1"
            value={conditionType}
            onChange={(e) => setConditionType(e.target.value as "graph" | "schedule" | "metric")}
          >
            <option value="graph">graph</option>
            {NON_GRAPH_CONDITION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {conditionType === "graph" ? (
          <GraphConditionBuilder
            value={graphFields}
            onChange={setGraphFields}
            candidateRelations={candidateRelations}
          />
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            Condition JSON
            <textarea
              aria-label="Condition JSON"
              className="border rounded px-2 py-1 font-mono text-xs"
              rows={3}
              value={conditionJson}
              onChange={(e) => setConditionJson(e.target.value)}
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Action type
          <select
            aria-label="Action type"
            className="border rounded px-2 py-1"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
          >
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Action JSON
          <textarea
            aria-label="Action JSON"
            className="border rounded px-2 py-1 font-mono text-xs"
            rows={3}
            value={actionJson}
            onChange={(e) => setActionJson(e.target.value)}
          />
        </label>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim() === "" || graphSubmitDisabled}
            className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watcher list row
// ---------------------------------------------------------------------------

interface WatcherRowProps {
  watcher: WatcherSummary;
  disabled: boolean;
  historyOpen: boolean;
  onToggle: (w: WatcherSummary) => void;
  onDelete: (w: WatcherSummary) => void;
  onToggleHistory: (id: string) => void;
}

function WatcherRow({
  watcher,
  disabled,
  historyOpen,
  onToggle,
  onDelete,
  onToggleHistory,
}: WatcherRowProps) {
  return (
    <>
      <tr>
        <td className="py-2 px-3 font-medium">{watcher.name}</td>
        <td className="py-2 px-3 text-sm text-neutral-500">{watcher.condition_type}</td>
        <td className="py-2 px-3 text-sm" data-testid={`last-fired-${watcher.id}`}>
          {formatTimestamp(watcher.last_fired_at)}
        </td>
        <td className="py-2 px-3">
          <input
            type="checkbox"
            aria-label={`${watcher.name} enabled`}
            checked={watcher.enabled === 1}
            disabled={disabled}
            onChange={() => onToggle(watcher)}
          />
        </td>
        <td className="py-2 px-3 flex gap-2">
          <button
            type="button"
            aria-label={`History for ${watcher.name}`}
            onClick={() => onToggleHistory(watcher.id)}
            className="text-xs border rounded px-2 py-0.5"
          >
            History
          </button>
          <button
            type="button"
            aria-label={`Delete watcher ${watcher.name}`}
            disabled={disabled}
            onClick={() => onDelete(watcher)}
            className="text-red-600 text-sm disabled:opacity-40"
          >
            Delete
          </button>
        </td>
      </tr>
      {historyOpen && (
        <tr>
          <td colSpan={5} className="px-3 pb-3">
            <WatcherHistoryDrawer
              watcherId={watcher.id}
              watcherName={watcher.name}
              onClose={() => onToggleHistory(watcher.id)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Watchers() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const offline = connectionState !== "connected";

  const { data, error, isLoading, refetch } = useIpcQuery<WatcherListResult>(
    "watcher.list",
    30_000,
  );

  const [showCreate, setShowCreate] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [openHistoryForId, setOpenHistoryForId] = useState<string | null>(null);

  function handleToggleHistory(id: string) {
    setOpenHistoryForId((prev) => (prev === id ? null : id));
  }

  async function handleToggle(w: WatcherSummary) {
    if (actionInFlight) return;
    setActionInFlight(w.id);
    try {
      if (w.enabled === 1) {
        await createIpcClient().watcherPause(w.id);
      } else {
        await createIpcClient().watcherResume(w.id);
      }
      refetch();
    } finally {
      setActionInFlight(null);
    }
  }

  async function handleDelete(w: WatcherSummary) {
    if (!window.confirm(`Delete watcher "${w.name}"?`)) return;
    setActionInFlight(w.id);
    try {
      await createIpcClient().watcherDelete(w.id);
      refetch();
    } finally {
      setActionInFlight(null);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Watchers</h1>
        <button
          type="button"
          disabled={offline}
          onClick={() => setShowCreate(true)}
          className="px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:opacity-40"
        >
          New watcher
        </button>
      </div>

      {isLoading && <p className="text-neutral-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {data && (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b text-sm text-neutral-500">
              <th className="py-2 px-3">Name</th>
              <th className="py-2 px-3">Condition</th>
              <th className="py-2 px-3">Last fired</th>
              <th className="py-2 px-3">Enabled</th>
              <th className="py-2 px-3" />
            </tr>
          </thead>
          <tbody>
            {data.watchers.map((w) => (
              <WatcherRow
                key={w.id}
                watcher={w}
                disabled={offline || actionInFlight !== null}
                historyOpen={openHistoryForId === w.id}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onToggleHistory={handleToggleHistory}
              />
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateWatcherDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}
