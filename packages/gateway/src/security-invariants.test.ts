import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SRC_ROOT = import.meta.dir;
// SRC_ROOT = packages/gateway/src → REPO_ROOT three levels up
const REPO_ROOT = resolve(SRC_ROOT, "..", "..", "..");

async function read(relPathFromRepoRoot: string): Promise<string> {
  return readFile(resolve(REPO_ROOT, relPathFromRepoRoot), "utf8");
}

async function readDirConcat(relDirFromRepoRoot: string): Promise<string> {
  const dir = resolve(REPO_ROOT, relDirFromRepoRoot);
  const entries = await readdir(dir);
  const tsFiles = entries.filter((f) => f.endsWith(".ts"));
  const contents = await Promise.all(tsFiles.map((f) => readFile(resolve(dir, f), "utf8")));
  return contents.join("\n");
}

/**
 * Enforcement tests for {@link ../../docs/SECURITY-INVARIANTS.md SECURITY-INVARIANTS.md}.
 *
 * These tests pin structural defenses to the production source. The B1 audit
 * (docs/superpowers/specs/2026-04-25-security-audit-results.md) found that
 * several defenses (extensionProcessEnv, checkLanMethodAllowed, the
 * <tool_output> envelope) existed in the codebase but had zero production
 * callers. Each test below fails if the corresponding defense is removed,
 * orphaned, or routed around.
 *
 * If you change a wiring site referenced here, update both this test and the
 * matching invariant in SECURITY-INVARIANTS.md in the same commit.
 */

describe("I1 — extensionProcessEnv is the only env source for spawned MCP children", () => {
  test("lazy-mesh/ contains no raw `{ ...process.env }` spread", async () => {
    const src = await readDirConcat("packages/gateway/src/connectors/lazy-mesh");
    expect(src).not.toMatch(/\{\s*\.\.\.process\.env\s*\}/);
  });

  test("lazy-mesh/ uses extensionProcessEnv() at every spawn site", async () => {
    const src = await readDirConcat("packages/gateway/src/connectors/lazy-mesh");
    const callers = src.match(/extensionProcessEnv\(/g) ?? [];
    expect(callers.length).toBeGreaterThanOrEqual(20);
  });

  test("extensionProcessEnv uses an allowlist (BASELINE_KEYS) — denylist would let new secrets leak by default", async () => {
    const src = await read("packages/gateway/src/extensions/spawn-env.ts");
    expect(src).toMatch(/BASELINE_KEYS/);
    // Verify it is an allowlist construction over a literal key list, not a process.env spread.
    expect(src).not.toMatch(/\.\.\.process\.env/);
    expect(src).toMatch(/process\.env\[k\]/);
  });
});

describe("I2 — HITL frozen-set membership", () => {
  test("HITL_REQUIRED is exported from a frozen Object.freeze façade", async () => {
    const src = await read("packages/gateway/src/engine/executor.ts");
    expect(src).toMatch(/export const HITL_REQUIRED\s*=\s*Object\.freeze\(/);
  });

  test("HITL_REQUIRED_BACKING is module-private (not exported)", async () => {
    const src = await read("packages/gateway/src/engine/executor.ts");
    expect(src).not.toMatch(/export\s+(?:const|let|var)\s+HITL_REQUIRED_BACKING/);
  });
});

describe("I3 — HITL gate consults action.type (not payload.mcpToolId)", () => {
  test("executor.gate looks up HITL_REQUIRED.has(action.type), not the routing-only mcpToolId", async () => {
    const src = await read("packages/gateway/src/engine/executor.ts");
    expect(src).toMatch(/HITL_REQUIRED\.has\(action\.type\)/);
    // Negative: must NOT consult mcpToolId for the HITL decision (commit 2c9ff06 reverted that — it was a bypass).
    expect(src).not.toMatch(/HITL_REQUIRED\.has\(\s*action\.payload/);
    expect(src).not.toMatch(/HITL_REQUIRED\.has\(\s*resolvedToolId\s*\)/);
  });

  test("dispatcher uses action.type when payload.mcpToolId is absent", async () => {
    const src = await read("packages/gateway/src/connectors/registry.ts");
    expect(src).toMatch(/mcpToolId/);
    expect(src).toMatch(/action\.type/);
  });
});

describe("I4 — hitlStatus is consent-output-only in production paths", () => {
  test("data-delete.ts does not hardcode hitlStatus", async () => {
    const src = await read("packages/gateway/src/commands/data-delete.ts");
    expect(src).not.toMatch(/hitlStatus:\s*"approved"/);
  });
});

describe("I5 — LAN method allowlist is intrinsic to LanServer", () => {
  test("lan-server.ts calls checkLanMethodAllowed before forwarding to onMessage", async () => {
    const src = await read("packages/gateway/src/ipc/lan-server.ts");
    expect(src).toMatch(/checkLanMethodAllowed\(/);
  });

  test("FORBIDDEN_OVER_LAN includes the exfiltration namespaces", async () => {
    const src = await read("packages/gateway/src/ipc/lan-rpc.ts");
    for (const ns of ["vault", "updater", "lan", "profile", "audit", "data"]) {
      expect(src).toMatch(new RegExp(`"${ns}"`));
    }
    expect(src).toMatch(/"connector\.addMcp"/);
  });
});

describe("I6 — LAN bind defaults to loopback", () => {
  test("DEFAULT_NIMBUS_LAN_TOML.bind is 127.0.0.1, never 0.0.0.0", async () => {
    const src = await read("packages/gateway/src/config/nimbus-toml.ts");
    expect(src).not.toMatch(/bind:\s*"0\.0\.0\.0"/);
    expect(src).toMatch(/bind:\s*"127\.0\.0\.1"/);
  });
});

describe("I8 — Tauri renderer CSP is restrictive", () => {
  test("tauri.conf.json sets a non-null, non-unsafe CSP", async () => {
    const raw = await read("packages/ui/src-tauri/tauri.conf.json");
    const conf = JSON.parse(raw) as { app?: { security?: { csp?: string | null } } };
    const csp = conf.app?.security?.csp;
    expect(csp).toBeTypeOf("string");
    expect(csp).not.toBeNull();
    expect(csp ?? "").not.toMatch(/unsafe-inline/);
    expect(csp ?? "").not.toMatch(/unsafe-eval/);
    expect(csp ?? "").toMatch(/default-src 'self'/);
  });
});

describe("I11 — Tool-result envelope on the LLM-facing path", () => {
  test("wrapToolOutput is exported from tool-output-envelope.ts", async () => {
    const src = await read("packages/gateway/src/engine/tool-output-envelope.ts");
    expect(src).toMatch(/export function wrapToolOutput/);
  });

  test("the envelope helper escapes literal </tool_output> sequences inside tool bodies", async () => {
    const src = await read("packages/gateway/src/engine/tool-output-envelope.ts");
    // Body must replace </tool_output> with the escaped form so an attacker-controlled
    // tool result cannot terminate the envelope and re-enter "instruction mode".
    expect(src).toMatch(/replaceAll\("<\/tool_output>"/);
  });

  test("agent.ts wraps tool results with the envelope on the LLM-facing path", async () => {
    const src = await read("packages/gateway/src/engine/agent.ts");
    expect(src).toMatch(/wrapToolOutput\(/);
  });
});
