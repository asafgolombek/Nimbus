# Structure Audit (B3) — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all Phase 1 deliverables of the B3 structure audit — three new dev dep tools (dependency-cruiser, jscpd, knip), six custom audit scripts, six `audit:*` package scripts, and the committed baseline measurements (`any-baseline.json`, `db-run-census.json`, `churn-90d.json`, `baseline.md`).

**Architecture:** All custom audit scripts live under `scripts/structure-audit/` and share a small `lib.ts` for filesystem walking and comment stripping. Each script is a standalone Bun-runnable CLI that emits JSON or text. The orchestrator `audit-structure.ts` invokes each script and writes a single timestamped run blob. No new runtime dependencies in any `packages/*` workspace — these are dev-only tools at the root level.

**Tech Stack:** Bun 1.3+ (built-ins: `Bun.Glob`, `Bun.file`, `Bun.spawn`), TypeScript 6.x strict, Biome for lint/format, three new dev deps (`dependency-cruiser`, `jscpd`, `knip`), SonarQube via the existing MCP wiring.

**Spec:** `docs/superpowers/specs/2026-04-30-structure-audit-design.md`

**Branch:** `dev/asafgolombek/structure-audit-design` (already checked out — three commits already on it: slopsquatting hardening, the design spec, and the review-driven revisions).

---

## File Structure

**New files (created during Phase 1):**

| Path | Purpose |
|---|---|
| `sonar-project.properties` | SonarQube config (project key, source roots, exclusions, rule profile) |
| `.dependency-cruiser.cjs` | dependency-cruiser config — D1 (forbidden imports), D2 (cycles), D3 (PAL isolation) |
| `.jscpd.json` | jscpd config — D6 token-level duplication |
| `knip.json` | knip config — D7 unused exports, workspace-aware entry points |
| `scripts/structure-audit/lib.ts` | Shared helpers: source-file iteration, comment stripping, repo-root resolution |
| `scripts/structure-audit/count-any-usage.ts` | D8 — counts `any` usage; reads/writes `any-baseline.json` |
| `scripts/structure-audit/count-any-usage.test.ts` | Unit tests for D8 |
| `scripts/structure-audit/list-risky-assertions.ts` | D9 — lists `as <T>` outside tests (informational) |
| `scripts/structure-audit/list-risky-assertions.test.ts` | Unit tests for D9 |
| `scripts/structure-audit/check-nimbus-invariants.ts` | D10 (spawn) / D11 (vault-key) / D12 (db-run) custom rules |
| `scripts/structure-audit/check-nimbus-invariants.test.ts` | Unit tests for D10/D11/D12 |
| `scripts/structure-audit/measure-file-loc.ts` | D4 — raw LOC per source file |
| `scripts/structure-audit/measure-file-loc.test.ts` | Unit tests for D4 |
| `scripts/structure-audit/get-git-churn.ts` | Ranking-evidence helper (90-day commit count per file) |
| `scripts/structure-audit/get-git-churn.test.ts` | Unit tests for churn helper |
| `scripts/structure-audit/audit-structure.ts` | Orchestrator — calls every script + tool, writes run-<timestamp>.json |
| `docs/structure-audit/any-baseline.json` | Committed D8 baseline (created at end of Phase 1) |
| `docs/structure-audit/db-run-census.json` | Committed D12 census (created at end of Phase 1) |
| `docs/structure-audit/churn-90d.json` | Committed 90-day churn snapshot (created at end of Phase 1) |
| `docs/structure-audit/baseline.md` | Per-dimension starting state with provenance |
| `docs/structure-audit/sonarqube-rule-tuning.md` | Empty placeholder; populated only if Phase 2 needs rule tuning |

**Modified files:**

| Path | Change |
|---|---|
| `package.json` | Add three dev deps; add six `audit:*` scripts |
| `bun.lock` | Auto-updated by `bun add -d` |

**Out of scope for Phase 1:** `.github/workflows/_structure.yml` (Phase 2), `docs/structure-audit/missed.md` (Phase 2), `docs/structure-audit/deferred-backlog.md` (Phase 2), top-5 fix plans (Phase 2).

---

## Task 1: Add dev dependencies (verified via slopsquatting check)

**Files:**
- Modify: `package.json` (devDependencies block)
- Modify: `bun.lock` (auto-updated)

- [ ] **Step 1: Verify each new dependency exists on npm and is mature**

The slopsquatting hardening from the previous commit gates new deps. Run the check on all three before adding:

```bash
bun run check-package dependency-cruiser
bun run check-package jscpd
bun run check-package knip
```

Expected output (per package): `Package: …`, `Author: …`, `Maintainers: …`, `Created: …`, `Version count: …`. Confirm each:
- Exits 0
- Created date is at least a year old (none should emit the `< 7 days` warning)
- Maintainer is recognisable (`mverbruggen` for dependency-cruiser; `kucherenko` for jscpd; `webpro` for knip)

If any package fails the check, **stop**, report it, and do not proceed.

- [ ] **Step 2: Add the three dev dependencies**

```bash
bun add -d dependency-cruiser jscpd knip
```

Expected: `bun.lock` updates; `package.json` `devDependencies` block grows. No runtime dependencies should change in any workspace.

- [ ] **Step 3: Verify each binary runs**

```bash
bunx dependency-cruiser --version
bunx jscpd --version
bunx knip --version
```

Expected: each prints a version number, exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "$(cat <<'EOF'
build: add B3 audit dev deps (dependency-cruiser, jscpd, knip)

All three verified via `bun run check-package` (slopsquatting gate)
before install. None are <7 days old; all have established maintainers.

dev-only — no runtime dependency changes in any workspace.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4
EOF
)"
```

---

## Task 2: SonarQube wiring (`sonar-project.properties`)

**Files:**
- Create: `sonar-project.properties`

- [ ] **Step 1: Resolve the SonarQube project key**

The SonarQube MCP is already wired. Resolve the key by listing accessible projects:

Use the SonarQube MCP tool `search_my_sonarqube_projects` (no arguments). Identify the project for this repo (likely `nimbus` or `asafgolombek_nimbus`). Note the exact `key` string from the response.

If no matching project exists yet, stop and ask: a project must be created in SonarQube before this task can complete (manual step in the SonarQube UI or via admin API).

- [ ] **Step 2: Write the config file**

Create `sonar-project.properties` with the following content (substitute `<PROJECT_KEY>` with the value from Step 1):

```properties
# SonarQube configuration for Nimbus B3 audit.
# Resolved key: see Step 1 of Task 2 in plan 2026-04-30-structure-audit-phase-1.md.
sonar.projectKey=<PROJECT_KEY>
sonar.projectName=Nimbus
sonar.organization=

# Source roots: every package's src directory.
sonar.sources=packages/gateway/src,packages/cli/src,packages/ui/src,packages/sdk/src,packages/client/src,packages/mcp-connectors

# Exclusions: tests, generated SQL migration files, build outputs, fixtures.
sonar.exclusions=**/*.test.ts,**/*.test.tsx,**/*-sql.ts,packages/ui/dist/**,packages/*/dist/**,**/node_modules/**,**/__fixtures__/**,**/test/fixtures/**

# Test inclusions (so coverage maps correctly when uploaded later — Phase 2 / future).
sonar.tests=packages
sonar.test.inclusions=**/*.test.ts,**/*.test.tsx

# Language hint.
sonar.sourceEncoding=UTF-8
```

- [ ] **Step 3: Verify the project key resolves via the MCP**

Use SonarQube MCP `get_project_quality_gate_status` with the project key to confirm the key is reachable. Expected: a quality-gate snapshot returned (status may be `NONE` if no analysis has been uploaded — that's fine; we're not running an analysis as part of Phase 1).

- [ ] **Step 4: Commit**

```bash
git add sonar-project.properties
git commit -m "$(cat <<'EOF'
chore(structure-audit): add sonar-project.properties

Pins SonarQube project key, source roots, and exclusions. Rule profile
defaults to Sonar Way; tuning happens in Phase 2 only if Phase 1's first
analysis has unacceptable signal-to-noise (see spec § 4.1).

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.1
EOF
)"
```

---

## Task 3: `dependency-cruiser` config (D1, D2, D3)

**Files:**
- Create: `.dependency-cruiser.cjs`
- Test: smoke test via deliberate violation (no committed `*.test.ts`; this is a config file, tested by running the tool)

- [ ] **Step 1: Write the config**

Create `.dependency-cruiser.cjs`:

```javascript
// dependency-cruiser config for the B3 structure audit.
// Encodes D1 (forbidden cross-package imports), D2 (cycles within a workspace),
// D3 (PAL leakage). Run via `bun run audit:boundaries`.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ─────────────────── D2: no cycles ───────────────────
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular imports forbidden inside any workspace.",
      from: {},
      to: { circular: true },
    },

    // ─────── D1: forbidden cross-package source imports ───────
    {
      name: "cli-no-import-gateway",
      severity: "error",
      comment: "CLI must talk to gateway via IPC, never source imports.",
      from: { path: "^packages/cli/src" },
      to: { path: "^packages/gateway/src" },
    },
    {
      name: "ui-no-import-gateway",
      severity: "error",
      comment: "UI must talk to gateway via IPC, never source imports.",
      from: { path: "^packages/ui/src" },
      to: { path: "^packages/gateway/src" },
    },
    {
      name: "sdk-no-import-core",
      severity: "error",
      comment: "SDK is MIT and must not import any AGPL package.",
      from: { path: "^packages/sdk/src" },
      to: { path: "^packages/(gateway|cli|ui|client|mcp-connectors)/" },
    },
    {
      name: "mcp-connectors-only-import-sdk",
      severity: "error",
      comment: "First-party MCP connectors depend only on @nimbus-dev/sdk.",
      from: { path: "^packages/mcp-connectors/[^/]+/src" },
      to: {
        path: "^packages/(gateway|cli|ui|client)/",
      },
    },

    // ─────────── D3: PAL leakage ───────────
    {
      name: "pal-isolation",
      severity: "error",
      comment:
        "Only platform/index.ts (and tests) may import win32/darwin/linux directly. " +
        "Business logic uses the PlatformServices interface.",
      from: {
        path: "^packages/gateway/src/",
        pathNot: [
          "^packages/gateway/src/platform/index\\.ts$",
          "\\.test\\.ts$",
          "/test/",
        ],
      },
      to: {
        path:
          "^packages/gateway/src/platform/(win32|darwin|linux)\\.ts$",
      },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    includeOnly: "^packages/",
    exclude: {
      path: [
        "\\.test\\.ts$",
        "\\.test\\.tsx$",
        "/dist/",
        "node_modules",
        "/__fixtures__/",
      ],
    },
  },
};
```

- [ ] **Step 2: Smoke-test the config — clean run on main**

```bash
bunx dependency-cruiser --config .dependency-cruiser.cjs packages
```

Expected: zero violations (the codebase is currently clean — no forbidden imports, no cycles, no PAL leakage; if there ARE violations, that's a Phase 2 finding, not a Phase 1 config bug).

If violations are reported, inspect them. Two cases:
1. **Real violation** the audit was designed to catch — note it for Phase 2's `missed.md` (don't fix in this task).
2. **False positive** caused by a config bug — fix the rule pattern.

If unsure which case applies, stop and report.

- [ ] **Step 3: Smoke-test that a deliberate violation is caught**

Create a temporary file demonstrating a forbidden import to verify the rule fires:

```bash
mkdir -p packages/cli/src/__tmp_smoke
cat > packages/cli/src/__tmp_smoke/violation.ts <<'EOF'
// TEMPORARY — for Task 3 smoke test only. Delete before commit.
import {} from "../../../gateway/src/index.ts";
EOF

bunx dependency-cruiser --config .dependency-cruiser.cjs packages/cli/src/__tmp_smoke/violation.ts
```

Expected: the `cli-no-import-gateway` rule fires; exit code is non-zero. Output should include:
```
error cli-no-import-gateway: …violation.ts → …gateway/src/index.ts
```

Then delete the smoke file:

```bash
rm -rf packages/cli/src/__tmp_smoke
```

If the rule did NOT fire, the config is broken — fix the rule pattern and retry before proceeding.

- [ ] **Step 4: Commit**

```bash
git add .dependency-cruiser.cjs
git commit -m "$(cat <<'EOF'
chore(structure-audit): add dependency-cruiser config (D1, D2, D3)

Three rule families:
- D1: forbidden cross-package imports (cli/ui never import gateway TS;
  sdk imports neither core nor ui; mcp-connectors only import sdk).
- D2: no cycles within any workspace.
- D3: PAL isolation — only platform/index.ts may import win32/darwin/linux.

Smoke-tested with a deliberate violation; rule fires correctly.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.2
EOF
)"
```

---

## Task 4: `jscpd` config (D6)

**Files:**
- Create: `.jscpd.json`

- [ ] **Step 1: Write the config**

Create `.jscpd.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/kucherenko/jscpd/master/packages/jscpd/schemas/jscpd.json",
  "minTokens": 50,
  "minLines": 5,
  "threshold": 3,
  "reporters": ["json", "console"],
  "output": "docs/structure-audit",
  "ignore": [
    "**/node_modules/**",
    "**/dist/**",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.vitest.tsx",
    "**/*-sql.ts",
    "**/__fixtures__/**",
    "**/test/fixtures/**",
    "**/*.lock",
    "**/*.snap",
    "packages/docs/**"
  ],
  "format": ["typescript", "tsx"],
  "absolute": false,
  "blame": false,
  "silent": false,
  "noSymlinks": true
}
```

Note: jscpd writes its JSON report to `<output>/jscpd-report.json`. The `output` field above puts it in `docs/structure-audit/`, which is where the spec wants the persisted report committed.

- [ ] **Step 2: Smoke-test the config**

```bash
mkdir -p docs/structure-audit
bunx jscpd packages
```

Expected: exit code 0 (or 1 if total duplication exceeds threshold — that's a Phase 2 finding, fine). A `docs/structure-audit/jscpd-report.json` file is produced. Inspect that the file has the expected shape (a `statistics` block, a `duplicates` array).

- [ ] **Step 3: Commit (config only — the report itself is regenerated each run; commit at Task 13)**

```bash
git add .jscpd.json
git commit -m "$(cat <<'EOF'
chore(structure-audit): add jscpd config (D6)

50-token / 5-line minimum block; ignores tests, migration SQL,
fixtures, and the docs site. Report path: docs/structure-audit/jscpd-report.json.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.3
EOF
)"
```

---

## Task 5: `knip` config (D7)

**Files:**
- Create: `knip.json`

- [ ] **Step 1: Write the config**

Create `knip.json`:

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "workspaces": {
    ".": {
      "entry": ["scripts/**/*.ts"],
      "ignore": ["**/*.test.ts"]
    },
    "packages/gateway": {
      "entry": ["src/index.ts", "src/**/*.test.ts", "test/**/*.test.ts"],
      "project": "src/**/*.ts"
    },
    "packages/cli": {
      "entry": ["src/index.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
      "project": "src/**/*.{ts,tsx}"
    },
    "packages/ui": {
      "entry": ["src/main.tsx", "src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
      "project": "src/**/*.{ts,tsx}"
    },
    "packages/sdk": {
      "entry": ["src/index.ts", "src/testing/index.ts", "src/ipc/index.ts", "src/**/*.test.ts"],
      "project": "src/**/*.ts"
    },
    "packages/client": {
      "entry": ["src/index.ts", "src/**/*.test.ts"],
      "project": "src/**/*.ts"
    },
    "packages/mcp-connectors/*": {
      "entry": ["src/index.ts", "src/**/*.test.ts"],
      "project": "src/**/*.ts"
    }
  },
  "ignoreDependencies": [],
  "ignoreBinaries": []
}
```

- [ ] **Step 2: Smoke-test the config**

```bash
bunx knip --reporter json > docs/structure-audit/knip-report.json
```

Expected: a JSON report is produced. The exit code may be non-zero if knip finds unused exports (it will — that's the whole point); we're not yet at the gate stage. Inspect that the JSON has expected top-level keys (`files`, `dependencies`, `unlistedDependencies`, `exports`, etc.).

If knip errors (not just "found unused" — actual config error), fix the config. Common issues:
- A workspace's `entry` path doesn't exist (typo in the workspace path)
- A `project` glob is too narrow

- [ ] **Step 3: Commit (config only — report regenerated each run, committed at Task 14)**

```bash
git add knip.json
git commit -m "$(cat <<'EOF'
chore(structure-audit): add knip config (D7)

Workspace-aware entry points for all six packages plus root scripts.
Report path: docs/structure-audit/knip-report.json (regenerated each run;
committed in Task 14 after baseline cleanup).

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.4
EOF
)"
```

---

## Task 6: `lib.ts` shared helpers + `count-any-usage.ts` (D8)

**Files:**
- Create: `scripts/structure-audit/lib.ts`
- Create: `scripts/structure-audit/count-any-usage.ts`
- Create: `scripts/structure-audit/count-any-usage.test.ts`
- Create: `docs/structure-audit/.gitkeep` (so the directory exists for tests)

- [ ] **Step 1: Write the failing test**

Create `scripts/structure-audit/count-any-usage.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { countAnyInSource, stripComments } from "./lib.ts";

describe("stripComments", () => {
  test("removes single-line comments", () => {
    expect(stripComments("const x = 1; // any here")).toBe("const x = 1; ");
  });
  test("removes multi-line comments", () => {
    expect(stripComments("/* any here */ const x = 1;")).toBe(" const x = 1;");
  });
  test("preserves any in code", () => {
    expect(stripComments("const x: any = 1;")).toBe("const x: any = 1;");
  });
  test("does not strip inside double-quoted string", () => {
    expect(stripComments('const u = "https://x.com/any";')).toBe('const u = "https://x.com/any";');
  });
  test("does not strip inside single-quoted string", () => {
    expect(stripComments("const u = 'https://x.com/any';")).toBe("const u = 'https://x.com/any';");
  });
  test("does not strip inside template literal", () => {
    expect(stripComments("const u = `https://x.com/any`;")).toBe("const u = `https://x.com/any`;");
  });
  test("honours escaped quote inside string", () => {
    expect(stripComments('const u = "a\\"//not a comment";')).toBe('const u = "a\\"//not a comment";');
  });
  test("strips line comment after a string", () => {
    expect(stripComments('const u = "x"; // any')).toBe('const u = "x"; ');
  });
  test("preserves newlines inside block comments", () => {
    // D9 (list-risky-assertions) maps regex matches back to original line
    // numbers via stripped.split("\n"). A multi-line block comment must
    // contribute the same newline count as the original so downstream line
    // numbers don't shift.
    const src = "/*\n line1\n line2\n*/\nconst x = y as Foo;";
    const stripped = stripComments(src);
    expect(stripped.split("\n").length).toBe(src.split("\n").length);
    // The cast still appears on line 5 (1-indexed) of the stripped output.
    expect(stripped.split("\n")[4]).toBe("const x = y as Foo;");
  });
});

describe("countAnyInSource", () => {
  test("counts type annotation", () => {
    expect(countAnyInSource("const x: any = 1;")).toBe(1);
  });
  test("counts as-cast", () => {
    expect(countAnyInSource("const x = y as any;")).toBe(1);
  });
  test("counts generic", () => {
    expect(countAnyInSource("Promise<any>")).toBe(1);
  });
  test("does not count comments", () => {
    expect(countAnyInSource("// this any is in a comment\nconst x = 1;")).toBe(0);
  });
  test("does not count words containing 'any'", () => {
    expect(countAnyInSource("const company = 1; const many = 2;")).toBe(0);
  });
  test("counts multiple occurrences", () => {
    expect(countAnyInSource("const a: any = 1; const b = c as any;")).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test scripts/structure-audit/count-any-usage.test.ts
```

Expected: `error: Cannot find module './lib.ts'`. This is the failing-test confirmation.

- [ ] **Step 3: Write the shared `lib.ts`**

Create `scripts/structure-audit/lib.ts`:

```typescript
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
```

- [ ] **Step 4: Run lib tests to verify they pass**

```bash
bun test scripts/structure-audit/count-any-usage.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Write `count-any-usage.ts`**

Create `scripts/structure-audit/count-any-usage.ts`:

```typescript
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
//
// Exit codes:
//   0  baseline matches current count (--check) or update succeeded (--update)
//   1  regression: current > baseline, OR reduction without --update: current < baseline
//   2  usage error

import { auditOutputPath, countAnyInSource, iterateSourceFiles, REPO_ROOT } from "./lib.ts";

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
    await Bun.write(baselinePath, JSON.stringify({ count: total, generated: new Date().toISOString() }, null, 2) + "\n");
    console.log(`Wrote baseline: ${total} → ${baselinePath}`);
    return;
  }

  // mode === "check"
  const baselineFile = Bun.file(baselinePath);
  if (!(await baselineFile.exists())) {
    console.error(`baseline file not found: ${baselinePath}`);
    console.error(`run \`bun run scripts/structure-audit/count-any-usage.ts --update\` to create it`);
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
    console.error(`::error::any count reduced (${total} < ${baseline.count}). Update the baseline:`);
    console.error(`  bun run scripts/structure-audit/count-any-usage.ts --update`);
    console.error(`then commit docs/structure-audit/any-baseline.json in the same PR.`);
    process.exit(1);
  }
  console.log(`any count: ${total} (matches baseline)`);
}

await run();
```

- [ ] **Step 6: Run all tests to verify they pass**

```bash
bun test scripts/structure-audit/count-any-usage.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Smoke-run the script against the repo**

```bash
bun run scripts/structure-audit/count-any-usage.ts
```

Expected: prints `Total \`any\` count: <N>` plus the top-20 per-file breakdown. Note the count for later — Task 13 commits this as the baseline.

- [ ] **Step 8: Create the docs directory placeholder**

```bash
mkdir -p docs/structure-audit
touch docs/structure-audit/.gitkeep
```

- [ ] **Step 9: Commit**

```bash
git add scripts/structure-audit/lib.ts scripts/structure-audit/count-any-usage.ts scripts/structure-audit/count-any-usage.test.ts docs/structure-audit/.gitkeep
git commit -m "$(cat <<'EOF'
feat(structure-audit): add lib.ts + count-any-usage script (D8)

lib.ts: shared helpers (REPO_ROOT, stripComments, countAnyInSource,
iterateSourceFiles, auditOutputPath). Used by every B3 audit script.

count-any-usage.ts: D8 driver. Modes: --check (CI-mode, fails on
regression OR reduction with a "lower baseline" hint), --update
(local rewrite of any-baseline.json), default (print current count).
Manual ratchet pattern — see spec § 3.3.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.5
EOF
)"
```

---

## Task 7: `list-risky-assertions.ts` (D9)

**Files:**
- Create: `scripts/structure-audit/list-risky-assertions.ts`
- Create: `scripts/structure-audit/list-risky-assertions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/structure-audit/list-risky-assertions.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { findRiskyAssertions } from "./list-risky-assertions.ts";

describe("findRiskyAssertions", () => {
  test("finds `as Foo` cast", () => {
    const hits = findRiskyAssertions("test.ts", "const x = y as Foo;");
    expect(hits).toEqual([{ file: "test.ts", line: 1, snippet: "const x = y as Foo;" }]);
  });

  test("ignores `as const`", () => {
    expect(findRiskyAssertions("t.ts", "const x = [1, 2] as const;")).toEqual([]);
  });

  test("ignores `as unknown`", () => {
    expect(findRiskyAssertions("t.ts", "const x = y as unknown;")).toEqual([]);
  });

  test("finds nested cast on a multi-statement line", () => {
    expect(findRiskyAssertions("t.ts", "const a = b as A; const c = d as C;")).toHaveLength(2);
  });

  test("includes line number", () => {
    const src = "// line1\n// line2\nconst x = y as Foo;";
    const hits = findRiskyAssertions("t.ts", src);
    expect(hits[0]?.line).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test scripts/structure-audit/list-risky-assertions.test.ts
```

Expected: `Cannot find module './list-risky-assertions.ts'`.

- [ ] **Step 3: Write `list-risky-assertions.ts`**

Create `scripts/structure-audit/list-risky-assertions.ts`:

```typescript
#!/usr/bin/env bun
// D9: lists `as <T>` casts outside tests, excluding `as const` and `as unknown`.
// Informational — output goes into deferred-backlog as type-safety debt.
// No exit-non-zero behaviour. Always exits 0.

import { auditOutputPath, iterateSourceFiles, stripComments } from "./lib.ts";

export type Hit = { file: string; line: number; snippet: string };

// Match `as <Type>` where Type is NOT `const` or `unknown`.
// Type is one alphanum-or-`_` token (good enough for the audit; misses generics like `as Foo<Bar>`,
// which is acceptable — generic-cast cases are rare and would need an AST to do precisely).
const RE = /\bas\s+(?!const\b|unknown\b)([A-Za-z_][A-Za-z0-9_]*)/g;

export function findRiskyAssertions(file: string, src: string): Hit[] {
  const hits: Hit[] = [];
  // Strip comments so commented-out casts and CLI help text in `// ...`
  // banners aren't flagged. stripComments preserves newlines (both for `//`
  // line comments and `/* ... */` block comments) so reported line numbers
  // stay aligned with the original source.
  const stripped = stripComments(src);
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    let m: RegExpExecArray | null;
    RE.lastIndex = 0;
    while ((m = RE.exec(line)) !== null) {
      hits.push({ file, line: i + 1, snippet: line.trim() });
    }
  }
  return hits;
}

async function run(): Promise<void> {
  const all: Hit[] = [];
  for await (const f of iterateSourceFiles()) {
    all.push(...findRiskyAssertions(f.relPath, f.contents));
  }
  // Sort by file, line. Use lexicographic bit-compare (NOT localeCompare) so
  // ordering is deterministic across locales and OSes.
  all.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
  const outPath = auditOutputPath("risky-assertions.json");
  await Bun.write(outPath, JSON.stringify(all, null, 2) + "\n");
  console.log(`risky assertions: ${all.length} → ${outPath}`);
}

if (import.meta.main) await run();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test scripts/structure-audit/list-risky-assertions.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Smoke-run against the repo**

```bash
bun run scripts/structure-audit/list-risky-assertions.ts
```

Expected: writes `docs/structure-audit/risky-assertions.json`. Inspect it briefly — confirm shape `[{ file, line, snippet }, ...]`.

- [ ] **Step 6: Commit**

```bash
git add scripts/structure-audit/list-risky-assertions.ts scripts/structure-audit/list-risky-assertions.test.ts
git commit -m "$(cat <<'EOF'
feat(structure-audit): add list-risky-assertions script (D9)

Lists `as <Type>` casts outside tests, excluding `as const` /
`as unknown`. Informational only — drives the deferred-backlog
type-safety-debt entry. No CI gate (see spec § 3.3).

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.5
EOF
)"
```

---

## Task 8: `check-nimbus-invariants.ts` (D10, D11, D12)

**Files:**
- Create: `scripts/structure-audit/check-nimbus-invariants.ts`
- Create: `scripts/structure-audit/check-nimbus-invariants.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/structure-audit/check-nimbus-invariants.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  checkSpawnInvariant,
  checkVaultKeyAllowList,
  collectDbRunCensus,
} from "./check-nimbus-invariants.ts";

describe("D10 — checkSpawnInvariant (under connectors/)", () => {
  test("flags `Bun.spawn` not via extensionProcessEnv", () => {
    const violations = checkSpawnInvariant([
      {
        relPath: "packages/gateway/src/connectors/lazy-mesh.ts",
        contents: 'const p = Bun.spawn(["x"], { env: { ...process.env } });',
      },
    ]);
    expect(violations).toHaveLength(1);
  });

  test("accepts spawn that calls extensionProcessEnv", () => {
    const violations = checkSpawnInvariant([
      {
        relPath: "packages/gateway/src/connectors/lazy-mesh.ts",
        contents: 'const p = Bun.spawn(["x"], { env: extensionProcessEnv() });',
      },
    ]);
    expect(violations).toHaveLength(0);
  });

  test("ignores spawn outside connectors/", () => {
    const violations = checkSpawnInvariant([
      {
        relPath: "packages/gateway/src/voice/service.ts",
        contents: 'const p = Bun.spawn(["whisper"], { env: { ...process.env } });',
      },
    ]);
    expect(violations).toHaveLength(0);
  });
});

describe("D11 — checkVaultKeyAllowList", () => {
  const ALLOW_LIST = [
    "packages/gateway/src/connectors/connector-vault.ts",
    "packages/gateway/src/auth/google-access-token.ts",
    "packages/gateway/src/auth/pkce.ts",
  ];

  test("flags vault-key construction outside allow-list", () => {
    const violations = checkVaultKeyAllowList(
      [
        {
          relPath: "packages/gateway/src/connectors/some-other.ts",
          contents: 'const k = `${service}.oauth`;',
        },
      ],
      ALLOW_LIST,
    );
    expect(violations).toHaveLength(1);
  });

  test("ignores construction in allow-listed files", () => {
    const violations = checkVaultKeyAllowList(
      [
        {
          relPath: "packages/gateway/src/connectors/connector-vault.ts",
          contents: 'export function k(s: string) { return `${s}.oauth`; }',
        },
      ],
      ALLOW_LIST,
    );
    expect(violations).toHaveLength(0);
  });
});

describe("D12 — collectDbRunCensus", () => {
  test("collects db.run() outside db/write.ts", () => {
    const census = collectDbRunCensus([
      {
        relPath: "packages/gateway/src/something/foo.ts",
        contents: "function bar() {\n  db.run('CREATE TABLE x ...');\n}",
      },
    ]);
    expect(census).toEqual([
      {
        file: "packages/gateway/src/something/foo.ts",
        line: 2,
        function: "bar",
        snippet: "db.run('CREATE TABLE x ...');",
      },
    ]);
  });

  test("ignores db.run() inside db/write.ts (the wrapper)", () => {
    const census = collectDbRunCensus([
      {
        relPath: "packages/gateway/src/db/write.ts",
        contents: "db.run('SELECT 1');",
      },
    ]);
    expect(census).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test scripts/structure-audit/check-nimbus-invariants.test.ts
```

Expected: `Cannot find module …`.

- [ ] **Step 3: Write `check-nimbus-invariants.ts`**

Create `scripts/structure-audit/check-nimbus-invariants.ts`:

```typescript
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

const VAULT_KEY_ALLOW_LIST = [
  "packages/gateway/src/connectors/connector-vault.ts",
  "packages/gateway/src/auth/google-access-token.ts",
  "packages/gateway/src/auth/pkce.ts",
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
const VAULT_KEY_RE = /['"`][a-z0-9_]*\.(oauth|token|pat|api_key)['"`]|\$\{[^}]+\}\.(oauth|token|pat|api_key)/;

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
// Best-effort enclosing-function detection: nearest preceding `function name(` or `name(...) {` or `=> {`.
const FN_NAME_RE = /(?:function|async\s+function)\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{=]/;

export function collectDbRunCensus(files: readonly FileEntry[]): DbRunHit[] {
  const out: DbRunHit[] = [];
  for (const f of files) {
    if (f.relPath === "packages/gateway/src/db/write.ts") continue;
    const lines = f.contents.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (!DB_RUN_RE.test(line)) continue;
      // Walk back up to 30 lines looking for an enclosing function name.
      let fnName = "<top-level>";
      for (let j = i; j >= Math.max(0, i - 30); j--) {
        const m = FN_NAME_RE.exec(lines[j] as string);
        if (m) {
          fnName = (m[1] ?? m[2] ?? "<unknown>") as string;
          break;
        }
      }
      out.push({
        file: f.relPath,
        line: i + 1,
        function: fnName,
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
      console.error(`::error file=${e.file},line=${e.line}::D10 spawn not via extensionProcessEnv: ${e.snippet}`);
    }
    if (v.length > 0) exit = 1;
  }
  if (mode === "vault-key" || mode === "binary-only" || mode === "all") {
    const v = checkVaultKeyAllowList(files);
    for (const e of v) {
      console.error(`::error file=${e.file},line=${e.line}::D11 vault-key constructed outside allow-list: ${e.snippet}`);
    }
    if (v.length > 0) exit = 1;
  }
  if (mode === "db-run" || mode === "all") {
    const census = collectDbRunCensus(files);
    const outPath = auditOutputPath("db-run-census.json");
    await Bun.write(outPath, JSON.stringify(census, null, 2) + "\n");
    console.log(`db-run census: ${census.length} hits → ${outPath}`);
    // db-run always exits 0 — it's a census, not a gate.
  }

  process.exit(exit);
}

if (import.meta.main) await run();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test scripts/structure-audit/check-nimbus-invariants.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Smoke-run all rules against the repo**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn
echo "exit=$?"
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key
echo "exit=$?"
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule db-run
echo "exit=$?"
```

Expected: spawn and vault-key should exit 0 (no violations on `main`). db-run should always exit 0 and write the census file. **If spawn or vault-key reports violations, that's a real Phase 2 finding** — note it but don't fix in Phase 1.

- [ ] **Step 6: Commit**

```bash
git add scripts/structure-audit/check-nimbus-invariants.ts scripts/structure-audit/check-nimbus-invariants.test.ts
git commit -m "$(cat <<'EOF'
feat(structure-audit): add Nimbus-invariant checks (D10/D11/D12)

D10 — spawn rule (binary): Bun.spawn / child_process.spawn under
packages/gateway/src/connectors/ must call extensionProcessEnv()
within 5 lines. Connectors-scoped per Invariant I1 (see spec § 3.3).

D11 — vault-key allow-list (binary): vault-key string construction
must occur in connectors/connector-vault.ts, auth/google-access-token.ts,
or auth/pkce.ts. Anything else is a finding (see spec § 3.3 D11).

D12 — db.run() census (informational): collects every db.run() outside
db/write.ts into structured JSON (file/line/function/snippet) at
docs/structure-audit/db-run-census.json. Feeds future S5-F4 design.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.5
EOF
)"
```

---

## Task 9: `measure-file-loc.ts` (D4)

**Files:**
- Create: `scripts/structure-audit/measure-file-loc.ts`
- Create: `scripts/structure-audit/measure-file-loc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/structure-audit/measure-file-loc.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { rawLoc } from "./measure-file-loc.ts";

describe("rawLoc", () => {
  test("counts lines including blanks", () => {
    expect(rawLoc("a\n\nb\n")).toBe(3);
  });
  test("counts a single line without trailing newline", () => {
    expect(rawLoc("a")).toBe(1);
  });
  test("returns 0 for empty string", () => {
    expect(rawLoc("")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test scripts/structure-audit/measure-file-loc.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `measure-file-loc.ts`**

Create `scripts/structure-audit/measure-file-loc.ts`:

```typescript
#!/usr/bin/env bun
// D4: raw LOC per source file in packages/*/src/**, excluding tests.
// Sorted descending by LOC. Default threshold for "miss": > 800.
// Spec rationale: raw LOC, comments and blanks count.

import { auditOutputPath, iterateSourceFiles } from "./lib.ts";

export function rawLoc(src: string): number {
  if (src.length === 0) return 0;
  const newlines = (src.match(/\n/g) ?? []).length;
  // If the file ends with a newline, the count is newlines; otherwise newlines + 1.
  return src.endsWith("\n") ? newlines : newlines + 1;
}

export type FileLoc = { file: string; loc: number };

async function run(): Promise<void> {
  const all: FileLoc[] = [];
  for await (const f of iterateSourceFiles()) {
    all.push({ file: f.relPath, loc: rawLoc(f.contents) });
  }
  all.sort((a, b) => b.loc - a.loc);
  const outPath = auditOutputPath("file-loc.json");
  await Bun.write(outPath, JSON.stringify(all, null, 2) + "\n");
  console.log(`file LOC report: ${all.length} files → ${outPath}`);
  console.log(`Top 10:`);
  for (const e of all.slice(0, 10)) console.log(`  ${e.loc}\t${e.file}`);
}

if (import.meta.main) await run();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test scripts/structure-audit/measure-file-loc.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Smoke-run against the repo**

```bash
bun run scripts/structure-audit/measure-file-loc.ts
```

Expected: writes `docs/structure-audit/file-loc.json`; prints top 10 to stdout. Note any file > 800 LOC for Phase 2.

- [ ] **Step 6: Commit**

```bash
git add scripts/structure-audit/measure-file-loc.ts scripts/structure-audit/measure-file-loc.test.ts
git commit -m "$(cat <<'EOF'
feat(structure-audit): add measure-file-loc script (D4)

Raw LOC (comments + blanks count) per packages/*/src/**.ts excluding
tests. Sorted descending; emitted as docs/structure-audit/file-loc.json.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.5
EOF
)"
```

---

## Task 10: `get-git-churn.ts` (ranking evidence)

**Files:**
- Create: `scripts/structure-audit/get-git-churn.ts`
- Create: `scripts/structure-audit/get-git-churn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/structure-audit/get-git-churn.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { computePercentile } from "./get-git-churn.ts";

describe("computePercentile", () => {
  test("80th percentile of [1..10]", () => {
    expect(computePercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 80)).toBe(8);
  });
  test("80th percentile of single value", () => {
    expect(computePercentile([5], 80)).toBe(5);
  });
  test("empty array returns 0", () => {
    expect(computePercentile([], 80)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test scripts/structure-audit/get-git-churn.test.ts
```

Expected: module not found.

- [ ] **Step 3: Write `get-git-churn.ts`**

Create `scripts/structure-audit/get-git-churn.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test scripts/structure-audit/get-git-churn.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Smoke-run against the repo**

```bash
bun run scripts/structure-audit/get-git-churn.ts
```

Expected: writes `docs/structure-audit/churn-90d.json`; prints `p80 = <N>` and top-10 most-changed files. Single `git log` invocation, sub-second total runtime even on the full monorepo.

- [ ] **Step 6: Commit**

```bash
git add scripts/structure-audit/get-git-churn.ts scripts/structure-audit/get-git-churn.test.ts
git commit -m "$(cat <<'EOF'
feat(structure-audit): add get-git-churn script (ranking input)

90-day per-file commit count + 80th-percentile cutoff. Output drives
the structural_impact_score=4 ranking criterion (high-churn hot path).

Output: docs/structure-audit/churn-90d.json (committed at Phase 1
baseline-measurement step).

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.5, § 5.1
EOF
)"
```

---

## Task 11: `audit-structure.ts` orchestrator

**Files:**
- Create: `scripts/structure-audit/audit-structure.ts`

(No unit test for the orchestrator — it's a thin wrapper. The smoke-test at step 4 is the verification.)

- [ ] **Step 1: Write the orchestrator**

Create `scripts/structure-audit/audit-structure.ts`:

```typescript
#!/usr/bin/env bun
// B3 audit orchestrator. Runs every signal source and writes a single
// run-<timestamp>.json blob at docs/structure-audit/. The Phase 2 missed.md
// is generated from this blob.
//
// Usage: bun run audit:structure

import { auditOutputPath, REPO_ROOT } from "./lib.ts";

type StepResult =
  | { name: string; ok: true; durationMs: number }
  | { name: string; ok: false; durationMs: number; exitCode: number };

async function step(name: string, cmd: readonly string[]): Promise<StepResult> {
  const start = performance.now();
  const proc = Bun.spawnSync(cmd, {
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const durationMs = Math.round(performance.now() - start);
  const ok = proc.exitCode === 0;
  return ok
    ? { name, ok, durationMs }
    : { name, ok: false, durationMs, exitCode: proc.exitCode ?? 1 };
}

async function run(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const results: StepResult[] = [];

  results.push(await step("dependency-cruiser", ["bunx", "dependency-cruiser", "--config", ".dependency-cruiser.cjs", "--no-progress", "--output-type", "err", "packages"]));
  results.push(await step("jscpd", ["bunx", "jscpd", "packages"]));
  results.push(await step("knip", ["bunx", "knip", "--reporter", "json"]));
  results.push(await step("file-loc", ["bun", "run", "scripts/structure-audit/measure-file-loc.ts"]));
  results.push(await step("any-count", ["bun", "run", "scripts/structure-audit/count-any-usage.ts"]));
  results.push(await step("risky-assertions", ["bun", "run", "scripts/structure-audit/list-risky-assertions.ts"]));
  results.push(await step("nimbus-invariants", ["bun", "run", "scripts/structure-audit/check-nimbus-invariants.ts"]));
  results.push(await step("git-churn", ["bun", "run", "scripts/structure-audit/get-git-churn.ts"]));

  const outPath = auditOutputPath(`run-${timestamp}.json`);
  await Bun.write(outPath, JSON.stringify({ timestamp, results }, null, 2) + "\n");
  console.log(`\nOrchestrator run blob: ${outPath}`);
  for (const r of results) {
    console.log(`  ${r.ok ? "OK " : "FAIL"} ${r.durationMs.toString().padStart(6)}ms  ${r.name}`);
  }

  // Don't exit non-zero on individual tool failures — the orchestrator's job is to
  // collect signal, not gate. The CI gate (_structure.yml) calls binary tools directly.
}

if (import.meta.main) await run();
```

- [ ] **Step 2: Make sure all the tools the orchestrator calls are runnable**

```bash
bunx dependency-cruiser --version
bunx jscpd --version
bunx knip --version
ls scripts/structure-audit/*.ts
```

Expected: each tool prints a version; all six TS scripts (`count-any-usage`, `list-risky-assertions`, `check-nimbus-invariants`, `measure-file-loc`, `get-git-churn`, `audit-structure`) plus `lib.ts` are listed.

- [ ] **Step 3: Smoke-run the orchestrator**

```bash
bun run scripts/structure-audit/audit-structure.ts
```

Expected: each step's stdout/stderr is forwarded; a `run-<timestamp>.json` blob is written; a summary table is printed. Some steps may report failures (knip exits non-zero when it finds unused exports — that's expected). Inspect the run blob's shape.

- [ ] **Step 4: Add `run-*.json` to `.gitignore`**

Each orchestrator invocation writes a per-run blob `docs/structure-audit/run-<timestamp>.json`. These are intentionally **not** committed (the committed artifacts are `any-baseline.json`, `db-run-census.json`, `churn-90d.json`, and `baseline.md` — the run blobs are debugging output). Append to `.gitignore`:

```bash
cat >> .gitignore <<'EOF'

# Per-run audit-orchestrator output (committed artifacts are tracked separately)
docs/structure-audit/run-*.json
EOF
```

Verify:
```bash
grep "run-\*\.json" .gitignore && echo ok
```

Expected: `docs/structure-audit/run-*.json` line present; prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add scripts/structure-audit/audit-structure.ts .gitignore
git commit -m "$(cat <<'EOF'
feat(structure-audit): add audit-structure orchestrator

Wraps every signal source (dep-cruiser, jscpd, knip, the six custom
scripts) and writes a per-run blob at
docs/structure-audit/run-<timestamp>.json. The Phase 2 missed.md is
generated from this blob.

Orchestrator does not gate — individual tool exit codes are recorded
in the blob, not aggregated into a process exit code.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.5
EOF
)"
```

---

## Task 12: Add `audit:*` scripts to root `package.json`

**Files:**
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Add the six audit:* scripts**

Open `package.json`. After the `"check-package": "bun scripts/check-package.ts",` line (around line 52), insert the six new audit scripts:

```diff
     "audit:high": "bun audit --audit-level high",
     "check-package": "bun scripts/check-package.ts",
+    "audit:structure": "bun scripts/structure-audit/audit-structure.ts",
+    "audit:boundaries": "bunx dependency-cruiser --config .dependency-cruiser.cjs --no-progress packages",
+    "audit:duplication": "bunx jscpd packages",
+    "audit:dead-code": "bunx knip",
+    "audit:any": "bun scripts/structure-audit/count-any-usage.ts",
+    "audit:invariants": "bun scripts/structure-audit/check-nimbus-invariants.ts --binary-only",
     "lint": "biome check .",
```

- [ ] **Step 2: Verify each new script runs**

```bash
bun run audit:any
echo "exit=$?"
bun run audit:invariants
echo "exit=$?"
bun run audit:boundaries
echo "exit=$?"
```

Expected:
- `audit:any` exits 2 the first time (no baseline file yet — that's Task 13).
- `audit:invariants` exits 0 (no D10/D11 violations on `main`).
- `audit:boundaries` exits 0 (no D1/D2/D3 violations on `main`).

If `audit:invariants` or `audit:boundaries` exits non-zero, **inspect the output** — those are real Phase 2 findings. Don't fix in Phase 1; record them for Phase 2.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
build(structure-audit): add six audit:* scripts to root package.json

audit:structure        — full pack via the orchestrator
audit:boundaries       — dep-cruiser only (called by CI in Phase 2)
audit:duplication      — jscpd only
audit:dead-code        — knip only
audit:any              — D8 count-any-usage (called by CI in Phase 2)
audit:invariants       — D10/D11 binary checks (called by CI in Phase 2)

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.6
EOF
)"
```

---

## Task 13: Generate and commit Phase 1 baselines

**Files:**
- Create: `docs/structure-audit/any-baseline.json` (committed)
- Create: `docs/structure-audit/db-run-census.json` (committed)
- Create: `docs/structure-audit/churn-90d.json` (committed)
- Create: `docs/structure-audit/baseline.md` (committed)

- [ ] **Step 1: Generate the `any` baseline**

```bash
bun run scripts/structure-audit/count-any-usage.ts --update
```

Expected: writes `docs/structure-audit/any-baseline.json` with `{ "count": <N>, "generated": "<ISO-timestamp>" }`. Confirm the file exists and the count is plausible (single digits to low hundreds for a TS monorepo of this size).

- [ ] **Step 2: Generate the `db-run` census**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule db-run
```

Expected: writes `docs/structure-audit/db-run-census.json` with an array of `{ file, line, function, snippet }` entries. Inspect to confirm shape.

- [ ] **Step 3: Generate the churn snapshot**

```bash
bun run scripts/structure-audit/get-git-churn.ts
```

Expected: writes `docs/structure-audit/churn-90d.json` with `{ files: [...], p80Threshold: <N> }`. May take 1-2 minutes (one `git rev-list` per file).

- [ ] **Step 4: Generate informational reports (not committed; for `baseline.md`)**

```bash
bun run scripts/structure-audit/measure-file-loc.ts        # → docs/structure-audit/file-loc.json
bun run scripts/structure-audit/list-risky-assertions.ts   # → docs/structure-audit/risky-assertions.json
```

These two outputs are not committed (regenerated each Phase 2 run); they're consumed by `baseline.md` immediately below.

- [ ] **Step 5: Capture the current commit SHA for provenance**

```bash
git rev-parse HEAD
```

Note the output for use in `baseline.md`.

- [ ] **Step 6: Write `baseline.md`**

Create `docs/structure-audit/baseline.md`. Substitute `<SHA>` with the output of Step 5 and `<N>` values with the counts from each script:

```markdown
# B3 Structure Audit — Phase 1 Baseline

**Generated at commit:** `<SHA>`
**Date:** 2026-04-30
**Phase 1 of:** [`docs/superpowers/specs/2026-04-30-structure-audit-design.md`](../superpowers/specs/2026-04-30-structure-audit-design.md)

This file is the measured starting state of the structure-audit dimensions on
the `dev/asafgolombek/structure-audit-design` branch. Phase 2's `missed.md`
ranks deviations from these baselines.

## Per-dimension baselines

| # | Bucket | Dimension | Baseline | Source / threshold |
|---|---|---|---|---|
| D1 | A | Forbidden cross-package imports | 0 violations | `bun run audit:boundaries` (binary) |
| D2 | A | Cyclic imports within a workspace | 0 violations | `bun run audit:boundaries` (binary) |
| D3 | A | PAL leakage | 0 violations | `bun run audit:boundaries` (binary) |
| D4 | B | Files > 800 raw LOC | <N> files (top file: <name>:<loc>) | `docs/structure-audit/file-loc.json` |
| D5 | B | Functions with cognitive complexity > 15 | <N> | SonarQube dashboard (post-analysis) |
| D6 | C | Per-workspace duplication % | <%> overall (`statistics.total.percentage` from jscpd-report) | `docs/structure-audit/jscpd-report.json` |
| D7 | D | Unused exports / orphan files | <N> after Phase 1 cleanup pass | `docs/structure-audit/knip-report.json` |
| D8 | D | `any` count | <N> (frozen in `any-baseline.json`) | `bun run audit:any` |
| D9 | D | Risky type assertions (informational) | <N> | `docs/structure-audit/risky-assertions.json` |
| D10 | F | Spawn under connectors/ not via `extensionProcessEnv()` | 0 violations | `bun run audit:invariants` (binary) |
| D11 | F | Vault-key construction outside allow-list | 0 violations | `bun run audit:invariants` (binary) |
| D12 | F | `db.run()` outside `db/write.ts` (census) | <N> sites | `docs/structure-audit/db-run-census.json` |

## Provenance

- `count-any-usage` script: `scripts/structure-audit/count-any-usage.ts` @ `<SHA>`
- `check-nimbus-invariants` script: `scripts/structure-audit/check-nimbus-invariants.ts` @ `<SHA>`
- `measure-file-loc` script: `scripts/structure-audit/measure-file-loc.ts` @ `<SHA>`
- `get-git-churn` script: `scripts/structure-audit/get-git-churn.ts` @ `<SHA>`
- `list-risky-assertions` script: `scripts/structure-audit/list-risky-assertions.ts` @ `<SHA>`
- `dependency-cruiser` config: `.dependency-cruiser.cjs` @ `<SHA>`
- `jscpd` config: `.jscpd.json` @ `<SHA>`
- `knip` config: `knip.json` @ `<SHA>`

## Phase 2 thresholds derived from this baseline

- **D8 manual ratchet:** any new PR's `any` count must equal `<N>` from this file. Reductions require updating `any-baseline.json` in the same PR (see spec § 3.3).
- **D6 duplication threshold:** `> 3 %` per workspace, **or** any duplicated block ≥ 100 tokens (whichever fires first).
- **D4 LOC threshold:** `> 800` raw LOC per file.
- **D5 cognitive complexity threshold:** `> 15` per function (SonarQube).
- **`structural_impact_score = 4` cutoff:** files in the top 20% by 90-day commit count (`p80Threshold` in `churn-90d.json`).

## Files committed at Phase 1 close

- `docs/structure-audit/any-baseline.json`
- `docs/structure-audit/db-run-census.json`
- `docs/structure-audit/churn-90d.json`
- `docs/structure-audit/baseline.md` (this file)
- `docs/structure-audit/sonarqube-rule-tuning.md` (empty placeholder, populated only if Phase 2 needs rule tuning)
```

**This file MUST NOT be committed with `<…>` placeholders.** For each placeholder:

- `<SHA>` — output of `git rev-parse HEAD` from Step 5.
- `<N>` for D8 — `count` field from `docs/structure-audit/any-baseline.json`.
- `<N>` for D12 — `length` of the array in `docs/structure-audit/db-run-census.json` (run `bun -e 'console.log((await Bun.file("docs/structure-audit/db-run-census.json").json()).length)'`).
- `<N>` for D4 — count of entries in `docs/structure-audit/file-loc.json` whose `loc > 800`. Top file: the first row of that array.
- `<N>` for D6 — `statistics.total.percentage` from `docs/structure-audit/jscpd-report.json`.
- `<N>` for D7 — sum of files-with-issues from `docs/structure-audit/knip-report.json` (run `bunx knip --reporter symbols` and count visible items).
- `<N>` for D5 — leave as `(pending — populated when Phase 2 uploads the first SonarQube analysis)` for now; SonarQube isn't analysed in Phase 1.
- `<N>` for D9 — `length` of the array in `docs/structure-audit/risky-assertions.json`.
- `<N>` for D11 — `0` (verified by `bun run audit:invariants` exiting 0 in Step 6).

Read each output file, extract the value, and write it into `baseline.md`. Do not leave any `<…>` placeholder in the committed file.

- [ ] **Step 7: Verify all Phase 1 committed JSON files validate**

```bash
bun -e 'await Bun.file("docs/structure-audit/any-baseline.json").json(); await Bun.file("docs/structure-audit/db-run-census.json").json(); await Bun.file("docs/structure-audit/churn-90d.json").json(); console.log("ok")'
```

Expected: prints `ok`.

- [ ] **Step 8: Commit baselines**

```bash
git add docs/structure-audit/any-baseline.json docs/structure-audit/db-run-census.json docs/structure-audit/churn-90d.json docs/structure-audit/baseline.md
git commit -m "$(cat <<'EOF'
docs(structure-audit): commit Phase 1 baselines

Generated by the audit scripts on this branch's tip commit. Three
machine-readable JSON files plus the human-readable baseline.md
summary with provenance.

- any-baseline.json — D8 manual-ratchet pin (locked count)
- db-run-census.json — D12 enumeration for future S5-F4 design
- churn-90d.json — 90-day commit-count snapshot + 80th-percentile cutoff
- baseline.md — per-dimension starting state, threshold derivations

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 7.1
EOF
)"
```

---

## Task 14: Knip baseline cleanup pass

**Files:**
- Modify: `knip.json` (tune `ignore` list / workspace `ignore` blocks based on Phase 1 dry-run output)
- Optionally add `// @knip-ignore` annotations on legitimately-unused exports
- Create: `docs/structure-audit/knip-report.json` (committed for provenance)

- [ ] **Step 1: Run knip and inspect the report**

```bash
bunx knip --reporter json > docs/structure-audit/knip-report.json
bunx knip --reporter symbols  # human-readable
```

Note the categories of findings: unused files, unused dependencies, unused exports, unused enum members, unresolved imports.

- [ ] **Step 2: Triage**

For each finding category, decide:

1. **Genuine unused export** — leave as a Phase 2 finding; do not fix here.
2. **False positive caused by knip not understanding an entry point** — add the entry path to the workspace's `entry` array in `knip.json`.
3. **False positive caused by intentional re-export** (e.g., a package's public API surface) — add a `// @knip-ignore export <Name>` comment immediately before the export, OR add the file to the workspace's `ignore` block in `knip.json`.

**Stay narrow.** The goal is a *signal-clean* report, not zero findings. Only suppress what's verifiably a false positive (the engineer can explain why the export *is* needed). When in doubt, leave it as a finding.

Repeat run + tune until the report's `unused-exports` and `unused-files` categories contain only items that are genuinely unused (Phase 2 will rank them).

- [ ] **Step 3: Re-run with the tuned config**

```bash
bunx knip --reporter json > docs/structure-audit/knip-report.json
```

Inspect: confirm signal-clean.

- [ ] **Step 4: Commit**

```bash
git add knip.json docs/structure-audit/knip-report.json
# Stage any @knip-ignore comments added in source files:
git add -u packages/  # only if files were touched in Step 2
git commit -m "$(cat <<'EOF'
chore(structure-audit): knip baseline cleanup pass

Tuned knip.json entry/ignore patterns and added @knip-ignore
annotations on legitimately-unused exports (intentional public API
surfaces). Goal: a signal-clean baseline report so Phase 2's D7
ranking reflects real findings, not config noise.

Genuine unused-exports remaining in the report are Phase 2 findings.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 7.1
(Knip baseline cleanup pass)
EOF
)"
```

---

## Task 15: SonarQube rule-tuning placeholder

**Files:**
- Create: `docs/structure-audit/sonarqube-rule-tuning.md`

- [ ] **Step 1: Write the placeholder file**

Create `docs/structure-audit/sonarqube-rule-tuning.md`:

```markdown
# SonarQube rule tuning — B3 audit

This file is empty by design. It is populated **only if** Phase 2's first
SonarQube analysis run produces unacceptable signal-to-noise on the default
Sonar Way profile, requiring explicit rule disables.

If you disable a rule, record:

- Rule key (e.g., `typescript:S1135`)
- Reason (one sentence; tie to a non-negotiable, an existing test, or a stylistic
  decision documented in `CLAUDE.md` / `docs/architecture.md`)
- Date
- Disabled in: `.sonarcloud.properties` / SonarQube web UI / etc.

Format:

| Rule | Reason | Date | Where |
|---|---|---|---|
| `typescript:Sxxxx` | … | YYYY-MM-DD | … |

If Phase 2 does not need to disable any rule, this file remains empty and is
removed at B3 close.

Spec reference: `docs/superpowers/specs/2026-04-30-structure-audit-design.md` § 4.1
```

- [ ] **Step 2: Commit**

```bash
git add docs/structure-audit/sonarqube-rule-tuning.md
git commit -m "$(cat <<'EOF'
docs(structure-audit): add empty SonarQube rule-tuning placeholder

Populated only if Phase 2's analysis run requires explicit rule
disables. Otherwise removed at B3 close.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.1, § 7.1
EOF
)"
```

---

## Final Verification

- [ ] **Run the full local audit end-to-end**

```bash
bun run audit:structure
echo "audit:structure exit=$?"
bun run audit:boundaries
echo "audit:boundaries exit=$?"
bun run audit:any
echo "audit:any exit=$?"
bun run audit:invariants
echo "audit:invariants exit=$?"
bun run audit:duplication
echo "audit:duplication exit=$?"
bun run audit:dead-code
echo "audit:dead-code exit=$?"
```

Expected:
- `audit:structure` exits 0 (orchestrator never aggregates failures into its exit code).
- `audit:boundaries` exits 0 (no D1/D2/D3 violations on this branch).
- `audit:any` exits 0 (current count matches the just-committed baseline).
- `audit:invariants` exits 0 (no D10/D11 violations on this branch).
- `audit:duplication` may exit 1 if total duplication exceeds 3 % — that's a Phase 2 finding, fine.
- `audit:dead-code` may exit 1 if knip finds unused — that's a Phase 2 finding, fine.

- [ ] **Run the full test suite to confirm no regressions**

```bash
bun run typecheck
bun run lint
bun test scripts/structure-audit/
```

Expected: all green.

- [ ] **Run the project's CI-parity test suite**

```bash
bun run test:ci
```

Expected: passes (this is the standing pre-PR command per `feedback_preflight_before_pr.md` in user memory).

If any test fails that did not fail before this branch, investigate and fix in a small follow-up commit on this branch before opening the PR.

- [ ] **Verify branch state**

```bash
git status
git log --oneline -20
```

Expected: clean working tree; ~15 new commits on `dev/asafgolombek/structure-audit-design` (3 pre-existing + 12 from Phase 1, depending on how cleanup commits broke down).

---

## Phase 1 Definition of Done

All of the following must be true before declaring Phase 1 complete:

- [ ] All 15 tasks above are checked off.
- [ ] `package.json` has the six new `audit:*` scripts.
- [ ] `bun.lock` reflects the three new dev deps (verified by `bun install --frozen-lockfile` succeeding).
- [ ] All five committed config files are present: `sonar-project.properties`, `.dependency-cruiser.cjs`, `.jscpd.json`, `knip.json`, plus `docs/structure-audit/sonarqube-rule-tuning.md` placeholder.
- [ ] All seven new scripts compile and run: `lib.ts`, `count-any-usage.ts`, `list-risky-assertions.ts`, `check-nimbus-invariants.ts`, `measure-file-loc.ts`, `get-git-churn.ts`, `audit-structure.ts`.
- [ ] All five test files exist and pass: `count-any-usage.test.ts`, `list-risky-assertions.test.ts`, `check-nimbus-invariants.test.ts`, `measure-file-loc.test.ts`, `get-git-churn.test.ts`.
- [ ] Four committed baseline artifacts: `any-baseline.json`, `db-run-census.json`, `churn-90d.json`, `baseline.md`.
- [ ] `bun run test:ci` passes locally.
- [ ] No regressions in unrelated packages.

After Phase 1 lands, the next step is the **Phase 2 plan** (`docs/superpowers/plans/<later-date>-structure-audit-phase-2.md`), which will use the committed baselines to:

1. Produce the ranked `missed.md`.
2. Sort findings into top-5 fixes vs deferred-backlog.
3. Ship `.github/workflows/_structure.yml` (with thresholds derived from `baseline.md`).
4. Write the per-subsystem fix plans.

Phase 2 cannot be planned in detail until Phase 1's measurements exist — the threshold values, the ranking-input churn data, and the actual list of findings all come from Phase 1's output.
