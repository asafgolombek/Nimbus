/**
 * Prometheus-compatible metrics on localhost only (Phase 3.5).
 * Uses the live gateway DB handle for accurate in-memory latency samples.
 */

import type { Database } from "bun:sqlite";
import { getAllConnectorHealth } from "../connectors/health.ts";
import { collectIndexMetrics } from "../db/metrics.ts";

export type MetricsServerHandle = {
  readonly stop: () => void;
};

function escapeLabel(s: string): string {
  return s.replaceAll("\\", "\\\\").replaceAll('"', String.raw`\"`).replaceAll("\n", " ");
}

/**
 * @param getDb Returns the gateway's primary SQLite handle (read queries only).
 */
export function startMetricsServer(getDb: () => Database, port: number): MetricsServerHandle {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req: Request): Response {
      const url = new URL(req.url);
      if (url.pathname === "/healthz") {
        return new Response("ok\n", { status: 200 });
      }
      if (url.pathname !== "/metrics") {
        return new Response("Not Found", { status: 404 });
      }
      const db = getDb();
      const m = collectIndexMetrics(db);
      const lines: string[] = [];
      lines.push("# HELP nimbus_index_items_total Items in the local index by service");
      lines.push("# TYPE nimbus_index_items_total gauge");
      for (const [svc, n] of Object.entries(m.itemCountByService)) {
        lines.push(`nimbus_index_items_total{service="${escapeLabel(svc)}"} ${String(n)}`);
      }
      lines.push("# HELP nimbus_index_size_bytes On-disk SQLite size estimate (bytes)");
      lines.push("# TYPE nimbus_index_size_bytes gauge");
      lines.push(`nimbus_index_size_bytes ${String(m.indexSizeBytes)}`);
      lines.push(
        "# HELP nimbus_embedding_coverage_ratio Share of items with at least one embedding chunk",
      );
      lines.push("# TYPE nimbus_embedding_coverage_ratio gauge");
      lines.push(`nimbus_embedding_coverage_ratio ${String(m.embeddingCoveragePercent / 100)}`);
      lines.push("# HELP nimbus_query_latency_ms Query latency from ring buffer or recent log");
      lines.push("# TYPE nimbus_query_latency_ms gauge");
      lines.push(`nimbus_query_latency_ms{quantile="p50"} ${String(m.queryLatencyP50Ms)}`);
      lines.push(`nimbus_query_latency_ms{quantile="p95"} ${String(m.queryLatencyP95Ms)}`);
      lines.push(`nimbus_query_latency_ms{quantile="p99"} ${String(m.queryLatencyP99Ms)}`);

      const health = getAllConnectorHealth(db);
      lines.push("# HELP nimbus_connector_health_state 1 if connector is in the given state");
      lines.push("# TYPE nimbus_connector_health_state gauge");
      for (const h of health) {
        lines.push(
          `nimbus_connector_health_state{connector="${escapeLabel(h.connectorId)}",state="${escapeLabel(h.state)}"} 1`,
        );
      }

      return new Response(`${lines.join("\n")}\n`, {
        status: 200,
        headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
      });
    },
  });

  return {
    stop(): void {
      try {
        server.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
