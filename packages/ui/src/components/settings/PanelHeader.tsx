import type { ReactNode } from "react";

export interface PanelHeaderProps {
  readonly title: string;
  readonly description: string;
  readonly livePill?: ReactNode;
}

export function PanelHeader({ title, description, livePill }: PanelHeaderProps) {
  return (
    <header className="flex items-start justify-between pb-4 border-b border-[var(--color-border)]">
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text)]">{title}</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">{description}</p>
      </div>
      {livePill !== undefined && <div className="shrink-0">{livePill}</div>}
    </header>
  );
}
