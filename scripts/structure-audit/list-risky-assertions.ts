#!/usr/bin/env bun
// D9: lists `as <T>` casts outside tests, excluding `as const` and `as unknown`.
// Informational — output goes into deferred-backlog as type-safety debt.
// No exit-non-zero behaviour. Always exits 0.

import { auditOutputPath, iterateSourceFiles } from "./lib.ts";

export type Hit = { file: string; line: number; snippet: string };

// Match `as <Type>` where Type is NOT `const` or `unknown`.
// Type is one alphanum-or-`_` token (good enough for the audit; misses generics like `as Foo<Bar>`,
// which is acceptable — generic-cast cases are rare and would need an AST to do precisely).
const RE = /\bas\s+(?!const\b|unknown\b)([A-Za-z_][A-Za-z0-9_]*)/g;

export function findRiskyAssertions(file: string, src: string): Hit[] {
  const hits: Hit[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    RE.lastIndex = 0;
    let m = RE.exec(line);
    while (m !== null) {
      hits.push({ file, line: i + 1, snippet: line.trim() });
      m = RE.exec(line);
    }
  }
  return hits;
}

async function run(): Promise<void> {
  const all: Hit[] = [];
  for await (const f of iterateSourceFiles()) {
    all.push(...findRiskyAssertions(f.relPath, f.contents));
  }
  // Sort by file, line.
  all.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const outPath = auditOutputPath("risky-assertions.json");
  await Bun.write(outPath, `${JSON.stringify(all, null, 2)}\n`);
  console.log(`risky assertions: ${all.length} → ${outPath}`);
}

if (import.meta.main) await run();
