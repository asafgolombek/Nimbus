import type { LlmTaskType, RouterStatusResult } from "../../../ipc/types";

const TASK_ORDER: ReadonlyArray<LlmTaskType> = [
  "classification",
  "reasoning",
  "summarisation",
  "agent_step",
];

interface Props {
  readonly status: RouterStatusResult;
}

export function RouterStatus({ status }: Props) {
  const keys = Object.keys(status.decisions) as LlmTaskType[];
  if (keys.length === 0) {
    return (
      <div className="p-4 text-sm text-[var(--color-text-muted)] rounded-md border border-[var(--color-border)]">
        Router has not been queried yet.
      </div>
    );
  }
  const rows = TASK_ORDER.filter((t) => t in status.decisions);
  return (
    <div
      data-testid="router-status"
      className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-md border border-[var(--color-border)] p-3"
    >
      {rows.map((t) => {
        const d = status.decisions[t];
        return (
          <div key={t} className="text-sm">
            <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              {t}
            </div>
            {d === undefined ? (
              <div className="text-[var(--color-text-muted)]">no provider available</div>
            ) : (
              <div>
                <span className="font-medium">{d.modelName || d.providerId}</span>
                <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                  {d.providerId} · {d.reason}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
