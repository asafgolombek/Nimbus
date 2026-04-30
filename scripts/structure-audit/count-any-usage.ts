#!/usr/bin/env bun
// D8: counts `any`/`as any`/`<any>` in packages/*/src/** excluding tests.
//
// Modes:
//   --check   exit non-zero on regression OR reduction (CI mode); read baseline file
//   --update  rewrite the baseline file with the current count (local-only; never CI)
//   (default) print the current count and per-file breakdown to stdout
//
// Flags:
//   --baseline <path>   override path to baseline JSON (default: docs/structure-audit/any-baseline.json)
//   --source <path>     override packages/*/src root (default: REPO_ROOT/packages); for tests
//
// Exit codes:
//   0  baseline matches current count (--check) or update succeeded (--update)
//   1  regression: current > baseline, OR reduction without --update: current < baseline
//   2  usage error

import { auditOutputPath, countAnyInSource, iterateSourceFiles } from "./lib.ts";

type Mode = "check" | "update" | "print";

function parseArgs(argv: readonly string[]): {
  mode: Mode;
  baselinePath: string;
} {
  let mode: Mode = "print";
  let baselinePath = auditOutputPath("any-baseline.json");
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") mode = "check";
    else if (a === "--update") mode = "update";
    else if (a === "--baseline") baselinePath = argv[++i] ?? baselinePath;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return { mode, baselinePath };
}

async function run(): Promise<void> {
  const { mode, baselinePath } = parseArgs(Bun.argv);

  let total = 0;
  const perFile: Array<{ relPath: string; count: number }> = [];

  for await (const file of iterateSourceFiles()) {
    const c = countAnyInSource(file.contents);
    if (c > 0) perFile.push({ relPath: file.relPath, count: c });
    total += c;
  }

  perFile.sort((a, b) => b.count - a.count);

  if (mode === "print") {
    console.log(`Total \`any\` count: ${total}`);
    console.log(`Per-file (top 20):`);
    for (const e of perFile.slice(0, 20)) console.log(`  ${e.count}\t${e.relPath}`);
    return;
  }

  if (mode === "update") {
    await Bun.write(
      baselinePath,
      `${JSON.stringify({ count: total, generated: new Date().toISOString() }, null, 2)}\n`,
    );
    console.log(`Wrote baseline: ${total} → ${baselinePath}`);
    return;
  }

  // mode === "check"
  const baselineFile = Bun.file(baselinePath);
  if (!(await baselineFile.exists())) {
    console.error(`baseline file not found: ${baselinePath}`);
    console.error(
      `run \`bun run scripts/structure-audit/count-any-usage.ts --update\` to create it`,
    );
    process.exit(2);
  }
  const baseline = (await baselineFile.json()) as { count: number };

  if (total > baseline.count) {
    console.error(`::error::any count regressed: ${total} > baseline ${baseline.count}`);
    console.error(`Top offending files:`);
    for (const e of perFile.slice(0, 10)) console.error(`  ${e.count}\t${e.relPath}`);
    process.exit(1);
  }
  if (total < baseline.count) {
    console.error(
      `::error::any count reduced (${total} < ${baseline.count}). Update the baseline:`,
    );
    console.error(`  bun run scripts/structure-audit/count-any-usage.ts --update`);
    console.error(`then commit docs/structure-audit/any-baseline.json in the same PR.`);
    process.exit(1);
  }
  console.log(`any count: ${total} (matches baseline)`);
}

await run();
