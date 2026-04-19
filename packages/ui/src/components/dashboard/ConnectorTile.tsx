import type { ReactNode } from "react";
import type { ConnectorStatus } from "../../ipc/types";
import { formatRelative } from "./format";

interface Props {
  status: ConnectorStatus;
  highlighted: boolean;
}

function dotColour(h: ConnectorStatus["health"]): string {
  switch (h) {
    case "healthy":
      return "bg-[var(--color-ok)]";
    case "degraded":
    case "rate_limited":
      return "bg-[var(--color-amber)]";
    case "error":
    case "unauthenticated":
      return "bg-[var(--color-error)]";
    case "paused":
    default:
      return "bg-[var(--color-fg-muted)]";
  }
}

const DISPLAY_NAMES: Record<string, string> = {
  drive: "Google Drive",
  gmail: "Gmail",
  photos: "Google Photos",
  onedrive: "OneDrive",
  outlook: "Outlook",
  teams: "Microsoft Teams",
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  slack: "Slack",
  discord: "Discord",
  linear: "Linear",
  jira: "Jira",
  notion: "Notion",
  confluence: "Confluence",
  jenkins: "Jenkins",
  "github-actions": "GitHub Actions",
  circleci: "CircleCI",
  "gitlab-ci": "GitLab CI",
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
  iac: "IaC",
  kubernetes: "Kubernetes",
  pagerduty: "PagerDuty",
  grafana: "Grafana",
  sentry: "Sentry",
  "new-relic": "New Relic",
  datadog: "Datadog",
  filesystem: "Filesystem",
};

function displayName(name: string): string {
  return DISPLAY_NAMES[name] ?? name;
}

export function ConnectorTile({ status, highlighted }: Props): ReactNode {
  return (
    <div
      data-connector={status.name}
      className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md p-3 ${
        highlighted ? "ring-2 ring-[var(--color-accent)]" : ""
      }`}
      title={status.degradationReason ?? ""}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block w-2 h-2 rounded-full ${dotColour(status.health)}`}
        />
        <span className="text-[var(--color-fg)] text-sm">{displayName(status.name)}</span>
      </div>
      <div className="text-[var(--color-fg-muted)] text-xs mt-1">
        {status.lastSyncAt ? formatRelative(status.lastSyncAt) : "not synced yet"}
      </div>
      {status.degradationReason && (
        <div className="text-[var(--color-amber)] text-xs mt-1 truncate">
          {status.degradationReason}
        </div>
      )}
    </div>
  );
}
