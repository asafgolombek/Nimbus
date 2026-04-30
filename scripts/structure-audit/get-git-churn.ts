#!/usr/bin/env bun
// Ranking-evidence helper: 90-day commit count per packages/*/src/**.ts file.
// Output: docs/structure-audit/churn-90d.json
// {
//   files: [{ file, commits90d }, ...],   // sorted descending
//   p80Threshold: number,                  // 80th-percentile cutoff for impact-score 4
// }

import { auditOutputPath, iterateSourceFiles, REPO_ROOT } from "./lib.ts";

export function computePercentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank (inclusive): index = ceil(p/100 * N) - 1, clamped to [0, N-1].
  // For [1..10] p80 → index 7 → value 8 (matches the documented contract).
  const ascending = [...sorted].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * ascending.length);
  const idx = Math.min(Math.max(rank - 1, 0), ascending.length - 1);
  return ascending[idx] ?? 0;
}

/**
 * One `git log` invocation that returns every changed-file path in the last
 * 90 days; we count occurrences per-path. Strictly better than per-file
 * `git rev-list` (which spawns ~500 processes on this monorepo, ~30 s of
 * pure spawn overhead).
 */
function buildChurnMap(): Map<string, number> {
  const proc = Bun.spawnSync(
    ["git", "log", "--since=90 days ago", "--name-only", "--pretty=format:"],
    { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) return new Map();
  const text = new TextDecoder().decode(proc.stdout);
  const counts = new Map<string, number>();
  for (const raw of text.split("\n")) {
    const file = raw.trim();
    if (!file) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

async function run(): Promise<void> {
  const churn = buildChurnMap();
  const files: Array<{ file: string; commits90d: number }> = [];
  for await (const f of iterateSourceFiles()) {
    files.push({ file: f.relPath, commits90d: churn.get(f.relPath) ?? 0 });
  }
  files.sort((a, b) => b.commits90d - a.commits90d);
  const counts = files.map((e) => e.commits90d);
  const p80Threshold = computePercentile(counts, 80);
  const outPath = auditOutputPath("churn-90d.json");
  await Bun.write(outPath, `${JSON.stringify({ files, p80Threshold }, null, 2)}\n`);
  console.log(`churn report: ${files.length} files; p80 = ${p80Threshold}; → ${outPath}`);
  console.log(`Top 10 most-changed:`);
  for (const e of files.slice(0, 10)) console.log(`  ${e.commits90d}\t${e.file}`);
}

if (import.meta.main) await run();
