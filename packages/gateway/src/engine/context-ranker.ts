import type { RankedIndexItem } from "../index/ranked-item.ts";

export type SourceGroup = {
  service: string;
  type: string;
  count: number;
  oldestModifiedAt: number;
  newestModifiedAt: number;
};

export type ContextWindow = {
  items: RankedIndexItem[];
  sourceSummary: SourceGroup[];
  totalMatches: number;
};

function typeKey(it: RankedIndexItem): string {
  return it.indexedType;
}

/**
 * Top-N full items plus a compact summary of remaining matches by service/type.
 */
export function buildContextWindow(
  results: readonly RankedIndexItem[],
  maxItems: number,
): ContextWindow {
  const cap = Math.min(200, Math.max(1, Math.floor(maxItems)));
  const totalMatches = results.length;
  if (totalMatches === 0) {
    return { items: [], sourceSummary: [], totalMatches: 0 };
  }
  const top = results.slice(0, cap);
  const rest = results.slice(cap);
  const groups = new Map<string, SourceGroup>();
  for (const it of rest) {
    const key = `${it.service}\0${typeKey(it)}`;
    const mod = it.modifiedAt ?? 0;
    const prev = groups.get(key);
    if (prev === undefined) {
      groups.set(key, {
        service: it.service,
        type: typeKey(it),
        count: 1,
        oldestModifiedAt: mod,
        newestModifiedAt: mod,
      });
    } else {
      prev.count += 1;
      prev.oldestModifiedAt = Math.min(prev.oldestModifiedAt, mod);
      prev.newestModifiedAt = Math.max(prev.newestModifiedAt, mod);
    }
  }
  return {
    items: [...top],
    sourceSummary: [...groups.values()].sort((a, b) => b.count - a.count),
    totalMatches,
  };
}
