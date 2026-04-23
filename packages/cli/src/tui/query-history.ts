import { readFile, writeFile } from "node:fs/promises";

import { QUERY_HISTORY_CAP } from "./constants.ts";

interface HistoryFile {
  entries: string[];
}

function isHistoryFile(value: unknown): value is HistoryFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v["entries"])) {
    return false;
  }
  return v["entries"].every((item): item is string => typeof item === "string");
}

/** Read the history file. Returns [] on missing, corrupt, or mis-shaped file. */
export async function readHistory(path: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isHistoryFile(parsed)) {
    return [];
  }
  return parsed.entries;
}

/**
 * Append a query to the history, deduping on repeat-of-last and capping at
 * QUERY_HISTORY_CAP. Empty or whitespace-only queries are ignored.
 * Corrupt-file recovery: silently overwrites with the new entry alone.
 */
export async function appendQuery(path: string, query: string): Promise<void> {
  if (query.trim() === "") {
    return;
  }
  const current = await readHistory(path);
  if (current.length > 0 && current[current.length - 1] === query) {
    return;
  }
  const next = [...current, query];
  const trimmed = next.length > QUERY_HISTORY_CAP ? next.slice(-QUERY_HISTORY_CAP) : next;
  const body = JSON.stringify({ entries: trimmed });
  await writeFile(path, body, { encoding: "utf-8" });
}
