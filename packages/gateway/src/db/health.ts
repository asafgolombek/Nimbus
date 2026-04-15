/**
 * Disk space monitoring — two complementary triggers:
 *
 *  1. Polling  — runs at Gateway startup and every N hours (default: 6).
 *                Uses `fs.statfsSync` to get available bytes for the volume
 *                that holds `dataDir`.
 *
 *  2. Reactive — `SQLITE_FULL` is caught by `db/write.ts`; that module calls
 *                `setDiskSpaceWarning(true)` synchronously, which this module
 *                also exports so callers see a unified interface.
 *
 * The warning flag (readable via `isDiskSpaceWarning()`) is consumed by
 * `nimbus status` and by the scheduler to pause sync when disk is full.
 */

import { readdirSync, statfsSync, statSync } from "node:fs";
import { join } from "node:path";
import { onDiskFull, setDiskSpaceWarning } from "./write.ts";

// Re-export so callers only need to import from db/health.ts
export { isDiskSpaceWarning, setDiskSpaceWarning } from "./write.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiskSpaceCheck = {
  indexSizeBytes: number;
  snapshotsSizeBytes: number;
  availableBytes: number;
  /** (indexSizeBytes + snapshotsSizeBytes) / (used + available) as 0–100 */
  usedPercent: number;
  thresholdPercent: number;
  exceeded: boolean;
};

export type DiskMonitorConfig = {
  /** Polling interval in hours; default 6. */
  checkIntervalHours: number;
  /** Warn when Nimbus data exceeds this % of total volume; default 80. */
  thresholdPercent: number;
};

export const DEFAULT_DISK_MONITOR_CONFIG: DiskMonitorConfig = {
  checkIntervalHours: 6,
  thresholdPercent: 80,
};

// ─── File-size helpers ────────────────────────────────────────────────────────

function dirSizeBytes(dir: string): number {
  let total = 0;
  try {
    for (const name of readdirSync(dir)) {
      try {
        total += statSync(join(dir, name)).size;
      } catch {
        /* skip unreadable entries */
      }
    }
  } catch {
    /* directory may not exist */
  }
  return total;
}

function dbFileSizeBytes(dataDir: string): number {
  try {
    return statSync(join(dataDir, "nimbus.db")).size;
  } catch {
    return 0;
  }
}

// ─── Core check ──────────────────────────────────────────────────────────────

/**
 * Inspect disk usage for the volume that contains `dataDir`.
 *
 * `statfsSync` is available in Node ≥ 19.6 / Bun ≥ 1.0 on all three platforms:
 *  - Linux/macOS: wraps `statvfs(2)`
 *  - Windows:     wraps `GetDiskFreeSpaceEx`
 */
export function checkDiskSpace(
  dataDir: string,
  thresholdPercent = DEFAULT_DISK_MONITOR_CONFIG.thresholdPercent,
): DiskSpaceCheck {
  let availableBytes = 0;
  let totalBytes = 0;

  try {
    const stats = statfsSync(dataDir);
    // bavail = blocks available to unprivileged users; bsize = block size in bytes
    availableBytes = stats.bavail * stats.bsize;
    totalBytes = stats.blocks * stats.bsize;
  } catch {
    /* statfsSync may not be available in all Bun versions; fall back gracefully */
  }

  const indexSizeBytes = dbFileSizeBytes(dataDir);
  const snapshotsSizeBytes = dirSizeBytes(join(dataDir, "snapshots"));
  const nimbusBytes = indexSizeBytes + snapshotsSizeBytes;

  const usedPercent = totalBytes > 0 ? Math.round((nimbusBytes / totalBytes) * 100) : 0;

  const exceeded = usedPercent >= thresholdPercent;

  return {
    indexSizeBytes,
    snapshotsSizeBytes,
    availableBytes,
    usedPercent,
    thresholdPercent,
    exceeded,
  };
}

// ─── Monitor lifecycle ────────────────────────────────────────────────────────

type DiskMonitorHandle = { stop: () => void };

/**
 * Start the polling disk-space monitor and register for reactive `SQLITE_FULL`
 * notifications from `db/write.ts`.
 *
 * Both triggers converge on `setDiskSpaceWarning(true)` and call `onWarning`
 * exactly once per `false → true` transition.
 *
 * @param dataDir    Platform data directory.
 * @param config     Monitor configuration.
 * @param onWarning  Called once when the warning transitions from false to true.
 * @returns A handle whose `stop()` clears the polling interval.
 */
export function startDiskMonitor(
  dataDir: string,
  config: DiskMonitorConfig = DEFAULT_DISK_MONITOR_CONFIG,
  onWarning?: (check: DiskSpaceCheck) => void,
): DiskMonitorHandle {
  function runCheck(): void {
    const check = checkDiskSpace(dataDir, config.thresholdPercent);
    if (check.exceeded) {
      // setDiskSpaceWarning fires onDiskFull listeners only on false→true transition
      setDiskSpaceWarning(true);
      onWarning?.(check);
    }
  }

  // Register reactive path (SQLITE_FULL from write wrapper)
  const unregister = onDiskFull(() => {
    const check = checkDiskSpace(dataDir, config.thresholdPercent);
    onWarning?.(check);
  });

  // Startup check
  runCheck();

  const intervalMs = config.checkIntervalHours * 60 * 60 * 1000;
  const handle = setInterval(runCheck, intervalMs);

  return {
    stop(): void {
      clearInterval(handle);
      unregister();
    },
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function humanBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDiskSpaceCheck(check: DiskSpaceCheck): string {
  const status = check.exceeded ? "⚠ WARNING" : "ok";
  return [
    `Disk space:      ${status}`,
    `  Index:         ${humanBytes(check.indexSizeBytes)}`,
    `  Snapshots:     ${humanBytes(check.snapshotsSizeBytes)}`,
    `  Available:     ${humanBytes(check.availableBytes)}`,
    `  Usage:         ${String(check.usedPercent)}% (threshold ${String(check.thresholdPercent)}%)`,
  ].join("\n");
}
