import { Box, Text } from "ink";
import type React from "react";

import { STATUS_POLL_INTERVAL_MS } from "./constants.ts";
import type { TuiMode } from "./state.ts";
import { useIpcPoll } from "./useIpcPoll.ts";

interface ConnectorRow {
  service: string;
  status: "ok" | "degraded" | "down";
}

function isConnectorRow(row: unknown): row is ConnectorRow {
  if (typeof row !== "object" || row === null) {
    return false;
  }
  const r = row as Record<string, unknown>;
  return (
    typeof r["service"] === "string" &&
    (r["status"] === "ok" || r["status"] === "degraded" || r["status"] === "down")
  );
}

function isConnectorList(data: unknown): data is ConnectorRow[] {
  return Array.isArray(data) && data.every(isConnectorRow);
}

function glyph(status: ConnectorRow["status"]): string {
  if (status === "ok") {
    return "●";
  }
  if (status === "degraded") {
    return "◐";
  }
  return "○";
}

export function ConnectorHealth({ mode }: { mode: TuiMode }): React.JSX.Element {
  const poll = useIpcPoll<unknown>("connector.list", STATUS_POLL_INTERVAL_MS, mode);
  const rows = isConnectorList(poll.data) ? poll.data : [];
  return (
    <Box flexDirection="column">
      <Text bold>Connectors{poll.stale ? " (stale)" : ""}</Text>
      {poll.data === null && rows.length === 0 ? (
        <Text dimColor>loading…</Text>
      ) : rows.length === 0 ? (
        <Text dimColor>(none)</Text>
      ) : (
        rows.map((r) => (
          <Text key={r.service}>
            {r.status === "degraded" ? "⚠ " : "  "}
            {glyph(r.status)} {r.service}
          </Text>
        ))
      )}
    </Box>
  );
}
