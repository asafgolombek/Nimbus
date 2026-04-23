import { Box, Text } from "ink";
import type React from "react";

import { STATUS_POLL_INTERVAL_MS, WATCHER_PANE_NAME_LIMIT } from "./constants.ts";
import type { TuiMode } from "./state.ts";
import { useIpcPoll } from "./useIpcPoll.ts";

interface WatcherRow {
  id: string;
  name: string;
  active: boolean;
  firing: boolean;
}

function isWatcherRow(row: unknown): row is WatcherRow {
  if (typeof row !== "object" || row === null) {
    return false;
  }
  const r = row as Record<string, unknown>;
  return (
    typeof r["id"] === "string" &&
    typeof r["name"] === "string" &&
    typeof r["active"] === "boolean" &&
    typeof r["firing"] === "boolean"
  );
}

function isWatcherList(data: unknown): data is WatcherRow[] {
  return Array.isArray(data) && data.every(isWatcherRow);
}

export function WatcherPane({ mode }: { mode: TuiMode }): React.JSX.Element {
  const poll = useIpcPoll<unknown>("watcher.list", STATUS_POLL_INTERVAL_MS, mode);
  const rows = isWatcherList(poll.data) ? poll.data : [];
  const active = rows.filter((r) => r.active).length;
  const firing = rows.filter((r) => r.firing);
  const shown = firing.slice(0, WATCHER_PANE_NAME_LIMIT);
  const extra = firing.length - shown.length;

  return (
    <Box flexDirection="column">
      <Text bold>Watchers{poll.stale ? " (stale)" : ""}</Text>
      <Text>
        {String(active)} active, {String(firing.length)} firing
      </Text>
      {shown.map((w) => (
        <Text key={w.id}>• {w.name}</Text>
      ))}
      {extra > 0 ? <Text dimColor>…{String(extra)} more</Text> : null}
    </Box>
  );
}
