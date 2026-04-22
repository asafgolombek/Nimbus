import type { ReactNode } from "react";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import type { IndexMetrics } from "../../ipc/types";
import { formatBytes, formatCount, formatMs, formatPercent } from "./format";

function Tile({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md p-4">
      <div className="text-[var(--color-fg)] text-2xl font-medium">{value}</div>
      <div className="text-[var(--color-fg-muted)] text-xs mt-1">{label}</div>
    </div>
  );
}

export function IndexMetricsStrip(): ReactNode {
  const { data } = useIpcQuery<IndexMetrics>("index.metrics", 30_000);
  const items = data ? formatCount(data.itemsTotal) : "—";
  const cov = data ? formatPercent(data.embeddingCoveragePct) : "—";
  const p95 = data ? formatMs(data.queryP95Ms) : "—";
  const size = data ? formatBytes(data.indexSizeBytes) : "—";
  return (
    <section className="grid grid-cols-4 gap-4" aria-label="Index metrics">
      <Tile label="items" value={items} />
      <Tile label="embeddings" value={cov} />
      <Tile label="p95 query" value={p95} />
      <Tile label="index size" value={size} />
    </section>
  );
}
