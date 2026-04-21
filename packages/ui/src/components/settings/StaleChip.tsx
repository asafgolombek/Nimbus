export interface StaleChipProps {
  /** ISO timestamp of last successful connection; omit to show generic stale chip. */
  readonly offlineSinceIso?: string;
}

export function StaleChip({ offlineSinceIso }: StaleChipProps) {
  const label =
    offlineSinceIso !== undefined
      ? `Stale · offline since ${offlineSinceIso}`
      : "Stale · gateway offline";
  return (
    <output
      aria-label={label}
      className="inline-block px-2 py-0.5 text-xs rounded-full bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
    >
      {label}
    </output>
  );
}
