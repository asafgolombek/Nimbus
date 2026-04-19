import type { ReactNode } from "react";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import type { AuditEntry } from "../../ipc/types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "--:--"
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function outcomeColour(o: AuditEntry["outcome"]): string {
  switch (o) {
    case "approved":
      return "text-[var(--color-ok)]";
    case "rejected":
      return "text-[var(--color-error)]";
    case "auto":
      return "text-[var(--color-accent)]";
    default:
      return "text-[var(--color-fg-muted)]";
  }
}

export function AuditFeed(): ReactNode {
  const { data } = useIpcQuery<AuditEntry[]>("audit.list", 10_000, { limit: 25 });
  const entries = data ?? [];
  if (entries.length === 0) {
    return (
      <section aria-label="Recent activity" className="text-[var(--color-fg-muted)] text-sm">
        No recent activity.
      </section>
    );
  }
  return (
    <section
      aria-label="Recent activity"
      className="max-h-80 overflow-auto border border-[var(--color-border)] rounded-md"
    >
      <ul className="divide-y divide-[var(--color-border)]">
        {entries.map((e) => (
          <li key={e.id} className="px-3 py-2 flex items-center gap-3 text-xs">
            <time className="text-[var(--color-fg-muted)] w-12 font-mono">{formatTime(e.ts)}</time>
            <span className="text-[var(--color-fg)]">{e.action}</span>
            {e.subject && (
              <span className="text-[var(--color-fg-muted)] truncate">{e.subject}</span>
            )}
            <span className={`ml-auto ${outcomeColour(e.outcome)}`}>{e.outcome}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
