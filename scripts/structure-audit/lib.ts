// Shared helpers for the B3 structure-audit scripts.
// Kept small on purpose: filesystem walk, comment stripping, repo-root resolution.

import { join, resolve } from "node:path";
import { Glob } from "bun";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");

/**
 * Strips `//`-line comments and block comments from a source string.
 * String-literal-aware: a `//` or `/*` *inside* a `"…"`, `'…'`, or `` `…` ``
 * literal is preserved (so URLs like `"https://x"` survive). Escape sequences
 * (`\"`, `` \` ``) are honoured. Template-literal `${…}` interpolation is treated
 * as part of the template string for this script's purposes — we don't need to
 * recurse into the expression because comments inside an expression are also
 * not in code we want to strip from the count.
 *
 * Newline-preserving: line comments are replaced by a single trailing `\n`
 * (the loop emits the newline on the next pass), and block comments are
 * replaced by exactly the newlines they contained. Downstream callers that
 * map regex matches back to line numbers (D9) therefore stay correct even
 * when a multi-line block comment precedes a real cast.
 *
 * Not a full TypeScript tokenizer. The audit's contract is "stable count across
 * runs"; this implementation also satisfies "doesn't strip from string contents".
 *
 * KNOWN LIMITATIONS: Regex literals are not tracked. A regex literal
 * containing `//` (e.g. `/\/\//g`) can be misclassified as the start of a
 * line comment, swallowing downstream code. No first-party source currently
 * exercises this case.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let inString: '"' | "'" | "`" | null = null;
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") {
        // Include the escaped char as-is (handles \", \\, \n, \`, etc.).
        if (next !== undefined) out += next;
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) break;
      // Preserve newlines inside the block so downstream line-number
      // reporting stays correct (D9 maps regex hits back to line numbers).
      const block = src.slice(i, end + 2);
      for (let j = 0; j < block.length; j++) {
        if (block[j] === "\n") out += "\n";
      }
      i = end + 2;
      continue;
    }
    if (c === "/" && next === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Counts whole-word `any` occurrences in TypeScript source after stripping
 * comments. Used by D8 (count-any-usage). Non-AST — see stripComments docs.
 */
export function countAnyInSource(src: string): number {
  const stripped = stripComments(src);
  const matches = stripped.match(/\bany\b/g);
  return matches ? matches.length : 0;
}

/**
 * Iterates TypeScript source files under packages/&#42;/src/&#42;&#42; and
 * packages/mcp-connectors/&#42;/src/&#42;&#42;, excluding test files. Test files are
 * excluded because the `any` count and risky-assertion scans should reflect
 * production code only.
 *
 * Two globs are scanned because Bun.Glob's single `*` matches one path
 * segment, so `packages/*&#47;src/**` would miss connector sources nested under
 * `packages/mcp-connectors/<name>/src/**`. Results are deduplicated via a
 * `Set` (defensive — the two globs don't currently overlap, but workspace
 * renames could change that).
 *
 * Paths are normalized to forward slashes at the top of the loop because
 * `Bun.Glob.scan` returns OS-native separators on Windows (`\\`), and the
 * downstream `relPath.includes("/__fixtures__/")` filters are POSIX-shaped.
 * `path.join` accepts forward slashes on Windows, so the absolute path
 * construction stays correct.
 */
export async function* iterateSourceFiles(): AsyncGenerator<{
  path: string;
  relPath: string;
  contents: string;
}> {
  const globs = [
    new Glob("packages/*/src/**/*.ts"),
    new Glob("packages/mcp-connectors/*/src/**/*.ts"),
  ];
  const seen = new Set<string>();
  for (const glob of globs) {
    for await (const rawRelPath of glob.scan({ cwd: REPO_ROOT })) {
      const relPath = rawRelPath.replaceAll("\\", "/");
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      if (relPath.endsWith(".test.ts")) continue;
      if (relPath.endsWith("-sql.ts")) continue;
      if (relPath.endsWith(".d.ts")) continue;
      if (relPath.includes("/__fixtures__/")) continue;
      if (relPath.includes("/test/fixtures/")) continue;
      const path = join(REPO_ROOT, relPath);
      const contents = await Bun.file(path).text();
      yield { path, relPath, contents };
    }
  }
}

/**
 * Path under docs/structure-audit/ for committed audit outputs.
 */
export function auditOutputPath(name: string): string {
  return join(REPO_ROOT, "docs", "structure-audit", name);
}
