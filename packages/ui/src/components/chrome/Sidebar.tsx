import type { ReactNode } from "react";
import { useNimbusStore } from "../../store";
import { NavItem } from "./NavItem";

const ENTRIES: ReadonlyArray<{ to: string; icon: string; label: string }> = [
  { to: "/", icon: "▦", label: "Dashboard" },
  { to: "/hitl", icon: "⚠", label: "HITL" },
  { to: "/marketplace", icon: "⚙", label: "Marketplace" },
  { to: "/watchers", icon: "👁", label: "Watchers" },
  { to: "/workflows", icon: "▶", label: "Workflows" },
  { to: "/settings", icon: "⚙", label: "Settings" },
];

export function Sidebar(): ReactNode {
  const pendingHitl = useNimbusStore((s) => s.pendingHitl);
  return (
    <nav
      aria-label="Primary"
      className="w-[150px] bg-[var(--color-bg)] border-r border-[var(--color-border)] py-2 flex flex-col"
    >
      {ENTRIES.map((e) => (
        <NavItem
          key={e.to}
          to={e.to}
          icon={e.icon}
          label={e.label}
          badge={e.to === "/hitl" ? pendingHitl : undefined}
        />
      ))}
    </nav>
  );
}
