import { useEffect, useState } from "react";
import { createIpcClient } from "../../ipc/client";
import type { WatcherHistoryEntry } from "../../ipc/types";

interface WatcherHistoryDrawerProps {
  readonly watcherId: string;
  readonly watcherName: string;
  readonly onClose: () => void;
}

const HISTORY_LIMIT = 50;

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function WatcherHistoryDrawer({
  watcherId,
  watcherName,
  onClose,
}: WatcherHistoryDrawerProps) {
  const [events, setEvents] = useState<ReadonlyArray<WatcherHistoryEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createIpcClient()
      .watcherListHistory(watcherId, HISTORY_LIMIT)
      .then((res) => {
        if (!cancelled) setEvents(res.events);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [watcherId]);

  return (
    <section
      aria-label={`History for ${watcherName}`}
      className="border rounded p-3 mt-2 bg-neutral-50 dark:bg-neutral-900 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Fire history — last {HISTORY_LIMIT}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-neutral-500 hover:text-neutral-700"
        >
          Close
        </button>
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
      {events === null && !error && <p className="text-xs text-neutral-500">Loading…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-xs text-neutral-500">No fires yet.</p>
      )}
      {events !== null && events.length > 0 && (
        <ul className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {events.map((ev) => (
            <li
              key={ev.firedAt}
              className="text-xs border-b border-neutral-200 dark:border-neutral-800 py-1"
            >
              <div className="font-mono text-neutral-500">{formatTimestamp(ev.firedAt)}</div>
              {/* whitespace-pre-wrap + break-all: prevents data loss on large graph
                  predicate snapshots; the drawer's own max-h-64 overflow-y-auto scrolls. */}
              <div className="font-mono whitespace-pre-wrap break-all">{ev.conditionSnapshot}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
