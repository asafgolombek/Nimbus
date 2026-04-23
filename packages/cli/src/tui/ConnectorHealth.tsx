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

interface ConnectorHealthProps {
  readonly mode: TuiMode;
}

function renderBody(
  poll: ReturnType<typeof useIpcPoll<unknown>>,
  rows: ConnectorRow[],
): React.JSX.Element {
  if (poll.data === null && rows.length === 0) {
    return <Text dimColor>loading…</Text>;
  }
  if (rows.length === 0) {
    return <Text dimColor>(none)</Text>;
  }
  return (
    <>
      {rows.map((r) => (
        <Text key={r.service}>
          {r.status === "degraded" ? "⚠ " : "  "}
          {glyph(r.status)} {r.service}
        </Text>
      ))}
    </>
  );
}

export function ConnectorHealth({ mode }: ConnectorHealthProps): React.JSX.Element {
  const poll = useIpcPoll<unknown>("connector.list", STATUS_POLL_INTERVAL_MS, mode);
  const rows = isConnectorList(poll.data) ? poll.data : [];
  return (
    <Box flexDirection="column">
      <Text bold>Connectors{poll.stale ? " (stale)" : ""}</Text>
      {renderBody(poll, rows)}
    </Box>
  );
}
