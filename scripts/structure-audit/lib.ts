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
type StringDelim = '"' | "'" | "`";
type StripState = {
  i: number;
  out: string;
  inString: StringDelim | null;
  done: boolean;
};

/**
 * Step the state machine while inside a string literal. Consumes one
 * character (or two for an escape sequence) and clears `inString` when the
 * closing delimiter is reached.
 */
function stepInString(src: string, state: StripState): void {
  const c = src[state.i] as string;
  const next = src[state.i + 1];
  state.out += c;
  if (c === "\\") {
    // Include the escaped char as-is (handles \", \\, \n, \`, etc.).
    if (next !== undefined) state.out += next;
    state.i += 2;
    return;
  }
  if (c === state.inString) state.inString = null;
  state.i += 1;
}

/**
 * Step the state machine when not inside a string. Handles block comments,
 * line comments, and string-opening delimiters; otherwise emits the
 * character verbatim.
 */
function stepDefault(src: string, state: StripState): void {
  const c = src[state.i] as string;
  const next = src[state.i + 1];
  if (c === "/" && next === "*") {
    const end = src.indexOf("*/", state.i + 2);
    if (end === -1) {
      state.done = true;
      return;
    }
    // Preserve newlines inside the block so downstream line-number
    // reporting stays correct (D9 maps regex hits back to line numbers).
    const block = src.slice(state.i, end + 2);
    for (const ch of block) {
      if (ch === "\n") state.out += "\n";
    }
    state.i = end + 2;
    return;
  }
  if (c === "/" && next === "/") {
    const nl = src.indexOf("\n", state.i);
    if (nl === -1) {
      state.done = true;
      return;
    }
    state.i = nl;
    return;
  }
  if (c === '"' || c === "'" || c === "`") {
    state.inString = c;
    state.out += c;
    state.i += 1;
    return;
  }
  state.out += c;
  state.i += 1;
}

export function stripComments(src: string): string {
  const state: StripState = { i: 0, out: "", inString: null, done: false };
  while (!state.done && state.i < src.length) {
    if (state.inString) {
      stepInString(src, state);
    } else {
      stepDefault(src, state);
    }
  }
  return state.out;
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
async function* iterateGlob(
  glob: Glob,
  seen: Set<string>,
): AsyncGenerator<{ path: string; relPath: string; contents: string }> {
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

export async function* iterateSourceFiles(): AsyncGenerator<{
  path: string;
  relPath: string;
  contents: string;
}> {
  const seen = new Set<string>();
  yield* iterateGlob(new Glob("packages/*/src/**/*.ts"), seen);
  yield* iterateGlob(new Glob("packages/mcp-connectors/*/src/**/*.ts"), seen);
}

/**
 * Path under docs/structure-audit/ for committed audit outputs.
 */
export function auditOutputPath(name: string): string {
  return join(REPO_ROOT, "docs", "structure-audit", name);
}
