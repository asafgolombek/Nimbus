import { PanelHeader } from "./PanelHeader";

export interface PanelComingSoonProps {
  readonly title: string;
}

export function PanelComingSoon({ title }: PanelComingSoonProps) {
  return (
    <section className="p-6">
      <PanelHeader title={title} description="Coming soon — ships in a follow-up WS5-C plan." />
      <div className="mt-8 p-6 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          This panel is not yet implemented. Track progress in <code>docs/roadmap.md</code>.
        </p>
      </div>
    </section>
  );
}
