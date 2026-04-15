import type { Database } from "bun:sqlite";
import type { ConnectorHealthSnapshot } from "../connectors/health.ts";
import { getConnectorHealth } from "../connectors/health.ts";

import type { ContextWindow } from "./context-ranker.ts";

/**
 * When the user scopes search to a single connector, surface non-healthy sync state
 * so the model can caveat incomplete results (Phase 3.5 roadmap).
 */
export function formatConnectorHealthCaveatForIndexSearch(
  serviceId: string,
  h: ConnectorHealthSnapshot,
): string | undefined {
  if (h.state === "healthy") {
    return undefined;
  }
  if (h.state === "paused") {
    return `The ${serviceId} connector is paused — index results for this service may be stale until you run nimbus connector resume ${serviceId}.`;
  }
  const human = h.state.replaceAll("_", " ");
  const parts: string[] = [
    `The ${serviceId} connector is currently ${human} — results drawn from this service may be incomplete or stale.`,
  ];
  if (h.state === "rate_limited" && h.retryAfter !== undefined) {
    parts.push(`Retry after: ${h.retryAfter.toISOString()}.`);
  }
  if (h.lastSuccessfulSync !== undefined) {
    parts.push(`Last successful sync: ${h.lastSuccessfulSync.toISOString()}.`);
  }
  if (h.lastError !== undefined && h.lastError !== "") {
    parts.push(`Last error: ${h.lastError.slice(0, 240)}`);
  }
  return parts.join(" ");
}

/**
 * Build caveat strings for a list of connector ids (stable order, capped).
 */
export function collectConnectorHealthCaveatsForServices(
  db: Database,
  serviceIds: readonly string[],
  max: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of serviceIds) {
    const sid = raw.trim();
    if (sid === "" || seen.has(sid)) {
      continue;
    }
    seen.add(sid);
    if (out.length >= max) {
      break;
    }
    const c = formatConnectorHealthCaveatForIndexSearch(sid, getConnectorHealth(db, sid));
    if (c !== undefined) {
      out.push(c);
    }
  }
  return out;
}

/**
 * `searchLocalIndex` tool: single `connectorHealthCaveat` when `service` filter is set;
 * otherwise `connectorHealthCaveats` for any non-healthy services present in the context window.
 */
export function buildSearchLocalIndexHealthExtras(
  db: Database,
  window: ContextWindow,
  filteredService: string | undefined,
): { connectorHealthCaveat?: string; connectorHealthCaveats?: string[] } {
  const scoped =
    filteredService !== undefined && filteredService !== "" ? filteredService : undefined;
  if (scoped === undefined) {
    const services = new Set<string>();
    for (const it of window.items) {
      if (it.service !== "") {
        services.add(it.service);
      }
    }
    for (const g of window.sourceSummary) {
      if (g.service !== "") {
        services.add(g.service);
      }
    }
    const ordered = [...services].sort((a, b) => a.localeCompare(b));
    const caveats = collectConnectorHealthCaveatsForServices(db, ordered, 5);
    return caveats.length > 0 ? { connectorHealthCaveats: caveats } : {};
  }
  const c = formatConnectorHealthCaveatForIndexSearch(scoped, getConnectorHealth(db, scoped));
  if (c === undefined) {
    return {};
  }
  return { connectorHealthCaveat: c };
}
