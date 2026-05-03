import type { ConnectionState } from "../connection/connection-manager.js";
import type { StatusBarItemHandle } from "../vscode-shim.js";

export type StatusBarInputs = {
  connection: ConnectionState;
  profile: string;
  degradedConnectorCount: number;
  /** Names of degraded connectors so the tooltip can list them — keeps users
   *  out of the chat panel for a quick "what's broken?" check. */
  degradedConnectorNames: string[];
  pendingHitlCount: number;
  autoStartGateway: boolean;
};

export type StatusBarRender = {
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
  backgroundColor: { id: string } | undefined;
};

const COLOR_WARN = { id: "statusBarItem.warningBackground" };
const COLOR_ERR = { id: "statusBarItem.errorBackground" };

export function formatStatusBar(inp: StatusBarInputs): StatusBarRender {
  const {
    connection,
    profile,
    degradedConnectorCount,
    degradedConnectorNames,
    pendingHitlCount,
    autoStartGateway,
  } = inp;

  if (connection.kind === "connecting" || connection.kind === "idle") {
    return {
      text: "Nimbus: $(sync~spin) connecting…",
      tooltip:
        connection.kind === "connecting"
          ? `Connecting to Gateway socket: ${connection.socketPath}`
          : "Initializing",
      command: undefined,
      backgroundColor: undefined,
    };
  }

  if (connection.kind === "permission-denied") {
    return {
      text: "Nimbus: $(error) Socket permission denied",
      tooltip: `Permission denied accessing socket: ${connection.socketPath} — check file ownership/mode or socketPath setting`,
      command: "nimbus.openLogs",
      backgroundColor: COLOR_ERR,
    };
  }

  if (connection.kind === "disconnected") {
    if (autoStartGateway) {
      return {
        text: "Nimbus: $(sync~spin) starting Gateway…",
        tooltip: `Spawning nimbus start; reconnecting to ${connection.socketPath}`,
        command: undefined,
        backgroundColor: undefined,
      };
    }
    return {
      text: "Nimbus: $(circle-slash) Gateway not running",
      tooltip: `Run "Nimbus: Start Gateway" or start manually with: nimbus start`,
      command: "nimbus.startGateway",
      backgroundColor: COLOR_WARN,
    };
  }

  if (connection.kind === "starting-gateway") {
    return {
      text: "Nimbus: $(sync~spin) starting Gateway…",
      tooltip: "Spawning nimbus start; waiting for socket",
      command: undefined,
      backgroundColor: undefined,
    };
  }

  // connected
  const tags: string[] = [];
  if (degradedConnectorCount > 0) tags.push(`${degradedConnectorCount} degraded`);
  if (pendingHitlCount > 0) tags.push(`${pendingHitlCount} pending`);
  let icon = "$(circle-large-filled)";
  let bg: { id: string } | undefined;
  if (pendingHitlCount > 0) {
    icon = "$(bell-dot)";
    bg = COLOR_WARN;
  } else if (degradedConnectorCount > 0) {
    icon = "$(warning)";
    bg = COLOR_WARN;
  }
  const profileSegment = profile.length > 0 ? profile : "default";
  const tagSegment = tags.length > 0 ? ` · ${tags.join(" · ")}` : "";
  const text = `Nimbus: ${icon} ${profileSegment}${tagSegment}`;

  let command = "nimbus.ask";
  const degradedSummary =
    degradedConnectorCount === 0
      ? "0 connectors degraded"
      : degradedConnectorNames.length > 0
        ? `${degradedConnectorCount} degraded: ${degradedConnectorNames.join(", ")}`
        : `${degradedConnectorCount} connectors degraded`;
  let tooltip = `Connected · profile=${profileSegment} · ${degradedSummary}`;
  if (pendingHitlCount > 0) {
    command = "nimbus.showPendingHitl";
    tooltip = `${pendingHitlCount} consent request(s) waiting${
      degradedConnectorCount > 0 ? ` · ${degradedSummary}` : ""
    }`;
  }

  return { text, tooltip, command, backgroundColor: bg };
}

export interface StatusBarController {
  update(inp: StatusBarInputs): void;
  dispose(): void;
}

export function createStatusBarController(item: StatusBarItemHandle): StatusBarController {
  item.show();
  return {
    update(inp): void {
      const r = formatStatusBar(inp);
      item.text = r.text;
      item.tooltip = r.tooltip;
      item.command = r.command;
      item.backgroundColor = r.backgroundColor;
    },
    dispose(): void {
      item.dispose();
    },
  };
}
