export type IntervalUnit = "sec" | "min" | "hr";

export interface IntervalParts {
  readonly value: number;
  readonly unit: IntervalUnit;
}

/**
 * Convert ms → the largest whole unit that divides ms evenly, biased toward minutes.
 * Returns `min` when ms is exactly zero (defensive — the UI should never send zero).
 */
export function fromMs(ms: number): IntervalParts {
  if (ms <= 0) return { value: 1, unit: "min" };
  if (ms % 3_600_000 === 0) return { value: ms / 3_600_000, unit: "hr" };
  if (ms % 60_000 === 0) return { value: ms / 60_000, unit: "min" };
  return { value: Math.round(ms / 1000), unit: "sec" };
}

export function toMs(parts: IntervalParts): number {
  switch (parts.unit) {
    case "sec":
      return parts.value * 1000;
    case "min":
      return parts.value * 60_000;
    case "hr":
      return parts.value * 3_600_000;
  }
}

/** 60 seconds, expressed in ms. Matches Gateway's `MIN_SYNC_INTERVAL_MS`. */
export const MIN_INTERVAL_MS = 60_000;
