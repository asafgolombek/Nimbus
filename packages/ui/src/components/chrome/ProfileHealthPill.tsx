import type { ReactNode } from "react";

interface Props {
  profile: string;
  aggregateHealth: "normal" | "amber" | "red";
}

function dotColour(h: Props["aggregateHealth"]): string {
  switch (h) {
    case "normal":
      return "bg-[var(--color-ok)]";
    case "amber":
      return "bg-[var(--color-amber)]";
    case "red":
      return "bg-[var(--color-error)]";
  }
}

function statusText(h: Props["aggregateHealth"]): string {
  if (h === "red") return "unavailable";
  if (h === "amber") return "degraded";
  return "all healthy";
}

export function ProfileHealthPill({ profile, aggregateHealth }: Props): ReactNode {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-[var(--color-fg-muted)] bg-[var(--color-bg)] border border-[var(--color-border)] rounded-full px-3 py-1">
      <span>{profile}</span>
      <span>·</span>
      <span
        aria-hidden="true"
        className={`inline-block w-2 h-2 rounded-full ${dotColour(aggregateHealth)}`}
      />
      <span>{statusText(aggregateHealth)}</span>
    </span>
  );
}
