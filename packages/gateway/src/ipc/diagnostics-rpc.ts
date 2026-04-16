/**
 * JSON-RPC handlers for index diagnostics, `nimbus db *`, structured query, and `nimbus diag`.
 */

import type { Database } from "bun:sqlite";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { listWatchers } from "../automation/watcher-store.ts";
import { getAllConnectorHealth } from "../connectors/health.ts";
import { asRecord } from "../connectors/unknown-record.ts";
import { listMigrationBackups } from "../db/backups-list.ts";
import { collectIndexMetrics } from "../db/metrics.ts";
import { runReadOnlySelect, SqlGuardError } from "../db/query-guard.ts";
import { formatRepairReport, repairIndex } from "../db/repair.ts";
import { listSnapshots, previewRestore, pruneSnapshots, takeSnapshot } from "../db/snapshot.ts";
import { formatVerifyResult, verifyIndex } from "../db/verify.ts";
import { buildItemListSql } from "../index/item-list-query.ts";
import type { LocalIndex } from "../index/local-index.ts";
import { LocalIndex as LocalIndexClass } from "../index/local-index.ts";
import { buildTelemetryPreview } from "../telemetry/collector.ts";
import type { ConsentCoordinator } from "./consent.ts";

export class DiagnosticsRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "DiagnosticsRpcError";
  }
}

export type DiagnosticsRpcContext = {
  readonly dataDir: string;
  readonly configDir: string;
  readonly localIndex?: LocalIndex;
  readonly consent: ConsentCoordinator;
  readonly gatewayVersion: string;
  readonly startedAtMs: number;
};

function requireLocalIndex(ctx: DiagnosticsRpcContext): LocalIndex {
  const li = ctx.localIndex;
  if (li === undefined) {
    throw new DiagnosticsRpcError(-32603, "Local index is not available");
  }
  return li;
}

function requireDb(ctx: DiagnosticsRpcContext): Database {
  return requireLocalIndex(ctx).getDatabase();
}

function serializeHealthSnapshot(
  s: import("../connectors/health.ts").ConnectorHealthSnapshot,
): Record<string, unknown> {
  const o: Record<string, unknown> = {
    connectorId: s.connectorId,
    state: s.state,
    backoffAttempt: s.backoffAttempt,
  };
  if (s.retryAfter !== undefined) {
    o["retryAfterMs"] = s.retryAfter.getTime();
  }
  if (s.backoffUntil !== undefined) {
    o["backoffUntilMs"] = s.backoffUntil.getTime();
  }
  if (s.lastError !== undefined) {
    o["lastError"] = s.lastError;
  }
  if (s.lastSuccessfulSync !== undefined) {
    o["lastSuccessfulSyncMs"] = s.lastSuccessfulSync.getTime();
  }
  if (s.lastSyncAttempt !== undefined) {
    o["lastSyncAttemptMs"] = s.lastSyncAttempt.getTime();
  }
  return o;
}

function serializeMetrics(db: Database): Record<string, unknown> {
  const m = collectIndexMetrics(db);
  const lastSync: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(m.lastSuccessfulSyncByConnector)) {
    lastSync[k] = v === null ? null : v.getTime();
  }
  return {
    itemCountByService: m.itemCountByService,
    totalItems: m.totalItems,
    indexSizeBytes: m.indexSizeBytes,
    embeddingCoveragePercent: m.embeddingCoveragePercent,
    lastSuccessfulSyncByConnector: lastSync,
    queryLatencyP50Ms: m.queryLatencyP50Ms,
    queryLatencyP95Ms: m.queryLatencyP95Ms,
    queryLatencyP99Ms: m.queryLatencyP99Ms,
  };
}

type DiagnosticsRpcOutcome = { kind: "hit"; value: unknown } | { kind: "miss" };

function rpcConfigValidate(ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const p = join(ctx.configDir, "nimbus.toml");
  if (!existsSync(p)) {
    return {
      kind: "hit",
      value: { ok: false, errors: ["nimbus.toml not found"], warnings: [] },
    };
  }
  const raw = readFileSync(p, "utf8");
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/\bschema_version\b\s*=\s*\d+/.test(raw)) {
    warnings.push(
      "schema_version = <integer> is recommended in nimbus.toml (Phase 3.5); missing key uses legacy defaults",
    );
  }
  return { kind: "hit", value: { ok: errors.length === 0, errors, warnings } };
}

function assertTelemetryDisablePathSafe(path: string): void {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) {
      throw new DiagnosticsRpcError(-32603, "Refusing to write telemetry marker: path is a symlink");
    }
  } catch (e: unknown) {
    if (e instanceof DiagnosticsRpcError) {
      throw e;
    }
    if (e !== null && typeof e === "object" && "code" in e && (e as { code: unknown }).code === "ENOENT") {
      return;
    }
    throw e;
  }
}

function rpcTelemetryDisableMark(ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const p = join(ctx.dataDir, ".nimbus-telemetry-disabled");
  assertTelemetryDisablePathSafe(p);
  writeFileSync(p, `${String(Date.now())}\n`);
  return { kind: "hit", value: { ok: true } };
}

function rpcDbVerify(ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const r = verifyIndex(requireDb(ctx), LocalIndexClass.SCHEMA_VERSION);
  return {
    kind: "hit",
    value: {
      clean: r.clean,
      findings: r.findings,
      formatted: formatVerifyResult(r).output,
      exitCode: formatVerifyResult(r).exitCode,
    },
  };
}

function rpcDbRepair(params: unknown, ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const rec = asRecord(params);
  const confirm = rec?.["confirm"] === true;
  if (!confirm) {
    throw new DiagnosticsRpcError(-32602, "Repair requires confirm: true (CLI: pass --yes)");
  }
  const report = repairIndex(requireDb(ctx), LocalIndexClass.SCHEMA_VERSION);
  return { kind: "hit", value: { report, formatted: formatRepairReport(report) } };
}

function rpcDbSnapshotTake(ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const path = takeSnapshot(requireDb(ctx), ctx.dataDir);
  return { kind: "hit", value: { path } };
}

function rpcDbSnapshotsList(ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const entries = listSnapshots(ctx.dataDir);
  return {
    kind: "hit",
    value: entries.map((e) => ({
      filename: e.filename,
      timestampMs: e.timestampMs,
      compressedSizeBytes: e.compressedSizeBytes,
      path: e.path,
    })),
  };
}

function rpcDbBackupsList(ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  return { kind: "hit", value: listMigrationBackups(ctx.dataDir) };
}

function rpcDbSnapshotsPrune(params: unknown, ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const rec = asRecord(params);
  if (rec?.["confirm"] !== true) {
    throw new DiagnosticsRpcError(-32602, "Prune requires confirm: true (CLI: pass --yes)");
  }
  const keepRaw = rec?.["keepLast"];
  const keepLast =
    typeof keepRaw === "number" && Number.isFinite(keepRaw)
      ? Math.min(100, Math.max(1, Math.floor(keepRaw)))
      : 7;
  const deleted = pruneSnapshots(ctx.dataDir, keepLast);
  return { kind: "hit", value: { deleted, keepLast } };
}

function rpcDbRestorePreview(params: unknown, ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const rec = asRecord(params);
  const path = typeof rec?.["path"] === "string" ? rec["path"].trim() : "";
  if (path === "") {
    throw new DiagnosticsRpcError(-32602, "Missing path");
  }
  const preview = previewRestore(requireDb(ctx), path);
  return { kind: "hit", value: preview };
}

function rpcIndexMetrics(ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  return { kind: "hit", value: serializeMetrics(requireDb(ctx)) };
}

function rpcIndexQueryItems(params: unknown, ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const rec = asRecord(params);
  const rawSinceMs = rec?.["sinceMs"];
  const sinceMs =
    typeof rawSinceMs === "number" && Number.isFinite(rawSinceMs)
      ? Math.floor(rawSinceMs)
      : undefined;
  const rawUntilMs = rec?.["untilMs"];
  const untilMs =
    typeof rawUntilMs === "number" && Number.isFinite(rawUntilMs)
      ? Math.floor(rawUntilMs)
      : undefined;
  const limitRaw = rec?.["limit"];
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.min(1000, Math.max(1, Math.floor(limitRaw)))
      : 50;
  const services = Array.isArray(rec?.["services"])
    ? (rec["services"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const types = Array.isArray(rec?.["types"])
    ? (rec["types"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const d = requireDb(ctx);
  const { sql, vals } = buildItemListSql({
    services,
    types,
    limit,
    ...(sinceMs === undefined ? {} : { sinceMs }),
    ...(untilMs === undefined ? {} : { untilMs }),
  });
  const rows = d.query(sql).all(...vals) as Record<string, unknown>[];
  return { kind: "hit", value: { items: rows, meta: { limit, total: rows.length } } };
}

function rpcIndexQuerySql(params: unknown, ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const rec = asRecord(params);
  const sql = typeof rec?.["sql"] === "string" ? rec["sql"] : "";
  try {
    const dbPath = join(ctx.dataDir, "nimbus.db");
    const rows = runReadOnlySelect(dbPath, sql);
    return { kind: "hit", value: { rows, meta: { count: rows.length } } };
  } catch (e) {
    if (e instanceof SqlGuardError) {
      throw new DiagnosticsRpcError(-32602, e.message);
    }
    throw e;
  }
}

function rpcDiagSlowQueries(params: unknown, ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const rec = asRecord(params);
  let limit = 50;
  if (rec !== undefined && typeof rec["limit"] === "number" && Number.isFinite(rec["limit"])) {
    limit = Math.min(500, Math.max(1, Math.floor(rec["limit"])));
  }
  const rawSinceSlow = rec?.["sinceMs"];
  const sinceMs =
    typeof rawSinceSlow === "number" && Number.isFinite(rawSinceSlow)
      ? Math.floor(rawSinceSlow)
      : 0;
  const d = requireDb(ctx);
  const hasTable = d
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='slow_query_log'")
    .get() as { 1: number } | null;
  if (hasTable === null) {
    return { kind: "hit", value: { rows: [] } };
  }
  const rows = d
    .query(
      `SELECT id, query_text, latency_ms, query_type, recorded_at
           FROM slow_query_log WHERE recorded_at >= ? ORDER BY recorded_at DESC LIMIT ?`,
    )
    .all(sinceMs, limit) as Record<string, unknown>[];
  return { kind: "hit", value: { rows } };
}

function rpcTelemetryPreview(ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  if (existsSync(join(ctx.dataDir, ".nimbus-telemetry-disabled"))) {
    return {
      kind: "hit",
      value: {
        disabled: true,
        message: "Telemetry disabled via nimbus telemetry disable (local marker file).",
      },
    };
  }
  const d = requireDb(ctx);
  const m = collectIndexMetrics(d);
  return {
    kind: "hit",
    value: buildTelemetryPreview({
      nimbusVersion: ctx.gatewayVersion,
      queryLatencyP50Ms: m.queryLatencyP50Ms,
      queryLatencyP95Ms: m.queryLatencyP95Ms,
      queryLatencyP99Ms: m.queryLatencyP99Ms,
      db: d,
    }),
  };
}

function rpcDiagSnapshot(ctx: DiagnosticsRpcContext): DiagnosticsRpcOutcome {
  const d = requireDb(ctx);
  const health = getAllConnectorHealth(d).map(serializeHealthSnapshot);
  const metrics = serializeMetrics(d);
  const audit = requireLocalIndex(ctx).listAudit(10);
  const watchers = listWatchers(d).map((w) => ({
    id: w.id,
    name: w.name,
    enabled: w.enabled === 1,
    lastFiredAtMs: w.last_fired_at,
  }));
  const pendingConsent = ctx.consent.pendingCount();
  return {
    kind: "hit",
    value: {
      gateway: {
        version: ctx.gatewayVersion,
        uptimeMs: Date.now() - ctx.startedAtMs,
      },
      connectorHealth: health,
      index: metrics,
      hitl: { pendingConsentRequests: pendingConsent },
      watchers,
      auditLogTail: audit,
    },
  };
}

export function dispatchDiagnosticsRpc(
  method: string,
  params: unknown,
  ctx: DiagnosticsRpcContext,
): DiagnosticsRpcOutcome {
  switch (method) {
    case "config.validate":
      return rpcConfigValidate(ctx);
    case "telemetry.disableMark":
      return rpcTelemetryDisableMark(ctx);
    case "db.verify":
      return rpcDbVerify(ctx);
    case "db.repair":
      return rpcDbRepair(params, ctx);
    case "db.snapshot.take":
      return rpcDbSnapshotTake(ctx);
    case "db.snapshots.list":
      return rpcDbSnapshotsList(ctx);
    case "db.backups.list":
      return rpcDbBackupsList(ctx);
    case "db.snapshots.prune":
      return rpcDbSnapshotsPrune(params, ctx);
    case "db.restore.preview":
      return rpcDbRestorePreview(params, ctx);
    case "index.metrics":
      return rpcIndexMetrics(ctx);
    case "index.queryItems":
      return rpcIndexQueryItems(params, ctx);
    case "index.querySql":
      return rpcIndexQuerySql(params, ctx);
    case "diag.slowQueries":
      return rpcDiagSlowQueries(params, ctx);
    case "telemetry.preview":
      return rpcTelemetryPreview(ctx);
    case "diag.snapshot":
      return rpcDiagSnapshot(ctx);
    default:
      return { kind: "miss" };
  }
}
