#!/usr/bin/env bun
// D10/D11/D12 — Nimbus-specific structural invariant checks.
//
// Subcommands:
//   --rule spawn        D10: connectors/ spawn must use extensionProcessEnv() (binary, exits non-zero on hits)
//   --rule vault-key    D11: vault-key construction must be in the allow-list (binary, exits non-zero on hits)
//   --rule db-run       D12: census of db.run() outside db/write.ts (always exit 0; writes JSON)
//   --binary-only       runs spawn + vault-key only (CI mode)
//   (no flag)           runs everything; binary-violation exit code on D10/D11

import { auditOutputPath, iterateSourceFiles } from "./lib.ts";

export type FileEntry = { relPath: string; contents: string };
export type Violation = { rule: string; file: string; line: number; snippet: string };

export const VAULT_KEY_ALLOW_LIST = [
  "packages/gateway/src/connectors/connector-vault.ts",
  "packages/gateway/src/auth/google-access-token.ts",
  "packages/gateway/src/auth/pkce.ts",
  // Provider-shared OAuth canonical reader (Microsoft); mirrors google-access-token.ts.
  "packages/gateway/src/auth/oauth-vault-tokens.ts",
  // OpenAI embedding provider — not a Nimbus connector; no ConnectorServiceId.
  "packages/gateway/src/embedding/create-embedding-runtime.ts",
];

// Match a Bun.spawn or child_process spawn call.
const SPAWN_RE = /\b(?:Bun\.spawn|Bun\.spawnSync|child_process\.spawn|spawn)\s*\(/;

export function checkSpawnInvariant(files: readonly FileEntry[]): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    if (!f.relPath.startsWith("packages/gateway/src/connectors/")) continue;
    const lines = f.contents.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (!SPAWN_RE.test(line)) continue;
      // Look for extensionProcessEnv on the same line OR within the next 5 lines.
      const window = lines.slice(i, Math.min(i + 6, lines.length)).join("\n");
      if (window.includes("extensionProcessEnv")) continue;
      out.push({
        rule: "D10-spawn",
        file: f.relPath,
        line: i + 1,
        snippet: line.trim(),
      });
    }
  }
  return out;
}

// Heuristic: vault-key construction is a string-literal containing `.oauth`
// or any template literal mixing service/provider with `.oauth`/`.token`/`.pat`.
// Files in the allow-list are exempt. Test files are exempt (handled by iterateSourceFiles).
const VAULT_KEY_RE =
  /['"`][a-z0-9_]*\.(oauth|token|pat|api_key)['"`]|\$\{[^}]+\}\.(oauth|token|pat|api_key)/;

export function checkVaultKeyAllowList(
  files: readonly FileEntry[],
  allowList: readonly string[] = VAULT_KEY_ALLOW_LIST,
): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    if (allowList.includes(f.relPath)) continue;
    const lines = f.contents.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      const prevLine = lines[i - 1] ?? "";
      if (prevLine.includes("audit-ignore-next-line D11-vault-key")) continue;
      if (!VAULT_KEY_RE.test(line)) continue;
      out.push({
        rule: "D11-vault-key",
        file: f.relPath,
        line: i + 1,
        snippet: line.trim(),
      });
    }
  }
  return out;
}

export type DbRunHit = {
  file: string;
  line: number;
  function: string;
  snippet: string;
};

const DB_RUN_RE = /\bdb\.run\s*\(/;
// Best-effort enclosing-function detection: nearest preceding `function name(`
// or `name(...) {` / `name(...) =`. Split into two simpler patterns so each
// alternation has bounded complexity (closes ReDoS warning vs. the previous
// single combined regex).
const FN_DECL_RE = /(?:function|async\s+function)\s+([A-Za-z_$][\w$]*)/;
const FN_CALL_RE = /([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{=]/;

function findEnclosingFunction(lines: readonly string[], from: number): string {
  for (let j = from; j >= Math.max(0, from - 30); j--) {
    const candidate = lines[j] as string;
    const decl = FN_DECL_RE.exec(candidate);
    if (decl) return decl[1] ?? "<unknown>";
    const call = FN_CALL_RE.exec(candidate);
    if (call) return call[1] ?? "<unknown>";
  }
  return "<top-level>";
}

export function collectDbRunCensus(files: readonly FileEntry[]): DbRunHit[] {
  const out: DbRunHit[] = [];
  for (const f of files) {
    if (f.relPath === "packages/gateway/src/db/write.ts") continue;
    const lines = f.contents.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (!DB_RUN_RE.test(line)) continue;
      out.push({
        file: f.relPath,
        line: i + 1,
        function: findEnclosingFunction(lines, i),
        snippet: line.trim(),
      });
    }
  }
  return out;
}

type Mode = "spawn" | "vault-key" | "db-run" | "binary-only" | "all";

function parseArgs(argv: readonly string[]): Mode {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rule") {
      const r = argv[++i];
      if (r === "spawn" || r === "vault-key" || r === "db-run") return r;
      console.error(`unknown rule: ${r}`);
      process.exit(2);
    }
    if (a === "--binary-only") return "binary-only";
  }
  return "all";
}

async function loadFiles(): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  for await (const f of iterateSourceFiles()) {
    out.push({ relPath: f.relPath, contents: f.contents });
  }
  return out;
}

async function run(): Promise<void> {
  const mode = parseArgs(Bun.argv);
  const files = await loadFiles();

  let exit = 0;

  if (mode === "spawn" || mode === "binary-only" || mode === "all") {
    const v = checkSpawnInvariant(files);
    for (const e of v) {
      console.error(
        `::error file=${e.file},line=${e.line}::D10 spawn not via extensionProcessEnv: ${e.snippet}`,
      );
    }
    if (v.length > 0) exit = 1;
  }
  if (mode === "vault-key" || mode === "binary-only" || mode === "all") {
    const v = checkVaultKeyAllowList(files);
    for (const e of v) {
      console.error(
        `::error file=${e.file},line=${e.line}::D11 vault-key constructed outside allow-list: ${e.snippet}`,
      );
    }
    if (v.length > 0) exit = 1;
  }
  if (mode === "db-run" || mode === "all") {
    const census = collectDbRunCensus(files);
    const outPath = auditOutputPath("db-run-census.json");
    await Bun.write(outPath, `${JSON.stringify(census, null, 2)}\n`);
    console.log(`db-run census: ${census.length} hits → ${outPath}`);
    // db-run always exits 0 — it's a census, not a gate.
  }

  process.exit(exit);
}

if (import.meta.main) await run();
