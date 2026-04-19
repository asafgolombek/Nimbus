import type { ReactNode } from "react";
import { useNimbusStore } from "../../store";
import { ProfileHealthPill } from "./ProfileHealthPill";

interface Props {
  title: string;
  profile?: string;
}

export function PageHeader({ title, profile = "default" }: Props): ReactNode {
  const aggregateHealth = useNimbusStore((s) => s.trayIcon);
  return (
    <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--color-border)]">
      <h1 className="text-base font-medium text-[var(--color-fg)]">{title}</h1>
      <ProfileHealthPill profile={profile} aggregateHealth={aggregateHealth} />
    </header>
  );
}
