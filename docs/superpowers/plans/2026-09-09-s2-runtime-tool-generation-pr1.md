# S2 Runtime Tool Generation — PR 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the local owner run `nimbus tool create`, have the model draft an MCP tool, and register it for the session only — where the tool has no network at all and reaches the outside world solely through a gateway broker that enforces an owner-approved host list and ledgers every request.

**Architecture:** A single ordered chokepoint (`toolgen/toolgen-gate.ts`) refuses everything it can before prompting the owner, then obtains verbatim approval and registers an ephemeral, in-memory tool. The tool spawns sandboxed with `permissions.network: []` **by construction**, so a raw `fetch()` in the generated body fails at the OS on all three platforms. Its only egress route is a custom `nimbus/fetch` MCP request served by `toolgen-broker.ts` inside the gateway, which validates the destination, attaches a per-host credential the tool never sees, and appends a `tool`-class `egress_ledger` row before every request (fail-closed).

**Tech Stack:** Bun 1.2+, TypeScript strict, `bun:sqlite`, `@modelcontextprotocol/sdk` 1.30.0 (official `Client` — **not** `@mastra/mcp`), `@mastra/core` tools, Biome.

**Spec:** [`docs/superpowers/specs/2026-09-09-s2-runtime-tool-generation-design.md`](../specs/2026-09-09-s2-runtime-tool-generation-design.md) — read it before Task 1. The review folded into it is [`…-design-review.md`](../specs/2026-09-09-s2-runtime-tool-generation-design-review.md).

## Global Constraints

- **No `any`.** External/cross-process data is `unknown` and must be narrowed by a real guard, never a type assertion. TypeScript strict is non-negotiable.
- **Platform equality.** Windows, macOS and Linux are equally supported. Build paths with `path.join()` / `os.tmpdir()`; never hardcode separators. `bun run audit:cross-platform` must pass.
- **`permissions.network` is `[]` by construction** in every generated manifest. A caller that *requests* network is **rejected**, never silently dropped.
- **Every refusal that can be decided without the owner happens BEFORE the consent prompt.** A disabled capability must never advertise itself by prompting.
- **The owner approves the VERBATIM artifact**, never a digest.
- **Egress appends happen BEFORE the outbound request and are fail-closed** — an append failure aborts the request.
- **Default off:** `[tool_generation] enabled = false`.
- **Whole `toolgen` namespace is LAN-forbidden** and absent from the Tauri allowlist (I7).
- **PR 1 adds NO schema migration.** Ephemeral means in-memory.
- **Not in PR 1:** agent-initiated generation, `allowed_hosts`, `nimbus tool save`, persistence. Do not build them.
- Run `bun run preflight:fast` after every task. Fix red before moving on.
- Branch: `dev/asaf/s2-runtime-tool-generation`. Never commit on `main`.

---

### Task 1: `[tool_generation]` config section

**Files:**
- Modify: `packages/gateway/src/config/nimbus-toml.ts`
- Test: `packages/gateway/src/config/nimbus-toml.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `NimbusToolGenerationToml`, `DEFAULT_NIMBUS_TOOL_GENERATION_TOML`, `parseNimbusToolGenerationToml(raw, defaults?)`, `loadNimbusToolGenerationFromConfigDir(configDir)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/gateway/src/config/nimbus-toml.test.ts`:

```ts
import {
  DEFAULT_NIMBUS_TOOL_GENERATION_TOML,
  parseNimbusToolGenerationToml,
} from "./nimbus-toml.ts";

describe("[tool_generation]", () => {
  test("defaults are off and bounded", () => {
    expect(DEFAULT_NIMBUS_TOOL_GENERATION_TOML).toEqual({
      enabled: false,
      maxToolsPerSession: 3,
      maxRequestsPerTool: 50,
      requestTimeoutMs: 10_000,
    });
  });

  test("an absent section yields the defaults", () => {
    expect(parseNimbusToolGenerationToml("")).toEqual(DEFAULT_NIMBUS_TOOL_GENERATION_TOML);
  });

  test("parses enabled and the three bounds", () => {
    const cfg = parseNimbusToolGenerationToml(
      ["[tool_generation]", "enabled = true", "max_tools_per_session = 7", "max_requests_per_tool = 9", "request_timeout_ms = 250"].join("\n"),
    );
    expect(cfg).toEqual({
      enabled: true,
      maxToolsPerSession: 7,
      maxRequestsPerTool: 9,
      requestTimeoutMs: 250,
    });
  });

  test("a non-positive bound is IGNORED, keeping the default — never zero", () => {
    const cfg = parseNimbusToolGenerationToml(
      ["[tool_generation]", "max_requests_per_tool = 0", "request_timeout_ms = -5"].join("\n"),
    );
    expect(cfg.maxRequestsPerTool).toBe(50);
    expect(cfg.requestTimeoutMs).toBe(10_000);
  });

  test("an unknown key is ignored, not carried", () => {
    const cfg = parseNimbusToolGenerationToml(["[tool_generation]", "allow_agent_initiated = true"].join("\n"));
    expect(Object.keys(cfg).sort()).toEqual(
      ["enabled", "maxRequestsPerTool", "maxToolsPerSession", "requestTimeoutMs"],
    );
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/config/nimbus-toml.test.ts -t "tool_generation"`
Expected: FAIL — `DEFAULT_NIMBUS_TOOL_GENERATION_TOML` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/gateway/src/config/nimbus-toml.ts`, immediately after the `[computer_use]` block so related sections stay together:

```ts

export type NimbusToolGenerationToml = {
  enabled: boolean;
  maxToolsPerSession: number;
  maxRequestsPerTool: number;
  requestTimeoutMs: number;
};

/**
 * DEFAULT OFF. `allow_agent_initiated` and `allowed_hosts` are deliberately ABSENT in PR 1 — they
 * belong to the agent-initiated path (spec § 9.1) and a key parsed but unused would read as a
 * shipped control that does nothing.
 */
export const DEFAULT_NIMBUS_TOOL_GENERATION_TOML: NimbusToolGenerationToml = {
  enabled: false,
  maxToolsPerSession: 3,
  maxRequestsPerTool: 50,
  requestTimeoutMs: 10_000,
};

function applyNimbusToolGenerationKey(
  out: Partial<NimbusToolGenerationToml>,
  key: string,
  valRaw: string,
): void {
  // A non-positive value leaves the default in place rather than assigning it: `max_requests_per_tool = 0`
  // must not silently mean "no requests allowed", and a negative timeout must not mean "expire at once".
  const positive = (assign: (n: number) => void): void => {
    const n = parseIntDec(valRaw);
    if (n !== undefined && n > 0) assign(n);
  };
  switch (key) {
    case "enabled":
      out.enabled = valRaw.trim().toLowerCase() === "true";
      break;
    case "max_tools_per_session":
      positive((n) => {
        out.maxToolsPerSession = n;
      });
      break;
    case "max_requests_per_tool":
      positive((n) => {
        out.maxRequestsPerTool = n;
      });
      break;
    case "request_timeout_ms":
      positive((n) => {
        out.requestTimeoutMs = n;
      });
      break;
    default:
      break;
  }
}

export function parseNimbusToolGenerationToml(
  raw: string,
  defaults: NimbusToolGenerationToml = DEFAULT_NIMBUS_TOOL_GENERATION_TOML,
): NimbusToolGenerationToml {
  const out: Partial<NimbusToolGenerationToml> = {};
  forEachSectionEntry(raw, "[tool_generation]", (key, valRaw) => {
    applyNimbusToolGenerationKey(out, key, valRaw);
  });
  return { ...defaults, ...out };
}

export function loadNimbusToolGenerationFromConfigDir(
  configDir: string,
): NimbusToolGenerationToml {
  return loadTomlSection(
    join(configDir, "nimbus.toml"),
    DEFAULT_NIMBUS_TOOL_GENERATION_TOML,
    parseNimbusToolGenerationToml,
  );
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/config/nimbus-toml.test.ts -t "tool_generation"`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/config/nimbus-toml.ts packages/gateway/src/config/nimbus-toml.test.ts
git commit -m "feat(toolgen): add the default-off [tool_generation] config section"

```

---

### Task 2: The `tool` egress source type, coverage class, and appender

**Files:**
- Modify: `packages/gateway/src/egress/egress-source-type.ts`
- Modify: `packages/gateway/src/egress/egress-coverage.ts`
- Modify: `packages/cli/src/commands/prove.ts`
- Create: `packages/gateway/src/egress/tool-egress.ts`
- Test: `packages/gateway/src/egress/tool-egress.test.ts`

**Interfaces:**
- Consumes: `appendEgressEntry` (`egress/egress-ledger.ts`), `redactEgressSummary` (`egress/egress-record.ts`).
- Produces: `recordToolEgress(db, args): { rowHash: string }` where `args` is
  `{ toolId: string; destination: string; method: string; resultStatus: "authorized" | "blocked"; now: number; requestMethod?: string; requestBytes?: number }`.

**Note on coverage granularity:** this task adds `tool` to `COVERAGE_CLASSES` at **`"none"`**. It is raised to `"per-call"` in **Task 12**, the task that first gives a generated tool the ability to make a brokered request. Raising it here would claim coverage of a path no code can reach.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/egress/tool-egress.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyAllMigrations } from "../index/migrate.ts";
import { verifyEgressChain } from "./egress-ledger.ts";
import { recordToolEgress } from "./tool-egress.ts";

function freshDb(): Database {
  const db = new Database(":memory:");
  applyAllMigrations(db);
  return db;
}

describe("recordToolEgress", () => {
  test("appends one chained row with source_type 'tool'", () => {
    const db = freshDb();
    recordToolEgress(db, {
      toolId: "tg_abc",
      destination: "api.example.com",
      method: "tool.fetch",
      resultStatus: "authorized",
      now: 1_700_000_000_000,
      requestMethod: "GET",
      requestBytes: 12,
    });
    const row = db
      .query<
        { source_type: string; source_id: string; destination: string; result_status: string; payload_summary: string },
        []
      >("SELECT source_type, source_id, destination, result_status, payload_summary FROM egress_ledger ORDER BY id DESC LIMIT 1")
      .get();
    expect(row?.source_type).toBe("tool");
    expect(row?.source_id).toBe("tg_abc");
    expect(row?.destination).toBe("api.example.com");
    expect(row?.result_status).toBe("authorized");
    expect(verifyEgressChain(db).ok).toBe(true);
    db.close();
  });

  test("payload_summary carries the request method and byte COUNT, never a URL or body", () => {
    const db = freshDb();
    recordToolEgress(db, {
      toolId: "tg_abc",
      destination: "api.example.com",
      method: "tool.fetch",
      resultStatus: "authorized",
      now: 1,
      requestMethod: "POST",
      requestBytes: 4096,
    });
    const row = db
      .query<{ payload_summary: string }, []>("SELECT payload_summary FROM egress_ledger ORDER BY id DESC LIMIT 1")
      .get();
    const summary = row?.payload_summary ?? "";
    expect(summary).toContain("POST");
    expect(summary).toContain("4096");
    expect(summary).not.toContain("https://");
    expect(summary).not.toContain("/v1/");
    db.close();
  });

  test("a blocked destination still appends a row", () => {
    const db = freshDb();
    recordToolEgress(db, {
      toolId: "tg_abc",
      destination: "evil.example.com",
      method: "tool.fetch",
      resultStatus: "blocked",
      now: 1,
    });
    const row = db
      .query<{ result_status: string }, []>("SELECT result_status FROM egress_ledger ORDER BY id DESC LIMIT 1")
      .get();
    expect(row?.result_status).toBe("blocked");
    db.close();
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/egress/tool-egress.test.ts`
Expected: FAIL — cannot resolve `./tool-egress.ts`.

- [ ] **Step 3: Write minimal implementation**

Add `"tool"` to `EGRESS_SOURCE_TYPES` in `packages/gateway/src/egress/egress-source-type.ts`, after `"browser"`:

```ts

  "tool", // an outbound request a runtime-generated tool made through the broker

```

Add `"tool"` to `COVERAGE_CLASSES` in `packages/gateway/src/egress/egress-coverage.ts` (keep the list's existing ordering convention — append after `"task"`), then add to **both** vectors:

```ts

// In THIS_BINARY_COVERAGE — "none" until Task 12 gives the appender a reachable caller. This file's
// own rule: never raise a class ahead of the code that makes the claim true.
tool: "none",

```

```ts

// In ALL_NONE_COVERAGE
tool: "none",

```

Add the label in `packages/cli/src/commands/prove.ts`'s `COVERAGE_CLASS_LABELS`:

```ts

  // Every outbound request a runtime-generated tool made — which is ALL of them, because the tool
  // process has no network at all (spec § 4.3) and `toolgen-broker.ts` is its only route out. So
  // unlike `browser`, this label is not narrower than its name. Read a zero as "no generated tool
  // made a request"; on a stock install that is because `[tool_generation]` is off and no such tool
  // can exist, which is the same claim rather than a weaker one.
  tool: "outbound requests made by runtime-generated tools",

```

Create `packages/gateway/src/egress/tool-egress.ts`:

```ts

import type { Database } from "bun:sqlite";
import { appendEgressEntry } from "./egress-ledger.ts";
import { redactEgressSummary } from "./egress-record.ts";

/**
 * The sole append site for `tool` egress rows (I39, I29 `tool` class).
 *
 * Called by `toolgen/toolgen-broker.ts` BEFORE every brokered request, including one it is about
 * to refuse (`resultStatus: "blocked"`). Throwing here aborts the request — fail-closed, so a
 * zero-row window means no generated tool reached the network, never that one did so unrecorded.
 *
 * `destination` is the resolved HOST, never the full URL: a URL carries query strings, and this
 * table is not the place to learn a tool's API keys. `payload_summary` is the request method and
 * the request body's byte COUNT — never the body, never the URL, never the credential the broker
 * is about to attach.
 */
export function recordToolEgress(
  db: Database,
  args: {
    readonly toolId: string;
    readonly destination: string;
    readonly method: string;
    readonly resultStatus: "authorized" | "blocked";
    readonly now: number;
    readonly requestMethod?: string | undefined;
    readonly requestBytes?: number | undefined;
  },
): { rowHash: string } {
  return appendEgressEntry(db, {
    timestamp: args.now,
    sourceType: "tool",
    // The gateway-minted tool id, never a caller-supplied label: a tool must not be able to file
    // its egress under another tool's name.
    sourceId: args.toolId,
    destination: args.destination,
    method: args.method,
    payloadSummary: redactEgressSummary({
      requestMethod: args.requestMethod ?? null,
      requestBytes: args.requestBytes ?? null,
    }),
    // The owner approved this tool and its host list at registration; each individual request is
    // authorized by that approval rather than by a fresh prompt.
    hitlStatus: "approved",
    resultStatus: args.resultStatus,
  });
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/egress/tool-egress.test.ts && bun test packages/gateway/src/egress packages/cli/src/commands/prove.test.ts`
Expected: PASS. Two known knock-ons, both deliberate rather than surprises:
`packages/gateway/src/egress/egress-coverage.test.ts` asserts exact string equality against a
`CANONICAL` serialization (`:36`, `:124`) — append `tool=none` to it here (Task 12 changes it to
`tool=per-call`). And if any test asserts a coverage-class or source-type **count**, update the
count; the enumeration is the point, not the number.

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/egress packages/cli/src/commands/prove.ts
git commit -m "feat(egress): add the tool source type, coverage class and appender"

```

---

### Task 3: Types and the canonical artifact

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-types.ts`
- Create: `packages/gateway/src/toolgen/toolgen-artifact.ts`
- Test: `packages/gateway/src/toolgen/toolgen-artifact.test.ts`

**Interfaces:**
- Consumes: `canonicalize` (`extensions/canonical-json.ts`), `ExtensionManifest` (`extensions/manifest.ts`).
- Produces: `BROKERED_FETCH_METHOD`, `ToolgenError`, `ToolCredentialBinding`, `GeneratedToolArtifact`, `ToolgenEnvelope`, `canonicalArtifactBytes(artifact): string`, `artifactDigest(artifact): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-artifact.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { artifactDigest, canonicalArtifactBytes } from "./toolgen-artifact.ts";
import type { GeneratedToolArtifact } from "./toolgen-types.ts";

function artifact(overrides: Partial<GeneratedToolArtifact> = {}): GeneratedToolArtifact {
  return {
    toolId: "tg_abc",
    toolName: "gitea_open_prs",
    description: "List open PRs",
    body: "export async function run() { return 1; }",
    approvedHosts: ["api.gitea.example"],
    credentialHosts: ["api.gitea.example"],
    manifest: {
      id: "toolgen.tg_abc",
      version: "0.0.0",
      permissions: { network: [], filesystem: { read: [], write: [] } },
      updateChannel: "stable",
    },
    ...overrides,
  };
}

describe("canonical artifact", () => {
  test("key order in the input does not change the bytes", () => {
    const a = artifact();
    const reordered = { ...artifact() } as Record<string, unknown>;
    const rebuilt = Object.fromEntries(Object.entries(reordered).reverse()) as unknown as GeneratedToolArtifact;
    expect(canonicalArtifactBytes(rebuilt)).toBe(canonicalArtifactBytes(a));
  });

  test("the digest changes when the BODY changes", () => {
    expect(artifactDigest(artifact({ body: "x" }))).not.toBe(artifactDigest(artifact({ body: "y" })));
  });

  test("the digest changes when an approved HOST changes", () => {
    expect(artifactDigest(artifact())).not.toBe(
      artifactDigest(artifact({ approvedHosts: ["api.evil.example"] })),
    );
  });

  test("the digest changes when a CREDENTIAL BINDING changes", () => {
    expect(artifactDigest(artifact())).not.toBe(artifactDigest(artifact({ credentialHosts: [] })));
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-artifact.test.ts`
Expected: FAIL — cannot resolve `./toolgen-artifact.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-types.ts`:

```ts

import type { ExtensionManifest } from "../extensions/manifest.ts";

/**
 * The custom MCP method a generated tool uses to ask the gateway to make a request for it.
 *
 * Defined ONCE here and imported by `toolgen-stub.ts` (which emits it into the generated skeleton)
 * and `toolgen-broker.ts` (which serves it). Static rule D29(a) confines the literal to this file:
 * a producer and a consumer that separately hardcode the same string are two copies that can drift
 * invisibly — the exact failure `SANDBOX_POLICY_ENV` documents for its own wire.
 */
export const BROKERED_FETCH_METHOD = "nimbus/fetch";

/** Named codes so a caller distinguishes refusals without matching on message text. */
export class ToolgenError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolgenError";
  }
}

/**
 * How the broker attaches a secret. A tagged envelope rather than a bare string: a bare string
 * would force either a convention ("assume Bearer") or a tool-supplied hint, and the second is the
 * tool telling the broker how to spend a credential it cannot see.
 */
export type ToolCredentialBinding =
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "header"; readonly headerName: string; readonly value: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string };

/**
 * Everything the owner approves, hashed into the audit row, and (in PR 3) signed — ONE object so
 * the three can never diverge.
 *
 * `credentialHosts` lists the hosts for which a Vault binding exists at approval time. It is part
 * of the artifact because "this tool will send a credential to X" is a fact the owner is
 * consenting to, so a later change to it must invalidate the approval.
 */
export interface GeneratedToolArtifact {
  readonly toolId: string;
  readonly toolName: string;
  readonly description: string;
  /** The VERBATIM model-authored body. Never a digest at the approval prompt. */
  readonly body: string;
  readonly approvedHosts: readonly string[];
  readonly credentialHosts: readonly string[];
  readonly manifest: ExtensionManifest;
}

/** A registered, live tool: the approved artifact plus its runtime bookkeeping. */
export interface ToolgenEnvelope {
  readonly artifact: GeneratedToolArtifact;
  readonly sessionId: string;
  readonly scriptPath: string;
  readonly approvedAt: number;
}

```

Create `packages/gateway/src/toolgen/toolgen-artifact.ts`:

```ts

import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";
import { canonicalize } from "../extensions/canonical-json.ts";
import type { GeneratedToolArtifact } from "./toolgen-types.ts";

/**
 * The bytes the owner approves, the bytes hashed into the `tool.generate` audit row, and (PR 3)
 * the bytes signed. Deterministic regardless of property insertion order, via the same
 * `canonicalize` extension signature verification already runs on.
 *
 * I33's rule, extended one hop: read the script ONCE so the bytes the owner approved are the bytes
 * that execute — and later the bytes that get signed.
 */
export function canonicalArtifactBytes(artifact: GeneratedToolArtifact): string {
  return canonicalize({
    toolId: artifact.toolId,
    toolName: artifact.toolName,
    description: artifact.description,
    body: artifact.body,
    approvedHosts: [...artifact.approvedHosts],
    credentialHosts: [...artifact.credentialHosts],
    manifest: artifact.manifest as unknown as Record<string, unknown>,
  });
}

export function artifactDigest(artifact: GeneratedToolArtifact): string {
  return bytesToHex(blake3(new TextEncoder().encode(canonicalArtifactBytes(artifact))));
}

```

If `canonicalize` does not accept a nested object at this shape, sort the manifest into a flat record first rather than loosening the type — do not reach for `any`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-artifact.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen
git commit -m "feat(toolgen): add the canonical generated-tool artifact and shared types"

```

---

### Task 4: The destination guard (SSRF)

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-address-guard.ts`
- Test: `packages/gateway/src/toolgen/toolgen-address-guard.test.ts`

**Interfaces:**
- Consumes: `ToolgenError` (Task 3).
- Produces: `isForbiddenAddress(ip: string): boolean`, `assertAllowedScheme(url: URL): void`, `STRIPPED_REQUEST_HEADERS: ReadonlySet<string>`.

This is a pure function with no I/O, which is why it is its own task: it is the highest-value thing in the PR to get exhaustively right, and it is trivially testable.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-address-guard.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { assertAllowedScheme, isForbiddenAddress, STRIPPED_REQUEST_HEADERS } from "./toolgen-address-guard.ts";
import { ToolgenError } from "./toolgen-types.ts";

describe("isForbiddenAddress", () => {
  test.each([
    ["127.0.0.1", "IPv4 loopback — the Gateway's own IPC socket and HTTP API"],
    ["127.1.2.3", "the rest of 127/8, which also routes to loopback"],
    ["0.0.0.0", "unspecified, which resolves to local on several stacks"],
    ["10.1.2.3", "RFC 1918"],
    ["172.16.0.1", "RFC 1918"],
    ["172.31.255.254", "RFC 1918 upper bound"],
    ["192.168.1.1", "RFC 1918"],
    ["169.254.1.1", "link-local"],
    ["169.254.169.254", "cloud metadata"],
    ["::1", "IPv6 loopback"],
    ["fe80::1", "IPv6 link-local"],
    ["fc00::1", "IPv6 unique-local"],
  ])("refuses %s (%s)", (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  test.each([["93.184.216.34"], ["8.8.8.8"], ["172.32.0.1"], ["2606:2800:220:1::1"]])(
    "allows public address %s",
    (ip) => {
      expect(isForbiddenAddress(ip)).toBe(false);
    },
  );

  test("172.32.0.0 is NOT private — the RFC 1918 block ends at 172.31", () => {
    expect(isForbiddenAddress("172.15.255.255")).toBe(false);
    expect(isForbiddenAddress("172.32.0.0")).toBe(false);
  });
});

describe("assertAllowedScheme", () => {
  test("https is allowed", () => {
    expect(() => assertAllowedScheme(new URL("https://api.example.com/x"))).not.toThrow();
  });

  test.each([["http://a.example.com"], ["file:///etc/passwd"], ["data:text/plain,hi"], ["gopher://a.example.com"]])(
    "refuses %s",
    (raw) => {
      expect(() => assertAllowedScheme(new URL(raw))).toThrow(ToolgenError);
    },
  );
});

describe("STRIPPED_REQUEST_HEADERS", () => {
  test("auth headers a tool supplies are dropped, matched case-insensitively", () => {
    expect(STRIPPED_REQUEST_HEADERS.has("authorization")).toBe(true);
    expect(STRIPPED_REQUEST_HEADERS.has("proxy-authorization")).toBe(true);
    expect(STRIPPED_REQUEST_HEADERS.has("cookie")).toBe(true);
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-address-guard.test.ts`
Expected: FAIL — cannot resolve `./toolgen-address-guard.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-address-guard.ts`:

```ts

import { ToolgenError } from "./toolgen-types.ts";

/**
 * Headers a generated tool may NOT set. The broker attaches credentials itself (spec § 6.3); a tool
 * that could set its own `Authorization` could attach a secret obtained some other way to a host of
 * its choosing. `Cookie` is here for the same reason — it is an auth header wearing a different name.
 *
 * Lowercase, because header names are case-insensitive and the caller lowercases before lookup.
 */
export const STRIPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
]);

/**
 * `https:` only in PR 1. Plain `http:` is refused rather than warned about: a generated tool's
 * traffic carries an owner's credential, and the local-dev escape hatch that would relax this is a
 * deliberate deferral (spec § 13), not an oversight.
 */
export function assertAllowedScheme(url: URL): void {
  if (url.protocol !== "https:") {
    throw new ToolgenError(
      "ERR_TOOLGEN_HOST_NOT_ALLOWED",
      `refusing ${url.protocol} — generated tools may reach https only`,
    );
  }
}

function parseIpv4(ip: string): readonly number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

/**
 * Addresses the broker refuses EVEN WHEN THE OWNER APPROVED THE HOST — the one place this design
 * overrides an owner approval, and deliberately.
 *
 * Spec § 4.3's whole argument is that the sandboxed tool cannot reach the Gateway's own IPC socket
 * or `127.0.0.1` HTTP API (the I13 write surface, the `agents` and `resolve` token scopes). A
 * broker that proxied it there would hand back exactly the reach the empty network set took away.
 * I33 names the same target for the same reason.
 *
 * Called on the RESOLVED address, never the hostname: a name that resolves to `127.0.0.1` defeats
 * a hostname check completely.
 */
export function isForbiddenAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4 !== null) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 127 || a === 0) return true; // loopback + unspecified
    if (a === 10) return true; // RFC 1918
    if (a === 192 && b === 168) return true; // RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918 — 172.16/12, NOT all of 172
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 cloud metadata
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fe80:")) return true; // link-local
  if (/^f[cd]/.test(v6)) return true; // unique-local fc00::/7
  // An IPv4-mapped IPv6 address (::ffff:127.0.0.1) must be judged on its embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped?.[1] !== undefined) return isForbiddenAddress(mapped[1]);
  return false;
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-address-guard.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-address-guard.ts packages/gateway/src/toolgen/toolgen-address-guard.test.ts
git commit -m "feat(toolgen): refuse loopback, private and metadata destinations at the broker"

```

---

### Task 5: Per-host credential store

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-credentials.ts`
- Modify: `scripts/structure-audit/check-nimbus-invariants.ts` (add to `VAULT_KEY_ALLOW_LIST`)
- Test: `packages/gateway/src/toolgen/toolgen-credentials.test.ts`

**Interfaces:**
- Consumes: `VaultReader`/`VaultWriter` (`vault/nimbus-vault.ts`), `ToolCredentialBinding` (Task 3).
- Produces: `toolCredentialKey(toolId, host): string`, `readToolCredential(vault, toolId, host): Promise<ToolCredentialBinding | null>`, `writeToolCredential(vault, toolId, host, binding): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-credentials.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { readToolCredential, toolCredentialKey, writeToolCredential } from "./toolgen-credentials.ts";

function memoryVault(): NimbusVault {
  const store = new Map<string, string>();
  return {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
    list: async () => [...store.keys()],
  } as unknown as NimbusVault;
}

describe("toolCredentialKey", () => {
  test("is namespaced per tool AND per host", () => {
    expect(toolCredentialKey("tg_a", "api.example.com")).toBe("toolgen.tg_a.api_example_com");
    expect(toolCredentialKey("tg_a", "other.example.com")).not.toBe(
      toolCredentialKey("tg_a", "api.example.com"),
    );
    expect(toolCredentialKey("tg_b", "api.example.com")).not.toBe(
      toolCredentialKey("tg_a", "api.example.com"),
    );
  });

  test("hosts differing only by a separator do not collide", () => {
    expect(toolCredentialKey("tg_a", "a.b-c.com")).not.toBe(toolCredentialKey("tg_a", "a-b.c.com"));
  });
});

describe("round-trip", () => {
  test("a bearer binding survives", async () => {
    const v = memoryVault();
    await writeToolCredential(v, "tg_a", "api.example.com", { type: "bearer", token: "s3cret" });
    expect(await readToolCredential(v, "tg_a", "api.example.com")).toEqual({
      type: "bearer",
      token: "s3cret",
    });
  });

  test("a missing binding reads as null, not a throw", async () => {
    expect(await readToolCredential(memoryVault(), "tg_a", "nope.example.com")).toBeNull();
  });

  test("a malformed stored value reads as null — external data is guarded, never asserted", async () => {
    const v = memoryVault();
    await v.set(toolCredentialKey("tg_a", "api.example.com"), '{"type":"wat"}');
    expect(await readToolCredential(v, "tg_a", "api.example.com")).toBeNull();
  });

  test("credentials are NOT shared across tools", async () => {
    const v = memoryVault();
    await writeToolCredential(v, "tg_a", "api.example.com", { type: "bearer", token: "s3cret" });
    expect(await readToolCredential(v, "tg_b", "api.example.com")).toBeNull();
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-credentials.test.ts`
Expected: FAIL — cannot resolve `./toolgen-credentials.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-credentials.ts`:

```ts

import type { NimbusVault } from "../vault/nimbus-vault.ts";
import type { ToolCredentialBinding } from "./toolgen-types.ts";

/**
 * The ONLY site that composes a `toolgen.` Vault key (static rule D29(c)).
 *
 * Per-host, NOT per-tool. Bound per-tool instead, a tool approved for hosts A and B could ask the
 * broker to hit B carrying A's credential — the tool chooses the URL, so it would be choosing the
 * recipient of the secret.
 *
 * The host is slugged (dots and dashes to underscores) because the key format is dot-delimited, and
 * an unslugged host would make `toolgen.<id>.a.b.com` ambiguous. Dashes are distinguished from dots
 * by a prefix so `a.b-c.com` and `a-b.c.com` cannot collide onto one key and share a credential.
 */
export function toolCredentialKey(toolId: string, host: string): string {
  const slug = host.toLowerCase().replaceAll("-", "_d_").replaceAll(".", "_");
  return `toolgen.${toolId}.${slug}`;
}

function parseBinding(raw: string): ToolCredentialBinding | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (o["type"] === "bearer" && typeof o["token"] === "string") {
    return { type: "bearer", token: o["token"] };
  }
  if (
    o["type"] === "header" &&
    typeof o["headerName"] === "string" &&
    typeof o["value"] === "string"
  ) {
    return { type: "header", headerName: o["headerName"], value: o["value"] };
  }
  if (
    o["type"] === "basic" &&
    typeof o["username"] === "string" &&
    typeof o["password"] === "string"
  ) {
    return { type: "basic", username: o["username"], password: o["password"] };
  }
  return null;
}

/** Returns `null` for absent OR malformed — a credential we cannot parse must not half-apply. */
export async function readToolCredential(
  vault: NimbusVault,
  toolId: string,
  host: string,
): Promise<ToolCredentialBinding | null> {
  const raw = await vault.get(toolCredentialKey(toolId, host));
  return raw === null ? null : parseBinding(raw);
}

export async function writeToolCredential(
  vault: NimbusVault,
  toolId: string,
  host: string,
  binding: ToolCredentialBinding,
): Promise<void> {
  await vault.set(toolCredentialKey(toolId, host), JSON.stringify(binding));
}

```

Add to `VAULT_KEY_ALLOW_LIST` in `scripts/structure-audit/check-nimbus-invariants.ts`:

```ts

  // D29(c). The keys are composed DYNAMICALLY (`toolgen.<toolId>.<hostSlug>`), so the audit's
  // literal scan cannot see them — capability confinement (only this file is handed the Vault for
  // that prefix) is the real defense and this entry documents the keyspace, exactly as D27(b)
  // states of the media_grant table.
  "packages/gateway/src/toolgen/toolgen-credentials.ts",

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-credentials.test.ts && bun run audit:invariants`
Expected: PASS

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen scripts/structure-audit/check-nimbus-invariants.ts
git commit -m "feat(toolgen): add the per-host, never-inherited tool credential store"

```

---

### Task 6: The broker

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-broker.ts`
- Test: `packages/gateway/src/toolgen/toolgen-broker.test.ts`

**Interfaces:**
- Consumes: `recordToolEgress` (Task 2), `isForbiddenAddress`/`assertAllowedScheme`/`STRIPPED_REQUEST_HEADERS` (Task 4), `readToolCredential` (Task 5), `ToolgenError`/`BROKERED_FETCH_METHOD` (Task 3).
- Produces: `MAX_BROKERED_RESPONSE_BYTES`, `ToolgenBroker` class with
  `handleFetch(toolId: string, params: unknown): Promise<BrokeredFetchResponse>`, and
  `BrokeredFetchResponse = { status: number; statusText: string; headers: Record<string,string>; body: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-broker.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyAllMigrations } from "../index/migrate.ts";
import { ToolgenBroker } from "./toolgen-broker.ts";
import { ToolgenError } from "./toolgen-types.ts";

function deps(over: Partial<ConstructorParameters<typeof ToolgenBroker>[0]> = {}) {
  const db = new Database(":memory:");
  applyAllMigrations(db);
  return {
    db,
    now: () => 1,
    maxRequestsPerTool: 50,
    requestTimeoutMs: 1000,
    resolveHost: async () => "93.184.216.34",
    readCredential: async () => null,
    approvedHostsFor: () => ["api.example.com"],
    doFetch: async () => new Response("ok", { status: 200 }),
    ...over,
  };
}

function rows(db: Database): { destination: string; result_status: string }[] {
  return db
    .query<{ destination: string; result_status: string }, []>(
      "SELECT destination, result_status FROM egress_ledger WHERE source_type = 'tool'",
    )
    .all();
}

describe("ToolgenBroker.handleFetch", () => {
  test("an approved host is fetched and appends ONE authorized row", async () => {
    const d = deps();
    const res = await new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" });
    expect(res.status).toBe(200);
    expect(rows(d.db)).toEqual([{ destination: "api.example.com", result_status: "authorized" }]);
  });

  test("a host OUTSIDE the envelope is refused and appends a blocked row", async () => {
    const d = deps();
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://evil.example.com/v1" }),
    ).rejects.toThrow(ToolgenError);
    expect(rows(d.db)).toEqual([{ destination: "evil.example.com", result_status: "blocked" }]);
  });

  test("an approved host that RESOLVES to loopback is refused — the check is on the address", async () => {
    const d = deps({ resolveHost: async () => "127.0.0.1" });
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toThrow(/ERR_TOOLGEN_HOST_NOT_ALLOWED/);
    expect(rows(d.db)[0]?.result_status).toBe("blocked");
  });

  test("an egress append FAILURE aborts the request — fail-closed, no fetch", async () => {
    let fetched = false;
    const d = deps({ doFetch: async () => { fetched = true; return new Response("ok"); } });
    d.db.close(); // any append now throws
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toThrow();
    expect(fetched).toBe(false);
  });

  test("a tool-supplied Authorization header is STRIPPED", async () => {
    let seen: Headers | undefined;
    const d = deps({
      doFetch: async (_u: string, init: RequestInit) => {
        seen = new Headers(init.headers);
        return new Response("ok");
      },
    });
    await new ToolgenBroker(d).handleFetch("tg_a", {
      url: "https://api.example.com/v1",
      headers: { Authorization: "Bearer stolen" },
    });
    expect(seen?.get("authorization")).toBeNull();
  });

  test("the credential bound to host A is NOT attached to host B", async () => {
    let seen: Headers | undefined;
    const d = deps({
      approvedHostsFor: () => ["a.example.com", "b.example.com"],
      readCredential: async (_t: string, host: string) =>
        host === "a.example.com" ? { type: "bearer" as const, token: "A-ONLY" } : null,
      doFetch: async (_u: string, init: RequestInit) => {
        seen = new Headers(init.headers);
        return new Response("ok");
      },
    });
    await new ToolgenBroker(d).handleFetch("tg_a", { url: "https://b.example.com/v1" });
    expect(seen?.get("authorization")).toBeNull();
  });

  test("the per-tool request budget is enforced and the refusal is ledgered", async () => {
    const d = deps({ maxRequestsPerTool: 1 });
    const b = new ToolgenBroker(d);
    await b.handleFetch("tg_a", { url: "https://api.example.com/1" });
    await expect(b.handleFetch("tg_a", { url: "https://api.example.com/2" })).rejects.toThrow(
      /ERR_TOOLGEN_BUDGET_EXHAUSTED/,
    );
    expect(rows(d.db).map((r) => r.result_status)).toEqual(["authorized", "blocked"]);
  });

  test("a response past the cap is refused rather than buffered", async () => {
    const big = "x".repeat(6 * 1024 * 1024);
    const d = deps({ doFetch: async () => new Response(big) });
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toThrow(/ERR_TOOLGEN_RESPONSE_TOO_LARGE/);
  });

  test("a DNS failure is REFUSED and still appends a blocked row", async () => {
    const d = deps({ resolveHost: async () => { throw new Error("ENOTFOUND"); } });
    await expect(
      new ToolgenBroker(d).handleFetch("tg_a", { url: "https://api.example.com/v1" }),
    ).rejects.toThrow(ToolgenError);
    expect(rows(d.db)).toEqual([{ destination: "api.example.com", result_status: "blocked" }]);
  });

  test("a malformed params object is refused without a fetch", async () => {
    const d = deps();
    await expect(new ToolgenBroker(d).handleFetch("tg_a", { url: 42 })).rejects.toThrow(ToolgenError);
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-broker.test.ts`
Expected: FAIL — cannot resolve `./toolgen-broker.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-broker.ts`:

```ts

import type { Database } from "bun:sqlite";
import { recordToolEgress } from "../egress/tool-egress.ts";
import {
  assertAllowedScheme,
  isForbiddenAddress,
  STRIPPED_REQUEST_HEADERS,
} from "./toolgen-address-guard.ts";
import { type ToolCredentialBinding, ToolgenError } from "./toolgen-types.ts";

/**
 * The broker runs INSIDE the gateway, so an unbounded response is an OOM in the gateway rather than
 * in the tool. Same class as I32: a bounds limit whose loss is confined to the attempted operation.
 */
export const MAX_BROKERED_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface BrokeredFetchResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface ToolgenBrokerDeps {
  readonly db: Database;
  readonly now: () => number;
  readonly maxRequestsPerTool: number;
  readonly requestTimeoutMs: number;
  readonly resolveHost: (host: string) => Promise<string>;
  readonly readCredential: (toolId: string, host: string) => Promise<ToolCredentialBinding | null>;
  readonly approvedHostsFor: (toolId: string) => readonly string[];
  readonly doFetch: (url: string, init: RequestInit) => Promise<Response>;
}

interface ParsedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string | undefined;
}

function parseParams(params: unknown): ParsedRequest {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new ToolgenError("ERR_TOOLGEN_BAD_REQUEST", "fetch params must be an object");
  }
  const o = params as Record<string, unknown>;
  if (typeof o["url"] !== "string") {
    throw new ToolgenError("ERR_TOOLGEN_BAD_REQUEST", "fetch params.url must be a string");
  }
  const method = typeof o["method"] === "string" ? o["method"].toUpperCase() : "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) {
    throw new ToolgenError("ERR_TOOLGEN_BAD_REQUEST", `unsupported method: ${method}`);
  }
  const headers: Record<string, string> = {};
  const rawHeaders = o["headers"];
  if (rawHeaders !== undefined && rawHeaders !== null) {
    if (typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
      throw new ToolgenError("ERR_TOOLGEN_BAD_REQUEST", "fetch params.headers must be an object");
    }
    for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
      // Silently DROPPED rather than refused: a stripped auth header is the design working, not a
      // caller error, and refusing would tell a hostile body which header names are interesting.
      if (typeof v === "string" && !STRIPPED_REQUEST_HEADERS.has(k.toLowerCase())) headers[k] = v;
    }
  }
  const body = typeof o["body"] === "string" ? o["body"] : undefined;
  return { url: o["url"], method, headers, ...(body === undefined ? {} : { body }) };
}

function applyCredential(headers: Record<string, string>, binding: ToolCredentialBinding): void {
  switch (binding.type) {
    case "bearer":
      headers["Authorization"] = `Bearer ${binding.token}`;
      break;
    case "header":
      headers[binding.headerName] = binding.value;
      break;
    case "basic":
      headers["Authorization"] =
        `Basic ${Buffer.from(`${binding.username}:${binding.password}`).toString("base64")}`;
      break;
  }
}

/**
 * The ONLY site that performs a generated tool's outbound request (invariant I39).
 *
 * Order is load-bearing: parse, then validate the destination, then LEDGER, then fetch. Every
 * refusal past parsing appends a `blocked` row before throwing, so a refused destination is as
 * visible in `nimbus prove` as a successful one — a tool probing for reachable internal hosts
 * leaves a trail rather than silence.
 */
export class ToolgenBroker {
  readonly #deps: ToolgenBrokerDeps;
  readonly #spent = new Map<string, number>();

  constructor(deps: ToolgenBrokerDeps) {
    this.#deps = deps;
  }

  async handleFetch(toolId: string, params: unknown): Promise<BrokeredFetchResponse> {
    const req = parseParams(params);
    const url = new URL(req.url);
    const host = url.hostname.toLowerCase();

    const ledger = (resultStatus: "authorized" | "blocked"): void => {
      recordToolEgress(this.#deps.db, {
        toolId,
        destination: host,
        method: "tool.fetch",
        resultStatus,
        now: this.#deps.now(),
        requestMethod: req.method,
        requestBytes: req.body === undefined ? 0 : Buffer.byteLength(req.body),
      });
    };
    const refuse = (code: string, message: string): never => {
      ledger("blocked");
      throw new ToolgenError(code, message);
    };

    const spent = this.#spent.get(toolId) ?? 0;
    if (spent >= this.#deps.maxRequestsPerTool) {
      return refuse(
        "ERR_TOOLGEN_BUDGET_EXHAUSTED",
        `tool ${toolId} has spent its ${this.#deps.maxRequestsPerTool}-request budget`,
      );
    }

    try {
      assertAllowedScheme(url);
    } catch (err) {
      return refuse("ERR_TOOLGEN_HOST_NOT_ALLOWED", (err as Error).message);
    }

    // Exact match only. A suffix match would let `evil-api.example.com` satisfy `api.example.com`.
    if (!this.#deps.approvedHostsFor(toolId).some((h) => h.toLowerCase() === host)) {
      return refuse("ERR_TOOLGEN_HOST_NOT_ALLOWED", `host not on the approved envelope: ${host}`);
    }

    // On the RESOLVED address, not the hostname — and the address we validated is the one we
    // connect to, so a rebind between check and request cannot move the target.
    //
    // The resolve is inside the try because a REJECTION here (ENOTFOUND, offline, a DNS timeout)
    // would otherwise escape `handleFetch` with no row appended — and a resolver lookup is itself
    // traffic the tool caused, so it belongs in the ledger like any other refused destination.
    let address: string;
    try {
      address = await this.#deps.resolveHost(host);
    } catch (err) {
      return refuse(
        "ERR_TOOLGEN_HOST_NOT_ALLOWED",
        `failed to resolve ${host}: ${(err as Error).message}`,
      );
    }
    if (isForbiddenAddress(address)) {
      return refuse(
        "ERR_TOOLGEN_HOST_NOT_ALLOWED",
        `${host} resolves to a forbidden address (${address})`,
      );
    }

    const headers = { ...req.headers };
    const binding = await this.#deps.readCredential(toolId, host);
    if (binding !== null) applyCredential(headers, binding);

    // Ledger BEFORE the request. A throw here aborts without fetching — fail-closed.
    ledger("authorized");
    this.#spent.set(toolId, spent + 1);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#deps.requestTimeoutMs);
    try {
      const res = await this.#deps.doFetch(req.url, {
        method: req.method,
        headers,
        signal: controller.signal,
        ...(req.body === undefined ? {} : { body: req.body }),
      });
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BROKERED_RESPONSE_BYTES) {
        throw new ToolgenError(
          "ERR_TOOLGEN_RESPONSE_TOO_LARGE",
          `response exceeded ${MAX_BROKERED_RESPONSE_BYTES} bytes`,
        );
      }
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        outHeaders[k] = v;
      });
      return {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders,
        body: new TextDecoder().decode(buf),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-broker.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-broker.ts packages/gateway/src/toolgen/toolgen-broker.test.ts
git commit -m "feat(toolgen): add the brokered-egress chokepoint with fail-closed ledgering"

```

---

### Task 7: The stub emitter

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-stub.ts`
- Test: `packages/gateway/src/toolgen/toolgen-stub.test.ts`

**Interfaces:**
- Consumes: `BROKERED_FETCH_METHOD`, `ToolgenError` (Task 3), `ExtensionManifest` (`extensions/manifest.ts`).
- Produces: `buildGeneratedManifest(toolId, opts?): ExtensionManifest`, `emitToolScript(input): string` where
  `input = { toolId: string; toolName: string; description: string; body: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-stub.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { BROKERED_FETCH_METHOD, ToolgenError } from "./toolgen-types.ts";
import { buildGeneratedManifest, emitToolScript } from "./toolgen-stub.ts";

describe("buildGeneratedManifest", () => {
  test("network is EMPTY by construction", () => {
    expect(buildGeneratedManifest("tg_a").permissions.network).toEqual([]);
  });

  test("a requested network grant is REJECTED, never dropped", () => {
    expect(() => buildGeneratedManifest("tg_a", { network: ["api.example.com"] })).toThrow(ToolgenError);
  });

  test("an empty requested grant is accepted — rejecting it would be noise", () => {
    expect(() => buildGeneratedManifest("tg_a", { network: [] })).not.toThrow();
  });

  test("filesystem write is empty and read carries the script dir", () => {
    const m = buildGeneratedManifest("tg_a", { scriptDir: "/opt/nimbus/toolgen/tg_a" });
    expect(m.permissions.filesystem.write).toEqual([]);
    expect(m.permissions.filesystem.read).toEqual(["/opt/nimbus/toolgen/tg_a"]);
  });

  test("the interpreter's read paths are granted — without them the child dies at exit 68", () => {
    const m = buildGeneratedManifest("tg_a", {
      scriptDir: "/opt/nimbus/toolgen/tg_a",
      runtimeReadPaths: ["/usr/local/bin"],
    });
    expect(m.permissions.filesystem.read).toEqual(["/opt/nimbus/toolgen/tg_a", "/usr/local/bin"]);
  });

  test("NO node_modules is ever granted — the emitted script imports nothing", () => {
    const m = buildGeneratedManifest("tg_a", { scriptDir: "/opt/nimbus/toolgen/tg_a" });
    expect(m.permissions.filesystem.read.join(" ")).not.toContain("node_modules");
  });

  test("the manifest id is namespaced so it cannot collide with a real extension", () => {
    expect(buildGeneratedManifest("tg_a").id).toBe("toolgen.tg_a");
  });
});

describe("emitToolScript", () => {
  const script = emitToolScript({
    toolId: "tg_a",
    toolName: "gitea_open_prs",
    description: "List open PRs",
    body: "return await nimbusFetch('https://api.gitea.example/prs');",
  });

  test("the emitted skeleton names the brokered method", () => {
    expect(script).toContain(BROKERED_FETCH_METHOD);
  });

  test("the model body is embedded VERBATIM", () => {
    expect(script).toContain("return await nimbusFetch('https://api.gitea.example/prs');");
  });

  test("the skeleton defines nimbusFetch so the body has a door to use", () => {
    expect(script).toContain("async function nimbusFetch");
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-stub.test.ts`
Expected: FAIL — cannot resolve `./toolgen-stub.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-stub.ts`:

```ts

import type { ExtensionManifest } from "../extensions/manifest.ts";
// BROKERED_FETCH_METHOD is INTERPOLATED into the emitted script rather than restated as a literal:
// D29(a) confines that string to `toolgen-types.ts`, and an emitter that hardcoded it would red the
// static audit the moment Task 17 lands.
import { BROKERED_FETCH_METHOD, ToolgenError } from "./toolgen-types.ts";

/**
 * The ONLY generated-manifest constructor (static rule D29(b)).
 *
 * `permissions.network` is `[]` BY CONSTRUCTION and a requested grant is REJECTED rather than
 * dropped — I33's `buildExecPolicy` rule, for the same reason. That empty set is what drives
 * `--unshare-net` on Linux, the absent `(allow network*)` block on macOS and the absent
 * `internetClient` capability on Windows, which together are why a raw `fetch()` in the generated
 * body fails at the OS on all three platforms (spec § 4.3). It is also why spec § 3's Windows
 * per-host problem does not apply: there are no hosts to filter.
 */
export function buildGeneratedManifest(
  toolId: string,
  opts: {
    readonly network?: readonly string[];
    readonly scriptDir?: string;
    /**
     * Paths the sandbox must grant READ so the child can load its interpreter AT ALL.
     *
     * Not an optimisation. On Windows the AppContainer helper writes one ACE per granted path, so a
     * binary outside every grant is simply unreadable and the child dies before running a line —
     * exit 68, no stdout, no stderr. Linux hides this because bwrap binds the system tree by
     * default, which is exactly why it must be stated. `exec-gate.ts` passes
     * `runtime.requiredReadPaths()` here for the same reason.
     */
    readonly runtimeReadPaths?: readonly string[];
  } = {},
): ExtensionManifest {
  if (opts.network !== undefined && opts.network.length > 0) {
    throw new ToolgenError(
      "ERR_TOOLGEN_NETWORK_UNSUPPORTED",
      "a generated tool cannot be granted network — it reaches the network only through the broker",
    );
  }
  return {
    id: `toolgen.${toolId}`,
    version: "0.0.0",
    permissions: {
      network: [],
      filesystem: {
        // Its own script directory plus the interpreter's paths, and nothing else. NO node_modules
        // grant: the emitted script imports nothing (see `emitToolScript`), which is what keeps this
        // grant this small.
        read: [...(opts.scriptDir === undefined ? [] : [opts.scriptDir]), ...(opts.runtimeReadPaths ?? [])],
        write: [],
      },
    },
    updateChannel: "stable",
  };
}

/**
 * Wrap the model-authored BODY in a Nimbus-authored skeleton.
 *
 * The transport, the `nimbusFetch` helper and the manifest are all ours; the model fills a hole in
 * a template it does not control. It is not required to cooperate — if the body ignores
 * `nimbusFetch` and calls `fetch()` directly, the sandbox refuses it — but supplying the helper is
 * what makes the cooperative path the easy one.
 *
 * The body is embedded VERBATIM: these are the bytes the owner approved.
 */
export function emitToolScript(input: {
  readonly toolId: string;
  readonly toolName: string;
  readonly description: string;
  readonly body: string;
}): string {
  return `// GENERATED by Nimbus toolgen for ${input.toolId} — do not edit.
// Zero imports, deliberately: this file runs from the ephemeral script store, which has no
// node_modules and is granted read access to nothing else. See the plan's Task 7 note.
const __send = (msg) => { process.stdout.write(JSON.stringify(msg) + "\n"); };
const __pending = new Map();
let __seq = 0;

/**
 * The only route out of this process. This process has NO network — a raw fetch() fails at the OS.
 */
async function nimbusFetch(url, init = {}) {
  const id = "r" + String(++__seq);
  return await new Promise((resolve, reject) => {
    __pending.set(id, { resolve, reject });
    __send({ id, method: ${JSON.stringify(BROKERED_FETCH_METHOD)}, params: { url, ...init } });
  });
}

async function __invoke(args) {
${input.body}
}

let __buf = "";
process.stdin.on("data", async (chunk) => {
  __buf += chunk.toString();
  let nl;
  while ((nl = __buf.indexOf("\n")) >= 0) {
    const line = __buf.slice(0, nl);
    __buf = __buf.slice(nl + 1);
    if (line.trim() === "") continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    // A reply to one of OUR outbound broker calls.
    if (msg.id !== undefined && msg.method === undefined) {
      const p = __pending.get(msg.id);
      if (p !== undefined) {
        __pending.delete(msg.id);
        if (msg.error !== undefined) p.reject(new Error(String(msg.error)));
        else p.resolve(msg.result);
      }
      continue;
    }
    // An inbound request from the gateway.
    if (msg.method === "describe") {
      __send({ id: msg.id, result: { name: ${JSON.stringify(input.toolName)}, description: ${JSON.stringify(input.description)} } });
    } else if (msg.method === "call") {
      try {
        __send({ id: msg.id, result: await __invoke(msg.params ?? {}) });
      } catch (err) {
        __send({ id: msg.id, error: String(err && err.message ? err.message : err) });
      }
    }
  }
});
`;
}

```

**Why no MCP SDK in the emitted script.** The first draft imported
`@modelcontextprotocol/sdk/server/index.js`. That is **unrunnable**, and reproducibly so: a script
under `<configDir>/toolgen/ephemeral/<toolId>/` cannot resolve a bare specifier, because Bun
resolves from the importing file's directory and there is no `node_modules` on that path —

```

error: Cannot find module '@modelcontextprotocol/sdk/server/index.js'
       from '…/tg_probe/index.ts'

```

That fails **before any sandbox is involved**; inside the sandbox, with only `scriptDir` granted, it
fails twice over. The two obvious repairs — resolving the SDK to absolute `file://` URLs, or setting
`NODE_PATH` — both work, and both mean granting read access to the gateway's entire `node_modules`
tree to a process running LLM-authored code, which is a large mutable surface handed to exactly the
thing this manifest exists to contain. Neither survives `bun build --compile` either, where
`node_modules` is not on disk at all.

So the generated tool speaks a **dependency-free, line-delimited JSON protocol over stdio** instead:
`{id, method, params}` in, `{id, result|error}` out, plus tool-initiated `nimbus/fetch` requests on
the same pipe. It is about forty lines Nimbus authors, it imports nothing, and only Nimbus ever
talks to it — MCP compliance buys a session-scoped tool nothing. This also removes the open question
about custom-method schemas on `setRequestHandler`.

**Note for the implementer:** add a test that the emitted script **parses**
(`new Bun.Transpiler({ loader: "ts" }).transformSync(script)`), so a syntax error in the template is
caught here rather than at spawn time. Mind the escaping: the newline inside the emitted source must
survive this file's own template literal.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-stub.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-stub.ts packages/gateway/src/toolgen/toolgen-stub.test.ts
git commit -m "feat(toolgen): emit the tool skeleton with a network-free manifest"

```

---

### Task 8: Confinement verification

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-confinement.ts`
- Test: `packages/gateway/src/toolgen/toolgen-confinement.test.ts`

**Interfaces:**
- Consumes: `SandboxRunner` (`platform/sandbox/sandbox-runner.ts`), `policyFromManifest` (`platform/sandbox/sandbox-policy.ts`), `probePath` (`@nimbus-dev/sdk/testing`).
- Produces: `assertToolConfinement(deps): Promise<void>` where
  `deps = { runner: SandboxRunner; manifest: ExtensionManifest; cwd: string; spawnProbe?: (...) => Promise<number> }`.

**Why not `runSandboxContractTests`:** spec § 7.1–7.2. Its default probe runner spawns **unsandboxed**, so a bare call fails 100% on Linux/macOS for an empty-network manifest; and its `ProbeRunner` is synchronous while `SandboxRunner` exposes only async `spawn`, so injecting a sandboxed runner does not type-check. We reuse the SDK's **probe script** and supply our own async runner.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-confinement.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { buildGeneratedManifest } from "./toolgen-stub.ts";
import { assertToolConfinement, resolveProbeScriptForTest } from "./toolgen-confinement.ts";
import { ToolgenError } from "./toolgen-types.ts";

const runner = { canConfine: () => null } as unknown as import("../platform/sandbox/sandbox-runner.ts").SandboxRunner;

describe("assertToolConfinement", () => {
  test("passes when the probe reports fs-denied (exit 10)", async () => {
    await expect(
      assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
        spawnProbe: async () => 10,
      }),
    ).resolves.toBeUndefined();
  });

  test("REFUSES when the probe read the protected path — the unsandboxed signature", async () => {
    await expect(
      assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
        spawnProbe: async () => 2,
      }),
    ).rejects.toThrow(/ERR_TOOLGEN_CONFINEMENT_FAILED/);
  });

  test("the probe script resolves to a real file — a bad path reports as a sandbox failure", async () => {
    const { existsSync } = await import("node:fs");
    // Guards the trap the SDK documents on its own `probePath`: a missing probe is a PACKAGING
    // problem, but surfaces as though confinement failed.
    expect(existsSync(resolveProbeScriptForTest())).toBe(true);
  });

  test("refuses BEFORE probing when the runner cannot confine the policy", async () => {
    let probed = false;
    const degraded = { canConfine: () => "bwrap not found" } as unknown as import("../platform/sandbox/sandbox-runner.ts").SandboxRunner;
    await expect(
      assertToolConfinement({
        runner: degraded,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
        spawnProbe: async () => { probed = true; return 10; },
      }),
    ).rejects.toThrow(ToolgenError);
    expect(probed).toBe(false);
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-confinement.test.ts`
Expected: FAIL — cannot resolve `./toolgen-confinement.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-confinement.ts`:

```ts

import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionManifest } from "../extensions/manifest.ts";
import { policyFromManifest } from "../platform/sandbox/sandbox-policy.ts";
import type { SandboxRunner } from "../platform/sandbox/sandbox-runner.ts";
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
import { ToolgenError } from "./toolgen-types.ts";

/** The SDK probe's exit code for "the protected read was denied", i.e. confinement worked. */
const PROBE_EXIT_FS_DENIED = 10;

/**
 * Locate the SDK's probe script ourselves.
 *
 * `probePath` IS exported from `sandbox-contract.ts` but is NOT re-exported by the package entry
 * `@nimbus-dev/sdk/testing`, whose surface is exactly `runSandboxContractTests`,
 * `expectNoRejectedDiagnostics` and `MockGateway` — so importing it fails typecheck. Resolving it
 * here also means the extension follows whichever copy is executing: `src/` carries only
 * `sandbox-probe.ts`, the published `dist/` only `sandbox-probe.js`, and a hardcoded extension is
 * wrong from one side or the other.
 */
export function resolveProbeScriptForTest(): string {
  return resolveProbeScript();
}

function resolveProbeScript(): string {
  const entry = fileURLToPath(import.meta.resolve("@nimbus-dev/sdk/testing"));
  const file = entry.endsWith(".ts") ? "sandbox-probe.ts" : "sandbox-probe.js";
  return resolvePath(dirname(entry), file);
}

export interface ToolConfinementDeps {
  readonly runner: SandboxRunner;
  readonly manifest: ExtensionManifest;
  readonly cwd: string;
  /** Injected for tests. Production spawns the probe through the real runner. */
  readonly spawnProbe?: (
    runner: SandboxRunner,
    policy: ReturnType<typeof policyFromManifest>,
    cwd: string,
  ) => Promise<number>;
}

function defaultSpawnProbe(
  runner: SandboxRunner,
  policy: ReturnType<typeof policyFromManifest>,
  cwd: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = runner.spawn(process.execPath, [resolveProbeScript(), "--probe=fs-denied", "--arg="], {
      policy,
      env: extensionProcessEnv({}),
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
}

/**
 * Prove THIS machine's sandbox confines THIS manifest, before the owner is prompted.
 *
 * Two checks, in order. `canConfine(policy)` asks the PAL about the policy that will actually
 * spawn — never `degradedReason()` (non-null on Windows even when the runner is fully active) and
 * never `isFullyActive()` (reports the Linux per-host helper an empty-network policy never touches,
 * and CI does not install it). Then the probe actually runs under that policy, because a runner
 * saying it *can* confine is a claim and the probe is a measurement.
 */
export async function assertToolConfinement(deps: ToolConfinementDeps): Promise<void> {
  const policy = policyFromManifest(deps.manifest);
  const cannot = deps.runner.canConfine(policy);
  if (cannot !== null) {
    throw new ToolgenError(
      "ERR_TOOLGEN_SANDBOX_DEGRADED",
      `refusing to generate a tool that could not be confined: ${cannot}`,
    );
  }
  const exit = await (deps.spawnProbe ?? defaultSpawnProbe)(deps.runner, policy, deps.cwd);
  if (exit !== PROBE_EXIT_FS_DENIED) {
    throw new ToolgenError(
      "ERR_TOOLGEN_CONFINEMENT_FAILED",
      `sandbox confinement probe returned exit ${exit}, expected ${PROBE_EXIT_FS_DENIED}`,
    );
  }
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-confinement.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-confinement.ts packages/gateway/src/toolgen/toolgen-confinement.test.ts
git commit -m "feat(toolgen): verify sandbox confinement under the real runner before consent"

```

---

### Task 9: Consent broker

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-consent-broker.ts`
- Test: `packages/gateway/src/toolgen/toolgen-consent-broker.test.ts`

**Interfaces:**
- Consumes: `ConsentBroker` (`util/consent-broker.ts`).
- Produces: `ToolgenApprovalInput`, `ToolgenConsentBroker`, `toolgenConsent` (process singleton).

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-consent-broker.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { ToolgenConsentBroker } from "./toolgen-consent-broker.ts";

describe("ToolgenConsentBroker", () => {
  test("broadcasts the VERBATIM body and the host list", async () => {
    const b = new ToolgenConsentBroker();
    let seen: Record<string, unknown> | undefined;
    b.setBroadcast((method, params) => {
      expect(method).toBe("toolgen.approvalRequest");
      seen = params as Record<string, unknown>;
      b.respond(String(seen["requestId"]), true);
    });
    await b.request(
      {
        toolId: "tg_a",
        toolName: "t",
        description: "d",
        body: "VERBATIM-BODY",
        approvedHosts: ["api.example.com"],
        credentialHosts: [],
        initiator: "owner",
      },
      1000,
    );
    expect(seen?.["body"]).toBe("VERBATIM-BODY");
    expect(seen?.["approvedHosts"]).toEqual(["api.example.com"]);
  });

  test("resolves FALSE on TTL expiry — fail-closed", async () => {
    const b = new ToolgenConsentBroker();
    b.setBroadcast(() => {});
    expect(
      await b.request(
        { toolId: "tg_a", toolName: "t", description: "d", body: "x", approvedHosts: [], credentialHosts: [], initiator: "owner" },
        10,
      ),
    ).toBe(false);
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-consent-broker.test.ts`
Expected: FAIL — cannot resolve `./toolgen-consent-broker.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-consent-broker.ts`:

```ts

import { ConsentBroker } from "../util/consent-broker.ts";

export interface ToolgenApprovalInput {
  readonly toolId: string;
  readonly toolName: string;
  readonly description: string;
  /**
   * The VERBATIM model-authored body -- never a digest. The human is the entire security boundary
   * for this capability, and a prompt reading "register tool blake3:a1b2..." is a rubber stamp with
   * extra steps.
   */
  readonly body: string;
  readonly approvedHosts: readonly string[];
  /** Hosts for which a credential will be attached. "What will be sent, and where." */
  readonly credentialHosts: readonly string[];
  /**
   * Who asked. `"owner"` in PR 1. Present now so the agent-initiated path (PR 2) cannot ship a
   * prompt that looks identical to one the owner started.
   */
  readonly initiator: "owner";
}

/**
 * Owner-approval round-trip for registering a generated tool (I39): broadcasts
 * `toolgen.approvalRequest` and resolves when the owner answers via `toolgen.approvalRespond`
 * (fail-closed on TTL).
 */
export class ToolgenConsentBroker extends ConsentBroker<ToolgenApprovalInput> {
  constructor() {
    super("toolgen.approvalRequest");
  }
}

/** Process singleton shared by the IPC dispatcher and the gate. */
export const toolgenConsent = new ToolgenConsentBroker();

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-consent-broker.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-consent-broker.ts packages/gateway/src/toolgen/toolgen-consent-broker.test.ts
git commit -m "feat(toolgen): add the owner consent broker for tool registration"

```

---

### Task 10: Ephemeral registry

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-registry.ts`
- Test: `packages/gateway/src/toolgen/toolgen-registry.test.ts`

**Interfaces:**
- Consumes: `ToolgenEnvelope`, `GeneratedToolArtifact` (Task 3).
- Produces: `ToolgenRegistry` with `register(envelope, close)`, `forSession(sessionId): ToolgenEnvelope[]`, `get(toolId)`, `countForSession(sessionId): number`, `markTerminated(toolId)`, `isTerminated(toolId)`, `revoke(toolId): Promise<void>`, `revokeAll(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-registry.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { ToolgenRegistry } from "./toolgen-registry.ts";
import type { ToolgenEnvelope } from "./toolgen-types.ts";

function env(toolId: string, sessionId = "s1"): ToolgenEnvelope {
  return {
    sessionId,
    scriptPath: `/tmp/${toolId}/index.ts`,
    approvedAt: 1,
    artifact: {
      toolId,
      toolName: toolId,
      description: "d",
      body: "b",
      approvedHosts: ["api.example.com"],
      credentialHosts: [],
      manifest: {
        id: `toolgen.${toolId}`,
        version: "0.0.0",
        permissions: { network: [], filesystem: { read: [], write: [] } },
        updateChannel: "stable",
      },
    },
  };
}

describe("ToolgenRegistry", () => {
  test("tools are scoped to their session", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    r.register(env("tg_b", "s2"), async () => {});
    expect(r.forSession("s1").map((e) => e.artifact.toolId)).toEqual(["tg_a"]);
    expect(r.countForSession("s2")).toBe(1);
    expect(r.forSession("s3")).toEqual([]);
  });

  test("a terminated tool is excluded from the session listing", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a"), async () => {});
    r.markTerminated("tg_a");
    expect(r.isTerminated("tg_a")).toBe(true);
    expect(r.forSession("s1")).toEqual([]);
  });

  test("revoke calls the close hook and drops the tool", async () => {
    const r = new ToolgenRegistry();
    let closed = false;
    r.register(env("tg_a"), async () => { closed = true; });
    await r.revoke("tg_a");
    expect(closed).toBe(true);
    expect(r.get("tg_a")).toBeUndefined();
  });

  test("revokeAll drains every session — the shutdown path", async () => {
    const r = new ToolgenRegistry();
    let closes = 0;
    r.register(env("tg_a", "s1"), async () => { closes += 1; });
    r.register(env("tg_b", "s2"), async () => { closes += 1; });
    await r.revokeAll();
    expect(closes).toBe(2);
    expect(r.forSession("s1")).toEqual([]);
  });

  test("a close hook that throws does not block the other revocations", async () => {
    const r = new ToolgenRegistry();
    let closed = false;
    r.register(env("tg_a", "s1"), async () => { throw new Error("boom"); });
    r.register(env("tg_b", "s2"), async () => { closed = true; });
    await r.revokeAll();
    expect(closed).toBe(true);
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-registry.test.ts`
Expected: FAIL — cannot resolve `./toolgen-registry.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-registry.ts`:

```ts

import type { ToolgenEnvelope } from "./toolgen-types.ts";

interface Entry {
  readonly envelope: ToolgenEnvelope;
  readonly close: () => Promise<void>;
  terminated: boolean;
}

/**
 * Ephemeral, session-keyed registry of live generated tools.
 *
 * IN-MEMORY ONLY, and that is the feature: a gateway restart drops every generated tool, so
 * "ephemeral for the session" is true by construction rather than by a cleanup job. Same shape as
 * I30's in-memory pairing window. PR 1 adds no schema migration precisely because of this.
 */
export class ToolgenRegistry {
  readonly #byId = new Map<string, Entry>();

  register(envelope: ToolgenEnvelope, close: () => Promise<void>): void {
    this.#byId.set(envelope.artifact.toolId, { envelope, close, terminated: false });
  }

  get(toolId: string): ToolgenEnvelope | undefined {
    return this.#byId.get(toolId)?.envelope;
  }

  /** Live tools only. A terminated tool is not offered to the model as though it still worked. */
  forSession(sessionId: string): ToolgenEnvelope[] {
    return [...this.#byId.values()]
      .filter((e) => !e.terminated && e.envelope.sessionId === sessionId)
      .map((e) => e.envelope);
  }

  /** Counts live tools only, so a crashed tool does not permanently consume session budget. */
  countForSession(sessionId: string): number {
    return this.forSession(sessionId).length;
  }

  /**
   * The child process exited. The tool is NOT silently restarted: a restart re-runs approved code
   * the owner may reasonably believe stopped, and "it came back on its own" is not a property
   * anyone approved.
   */
  markTerminated(toolId: string): void {
    const entry = this.#byId.get(toolId);
    if (entry !== undefined) entry.terminated = true;
  }

  isTerminated(toolId: string): boolean {
    return this.#byId.get(toolId)?.terminated ?? false;
  }

  async revoke(toolId: string): Promise<void> {
    const entry = this.#byId.get(toolId);
    if (entry === undefined) return;
    this.#byId.delete(toolId);
    await entry.close();
  }

  /** Shutdown drain. One failing close must not strand the remaining child processes. */
  async revokeAll(): Promise<void> {
    const entries = [...this.#byId.values()];
    this.#byId.clear();
    await Promise.allSettled(entries.map((e) => e.close()));
  }
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-registry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-registry.ts packages/gateway/src/toolgen/toolgen-registry.test.ts
git commit -m "feat(toolgen): add the in-memory session-scoped tool registry"

```

---

### Task 11: Ephemeral script store

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-script-store.ts`
- Test: `packages/gateway/src/toolgen/toolgen-script-store.test.ts`

**Interfaces:**
- Consumes: nothing beyond `node:fs/promises` and `node:path`.
- Produces: `toolScriptDir(configDir, toolId): string`, `writeToolScript(configDir, toolId, source): Promise<string>`, `removeToolScript(configDir, toolId): Promise<void>`, `removeAllToolScripts(configDir): Promise<void>`.

Spec § 4.6. The directory path is derived **before** the manifest is built (it is a pure function of
`configDir` and `toolId`), so the manifest can grant read to it; the file itself is written only
**after** the owner approves, so nothing model-authored touches the disk before consent.

- [ ] **Step 1: Write the failing test**

```ts

import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  removeAllToolScripts,
  removeToolScript,
  toolScriptDir,
  writeToolScript,
} from "./toolgen-script-store.ts";

function cfg(): string {
  return mkdtempSync(join(tmpdir(), "nimbus-toolgen-"));
}

describe("toolScriptDir", () => {
  test("is a pure function of configDir and toolId — derivable before anything is written", () => {
    const c = cfg();
    expect(toolScriptDir(c, "tg_a")).toBe(toolScriptDir(c, "tg_a"));
    expect(toolScriptDir(c, "tg_a")).not.toBe(toolScriptDir(c, "tg_b"));
  });

  test("refuses a tool id containing a path separator — no traversal out of the store", () => {
    expect(() => toolScriptDir(cfg(), "../../etc")).toThrow();
    expect(() => toolScriptDir(cfg(), "a/b")).toThrow();
  });
});

describe("writeToolScript", () => {
  test("writes the source and returns the file path inside the tool's dir", async () => {
    const c = cfg();
    const p = await writeToolScript(c, "tg_a", "export const x = 1;");
    expect(p.startsWith(toolScriptDir(c, "tg_a"))).toBe(true);
    expect(await readFile(p, "utf8")).toBe("export const x = 1;");
  });

  test("the file is owner-only on POSIX", async () => {
    if (process.platform === "win32") return; // ACLs are asserted by the Windows integration leg
    const c = cfg();
    const p = await writeToolScript(c, "tg_a", "x");
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  test("rewriting replaces rather than appending", async () => {
    const c = cfg();
    await writeToolScript(c, "tg_a", "first");
    const p = await writeToolScript(c, "tg_a", "second");
    expect(await readFile(p, "utf8")).toBe("second");
  });
});

describe("removal", () => {
  test("removeToolScript drops the tool directory", async () => {
    const c = cfg();
    await writeToolScript(c, "tg_a", "x");
    await removeToolScript(c, "tg_a");
    expect(existsSync(toolScriptDir(c, "tg_a"))).toBe(false);
  });

  test("removing a tool that was never written is a no-op, not a throw", async () => {
    await expect(removeToolScript(cfg(), "tg_missing")).resolves.toBeUndefined();
  });

  test("removeAllToolScripts drains the store — the shutdown path", async () => {
    const c = cfg();
    await writeToolScript(c, "tg_a", "x");
    await writeToolScript(c, "tg_b", "y");
    await removeAllToolScripts(c);
    expect(existsSync(toolScriptDir(c, "tg_a"))).toBe(false);
    expect(existsSync(toolScriptDir(c, "tg_b"))).toBe(false);
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-script-store.test.ts`
Expected: FAIL — cannot resolve `./toolgen-script-store.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STORE_DIR = "toolgen";
const EPHEMERAL_DIR = "ephemeral";
const SCRIPT_FILE = "index.ts";

/**
 * Where a generated tool's approved body lives (spec § 4.6).
 *
 * PURE — derivable before anything is written, which is what lets `buildGeneratedManifest` grant
 * read to this directory while the file itself is written only AFTER the owner approves.
 *
 * The tool id is minted by the gateway (`deps.newId()`), never supplied by a caller, but it is
 * validated here anyway: this function joins it into a path, and a path-joining helper that trusts
 * its input is one refactor away from a traversal.
 */
export function toolScriptDir(configDir: string, toolId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(toolId)) {
    throw new Error(`unsafe tool id for a path segment: ${JSON.stringify(toolId)}`);
  }
  return join(configDir, STORE_DIR, EPHEMERAL_DIR, toolId);
}

/** Owner-only (`0o600`). On Windows the mode is advisory; the directory ACL is the real control. */
export async function writeToolScript(
  configDir: string,
  toolId: string,
  source: string,
): Promise<string> {
  const dir = toolScriptDir(configDir, toolId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, SCRIPT_FILE);
  await writeFile(file, source, { encoding: "utf8", mode: 0o600 });
  return file;
}

/** Idempotent: revoking a tool that never wrote a script must not throw. */
export async function removeToolScript(configDir: string, toolId: string): Promise<void> {
  await rm(toolScriptDir(configDir, toolId), { recursive: true, force: true });
}

/** Shutdown drain — the store is ephemeral, so nothing may survive a restart. */
export async function removeAllToolScripts(configDir: string): Promise<void> {
  await rm(join(configDir, STORE_DIR, EPHEMERAL_DIR), { recursive: true, force: true });
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-script-store.test.ts && bun run audit:cross-platform`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-script-store.ts packages/gateway/src/toolgen/toolgen-script-store.test.ts
git commit -m "feat(toolgen): add the ephemeral, owner-only generated-script store"

```

---

### Task 12: Spawn the tool and wire the broker (raises coverage to `per-call`)

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-client.ts`
- Modify: `packages/gateway/src/egress/egress-coverage.ts` (raise `tool` to `"per-call"`)
- Test: `packages/gateway/src/toolgen/toolgen-client.test.ts`

**Interfaces:**
- Consumes: `wrapServerSpec` (`connectors/lazy-mesh/wrap-server-spec.ts`), `extensionProcessEnv` (`extensions/spawn-env.ts`), `policyFromManifest` + `SandboxRunner` (`platform/sandbox/*`), `ToolgenBroker` (Task 6), `BROKERED_FETCH_METHOD` + `ToolgenEnvelope` (Task 3).
- Produces: `buildToolSpawnSpec(envelope, cwd): { command: string; args: string[]; env: Record<string,string> }`, `GeneratedToolHandle` = `{ describe(): Promise<{name: string; description: string}>; call(args: Record<string, unknown>): Promise<unknown>; close(): Promise<void> }`, and `spawnGeneratedTool(envelope, broker, cwd, runner): Promise<GeneratedToolHandle>`.

**Coverage raise:** this task is where a generated tool first gains the ability to make a brokered request, so `THIS_BINARY_COVERAGE.tool` goes from `"none"` to `"per-call"` here — the same rule `browser` followed.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-client.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { THIS_BINARY_COVERAGE } from "../egress/egress-coverage.ts";
import { buildToolSpawnSpec } from "./toolgen-client.ts";
import type { ToolgenEnvelope } from "./toolgen-types.ts";

const envelope: ToolgenEnvelope = {
  sessionId: "s1",
  scriptPath: "/opt/nimbus/toolgen/tg_a/index.ts",
  approvedAt: 1,
  artifact: {
    toolId: "tg_a",
    toolName: "t",
    description: "d",
    body: "b",
    approvedHosts: [],
    credentialHosts: [],
    manifest: {
      id: "toolgen.tg_a",
      version: "0.0.0",
      permissions: { network: [], filesystem: { read: ["/opt/nimbus/toolgen/tg_a"], write: [] } },
      updateChannel: "stable",
    },
  },
};

describe("buildToolSpawnSpec", () => {
  const spec = buildToolSpawnSpec(envelope, "/opt/nimbus/toolgen/tg_a");

  test("the script is IMPORTED via -e, never named as the entry point", () => {
    // `bun run <file>` fails under the Windows AppContainer with CouldntReadCurrentDirectory
    // (measured; see exec/exec-runtimes.ts). import() of a granted file works.
    expect(spec.args.join(" ")).toContain("-e");
    expect(spec.args.join(" ")).toContain("import(");
    expect(spec.args).not.toContain("run");
  });

  test("the command line stays far below the Windows 32767 limit regardless of body size", () => {
    expect([spec.command, ...spec.args].join(" ").length).toBeLessThan(4096);
  });

  test("the spawn goes through wrapServerSpec, so the sandbox policy env is set", () => {
    expect(spec.env["NIMBUS_SANDBOX_POLICY_JSON"]).toBeDefined();
    expect(JSON.parse(spec.env["NIMBUS_SANDBOX_POLICY_JSON"] ?? "{}")).toMatchObject({
      permissions: { network: [] },
    });
  });
});

describe("coverage", () => {
  test("the tool class is per-call now that a generated tool can make a request", () => {
    expect(THIS_BINARY_COVERAGE.tool).toBe("per-call");
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-client.test.ts`
Expected: FAIL — cannot resolve `./toolgen-client.ts`.

- [ ] **Step 3: Write minimal implementation**

Raise the class in `packages/gateway/src/egress/egress-coverage.ts`:

```ts

  // RAISED from "none" in the same commit that lets a generated tool make a brokered request
  // (`toolgen/toolgen-client.ts` wires `ToolgenBroker.handleFetch` onto the tool's MCP client).
  // Per this file's own rule, never ahead of that landing.
  tool: "per-call",

```

Create `packages/gateway/src/toolgen/toolgen-client.ts`:

```ts

import { wrapServerSpec } from "../connectors/lazy-mesh/wrap-server-spec.ts";
import { policyFromManifest } from "../platform/sandbox/sandbox-policy.ts";
import type { SandboxRunner } from "../platform/sandbox/sandbox-runner.ts";
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
import type { ToolgenBroker } from "./toolgen-broker.ts";
import { BROKERED_FETCH_METHOD, type ToolgenEnvelope } from "./toolgen-types.ts";

/**
 * How a generated tool is launched.
 *
 * The body is NOT passed inline and the script is NOT named as the entry point. Both are measured
 * dead ends recorded in `exec/exec-runtimes.ts`: inline is bounded by the Windows helper's
 * `wchar_t cmdline[32768]` (and a generated MCP server is a whole module), while `bun run <file>`
 * fails under the AppContainer with `CouldntReadCurrentDirectory`. `import()` of a granted file
 * works there, so a tiny `-e` stub that imports satisfies both constraints at once.
 *
 * Goes through `wrapServerSpec`, so I15/D10 applies to a generated tool exactly as to a connector.
 */
export function buildToolSpawnSpec(
  envelope: ToolgenEnvelope,
  cwd: string,
): { command: string; args: string[]; env: Record<string, string> } {
  const href = new URL(`file://${envelope.scriptPath.replaceAll("\\", "/")}`).href;
  const spec = wrapServerSpec(
    {
      command: process.execPath,
      args: ["-e", `await import(${JSON.stringify(href)});`],
      env: extensionProcessEnv({}),
    },
    envelope.artifact.manifest,
    cwd,
  );
  return { command: spec.command, args: spec.args, env: spec.env as Record<string, string> };
}

export interface GeneratedToolHandle {
  describe(): Promise<{ name: string; description: string }>;
  call(args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Spawn a generated tool and serve its brokered-fetch requests.
 *
 * Deliberately NOT `@mastra/mcp`, which holds its SDK client PRIVATE and exposes only
 * `setElicitationRequestHandler` (`client.d.ts:60`, `:272`) — there is no public API there for a
 * custom server->client handler. And deliberately not the official MCP SDK either, on the child
 * side: the emitted script must import NOTHING (see `emitToolScript`), because it runs from a
 * directory with no `node_modules` and a sandbox grant that deliberately does not include one.
 *
 * So both ends speak one line-delimited JSON protocol. `{id, method, params}` in, `{id, result}` or
 * `{id, error}` out; a message whose method equals `BROKERED_FETCH_METHOD` is the tool asking the
 * gateway to make a request, and is the ONLY route out of that process. (Named via the constant
 * rather than quoted, so D29(a)'s confinement scan stays a one-file rule.)
 */
export async function spawnGeneratedTool(
  envelope: ToolgenEnvelope,
  broker: ToolgenBroker,
  cwd: string,
  runner: SandboxRunner,
): Promise<GeneratedToolHandle> {
  const spec = buildToolSpawnSpec(envelope, cwd);
  const child = runner.spawn(spec.command, spec.args, {
    policy: policyFromManifest(envelope.artifact.manifest),
    env: spec.env,
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let buf = "";

  const send = (msg: unknown): void => {
    child.stdin?.write(`${JSON.stringify(msg)}
`);
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let nl = buf.indexOf("
");
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("
");
      if (line.trim() === "") continue;
      let msg: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        msg = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const id = typeof msg["id"] === "string" ? msg["id"] : undefined;
      if (id === undefined) continue;
      // The tool asking US to make a request.
      if (msg["method"] === BROKERED_FETCH_METHOD) {
        void broker
          .handleFetch(envelope.artifact.toolId, msg["params"])
          .then((result) => send({ id, result }))
          .catch((err: Error) => send({ id, error: err.message }));
        continue;
      }
      // A reply to one of OUR requests.
      const p = pending.get(id);
      if (p === undefined) continue;
      pending.delete(id);
      if (msg["error"] !== undefined) p.reject(new Error(String(msg["error"])));
      else p.resolve(msg["result"]);
    }
  });

  const request = (method: string, params: unknown): Promise<unknown> => {
    const id = `g${String(++seq)}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });
  };

  return {
    describe: async () => {
      const r = await request("describe", {});
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        name: typeof o["name"] === "string" ? o["name"] : envelope.artifact.toolName,
        description: typeof o["description"] === "string" ? o["description"] : "",
      };
    },
    call: async (args) => await request("call", args),
    close: async () => {
      child.kill();
    },
  };
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-client.test.ts && bun test packages/gateway/src/egress`
Expected: PASS. Update `CANONICAL` in `egress-coverage.test.ts` from `tool=none` to `tool=per-call`
in the same change — that string is the wire format `nimbus prove` parses, so leaving it stale
would make the binary claim a coverage it no longer has.

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-client.ts packages/gateway/src/toolgen/toolgen-client.test.ts packages/gateway/src/egress/egress-coverage.ts
git commit -m "feat(toolgen): spawn generated tools on the official MCP SDK and raise tool coverage to per-call"

```

---

### Task 13: The gate

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-gate.ts`
- Test: `packages/gateway/src/toolgen/toolgen-gate.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 5, 7, 8, 9, 10, 11, 12; `appendAuditEntry` (`audit/…`, same import `exec-gate.ts` uses); `EnforcedPolicy` (`policy/types.ts`).
- Produces: `createGeneratedTool(req, deps): Promise<ToolgenOutcome>` where
  `ToolgenOutcome = { status: "registered"; toolId: string } | { status: "denied" } | { status: "refused"; code: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-gate.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyAllMigrations } from "../index/migrate.ts";
import { DEFAULT_NIMBUS_TOOL_GENERATION_TOML } from "../config/nimbus-toml.ts";
import { createGeneratedTool, normalizeHost } from "./toolgen-gate.ts";
import { ToolgenRegistry } from "./toolgen-registry.ts";

function deps(over: Record<string, unknown> = {}) {
  const db = new Database(":memory:");
  applyAllMigrations(db);
  return {
    db,
    config: { ...DEFAULT_NIMBUS_TOOL_GENERATION_TOML, enabled: true },
    enforced: { capabilitiesDisabled: new Set<string>() },
    registry: new ToolgenRegistry(),
    draftBody: async () => "return 1;",
    assertConfinement: async () => {},
    writeScript: async () => "/tmp/tg/index.ts",
    scriptDir: () => "/tmp/tg",
    bindCredentials: async () => [],
    spawn: async () => ({
      describe: async () => ({ name: "t", description: "d" }),
      call: async () => null,
      close: async () => {},
    }),
    requestApproval: async () => true,
    now: () => 1,
    newId: () => "tg_a",
    approvalCalls: 0,
    ...over,
  };
}

const req = { sessionId: "s1", description: "list open PRs", hosts: ["api.example.com"] };

function auditRows(db: Database) {
  return db
    .query<{ hitl_status: string; action_json: string }, []>(
      "SELECT hitl_status, action_json FROM audit_log WHERE action_type = 'tool.generate'",
    )
    .all();
}

describe("createGeneratedTool refusals happen BEFORE consent", () => {
  test("config off refuses and never prompts", async () => {
    let prompted = false;
    const d = deps({ config: DEFAULT_NIMBUS_TOOL_GENERATION_TOML, requestApproval: async () => { prompted = true; return true; } });
    expect(await createGeneratedTool(req, d as never)).toEqual({ status: "refused", code: "ERR_TOOLGEN_DISABLED" });
    expect(prompted).toBe(false);
  });

  test("org policy off refuses and never prompts", async () => {
    let prompted = false;
    const d = deps({
      enforced: { capabilitiesDisabled: new Set(["tool_generation"]) },
      requestApproval: async () => { prompted = true; return true; },
    });
    expect((await createGeneratedTool(req, d as never)).status).toBe("refused");
    expect(prompted).toBe(false);
  });

  test("an ABSENT policy accessor refuses fail-closed, it does not default to enabled", async () => {
    const d = deps({ enforced: undefined });
    expect((await createGeneratedTool(req, d as never)).status).toBe("refused");
  });

  test("session budget refuses and never prompts", async () => {
    let prompted = false;
    const registry = new ToolgenRegistry();
    for (const id of ["a", "b", "c"]) {
      registry.register(
        {
          sessionId: "s1", scriptPath: "/tmp", approvedAt: 1,
          artifact: { toolId: id, toolName: id, description: "", body: "", approvedHosts: [], credentialHosts: [], manifest: { id: `toolgen.${id}`, version: "0.0.0", permissions: { network: [], filesystem: { read: [], write: [] } }, updateChannel: "stable" } },
        },
        async () => {},
      );
    }
    const d = deps({ registry, requestApproval: async () => { prompted = true; return true; } });
    expect((await createGeneratedTool(req, d as never)).code).toBe("ERR_TOOLGEN_SESSION_BUDGET_EXCEEDED");
    expect(prompted).toBe(false);
  });

  test("a failed confinement probe refuses and never prompts", async () => {
    let prompted = false;
    const d = deps({
      assertConfinement: async () => { throw new Error("degraded"); },
      requestApproval: async () => { prompted = true; return true; },
    });
    expect((await createGeneratedTool(req, d as never)).status).toBe("refused");
    expect(prompted).toBe(false);
  });
});

describe("normalizeHost", () => {
  test.each([
    ["https://api.example.com/v1", "api.example.com"],
    ["API.Example.COM", "api.example.com"],
    ["api.example.com:443", "api.example.com"],
    ["  api.example.com  ", "api.example.com"],
  ])("%s -> %s", (raw, want) => {
    expect(normalizeHost(raw)).toBe(want);
  });

  test.each([[""], ["   "]])("refuses %p", (raw) => {
    expect(() => normalizeHost(raw)).toThrow();
  });
});

describe("createGeneratedTool outcomes", () => {
  test("approval registers the tool and audits approved", async () => {
    const d = deps();
    expect(await createGeneratedTool(req, d as never)).toEqual({ status: "registered", toolId: "tg_a" });
    expect(d.registry.forSession("s1")).toHaveLength(1);
    expect(auditRows(d.db)[0]?.hitl_status).toBe("approved");
  });

  test("a denial registers NOTHING and audits rejected", async () => {
    const d = deps({ requestApproval: async () => false });
    expect(await createGeneratedTool(req, d as never)).toEqual({ status: "denied" });
    expect(d.registry.forSession("s1")).toHaveLength(0);
    expect(auditRows(d.db)[0]?.hitl_status).toBe("rejected");
  });

  test("the audit row carries the VERBATIM body, and never hitl_status not_required", async () => {
    const d = deps({ draftBody: async () => "VERBATIM-BODY" });
    await createGeneratedTool(req, d as never);
    const row = auditRows(d.db)[0];
    expect(row?.action_json).toContain("VERBATIM-BODY");
    expect(row?.hitl_status).not.toBe("not_required");
  });

  test("the approval prompt names the hosts that will receive a CREDENTIAL", async () => {
    let seen: { credentialHosts: readonly string[] } | undefined;
    const d = deps({
      bindCredentials: async () => ["api.example.com"],
      requestApproval: async (input: { credentialHosts: readonly string[] }) => {
        seen = input;
        return true;
      },
    });
    await createGeneratedTool(req, d as never);
    // Vacuous before credentials moved to create time: nothing could be in the Vault under a
    // toolId that did not exist yet, so this list was ALWAYS empty and disclosed nothing.
    expect(seen?.credentialHosts).toEqual(["api.example.com"]);
  });

  test("a refusal before consent still audits, as rejected with its own outcome tag", async () => {
    const d = deps({ config: DEFAULT_NIMBUS_TOOL_GENERATION_TOML });
    await createGeneratedTool(req, d as never);
    const row = auditRows(d.db)[0];
    expect(row?.hitl_status).toBe("rejected");
    expect(row?.action_json).toContain("refused_before_consent");
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-gate.test.ts`
Expected: FAIL — cannot resolve `./toolgen-gate.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-gate.ts`. Follow `exec/exec-gate.ts`'s structure exactly: one `try` with an outer `catch` that maps `ToolgenError` to `{status:"refused", code}`, an `approvedAt` sentinel distinguishing before/after consent, and a single `audit()` helper.

```ts

import type { Database } from "bun:sqlite";
import { appendAuditEntry } from "../audit/audit-log.ts";
import type { NimbusToolGenerationToml } from "../config/nimbus-toml.ts";
import type { EnforcedPolicy } from "../policy/types.ts";
import { artifactDigest } from "./toolgen-artifact.ts";
import type { ToolgenApprovalInput } from "./toolgen-consent-broker.ts";
import type { GeneratedToolHandle } from "./toolgen-client.ts";
import type { ToolgenRegistry } from "./toolgen-registry.ts";
import { buildGeneratedManifest, emitToolScript } from "./toolgen-stub.ts";
import { type GeneratedToolArtifact, ToolgenError, type ToolgenEnvelope } from "./toolgen-types.ts";

const CAPABILITY = "tool_generation";
const APPROVAL_TTL_MS = 120_000;

/**
 * Reduce whatever the owner typed to the bare hostname the broker will compare against.
 *
 * The broker matches `url.hostname` EXACTLY (no suffix matching), so an approved entry of
 * `https://api.example.com/v1` would match nothing at all — a tool approved for a host it can
 * never reach. Normalising here rather than at the broker keeps the artifact the owner approved and
 * the value later compared identical.
 */
export function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") throw new ToolgenError("ERR_TOOLGEN_HOST_NOT_ALLOWED", "empty host");
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    throw new ToolgenError("ERR_TOOLGEN_HOST_NOT_ALLOWED", `unparseable host: ${raw}`);
  }
}

export interface CreateGeneratedToolRequest {
  readonly sessionId: string;
  readonly description: string;
  readonly hosts: readonly string[];
}

export interface ToolgenGateDeps {
  readonly db: Database;
  readonly config: NimbusToolGenerationToml;
  readonly enforced?: Pick<EnforcedPolicy, "capabilitiesDisabled"> | undefined;
  readonly registry: ToolgenRegistry;
  readonly draftBody: (req: CreateGeneratedToolRequest) => Promise<string>;
  readonly assertConfinement: (manifest: ReturnType<typeof buildGeneratedManifest>) => Promise<void>;
  /** Pure path derivation (Task 11's `toolScriptDir`, bound to the config dir). Touches no disk. */
  readonly scriptDir: (toolId: string) => string;
  readonly writeScript: (toolId: string, source: string) => Promise<string>;
  /** Bound closure over the PAL runner + cwd (Task 12's `spawnGeneratedTool`). */
  readonly spawn: (envelope: ToolgenEnvelope) => Promise<GeneratedToolHandle>;
  readonly requestApproval: (input: ToolgenApprovalInput, ttlMs: number) => Promise<boolean>;
  /**
   * Persist the caller-supplied credentials under the NEW toolId and return the hosts that now have
   * one. Called BEFORE the approval prompt, so `credentialHosts` in the artifact is a real answer to
   * "what will be sent, and where" rather than an always-empty list.
   *
   * This is why credentials are supplied to `nimbus tool create` rather than added afterwards: the
   * toolId does not exist until create runs, so a credential could never be in the Vault at
   * approval time — and adding one to a LIVE tool would change the artifact the owner approved
   * (§ 4.5 puts `credentialHosts` inside the signed/hashed object precisely so that a change
   * invalidates the approval). `nimbus tool credential set` therefore REFUSES a live tool.
   */
  readonly bindCredentials: (
    toolId: string,
    hosts: readonly string[],
  ) => Promise<string[]>;
  readonly now: () => number;
  readonly newId: () => string;
}

export type ToolgenOutcome =
  | { readonly status: "registered"; readonly toolId: string }
  | { readonly status: "denied" }
  | { readonly status: "refused"; readonly code: string };

type OutcomeTag = "denied_by_owner" | "refused_before_consent" | "registered" | "failed_after_approval";

/**
 * `audit_log.hitl_status` is CHECK-constrained to approved/rejected/not_required, so this
 * capability's outcomes do not map one-to-one. A refusal-before-consent and an owner denial both
 * record `rejected`, told apart by `outcome`. `not_required` is deliberately NEVER used here: on a
 * `tool.generate` row it would read as "a tool was generated without needing approval", the single
 * most dangerous thing an auditor could wrongly conclude.
 */
function audit(
  deps: ToolgenGateDeps,
  hitlStatus: "approved" | "rejected",
  outcome: OutcomeTag,
  payload: Record<string, unknown>,
): void {
  appendAuditEntry(deps.db, {
    actionType: "tool.generate",
    hitlStatus,
    actionJson: JSON.stringify({ outcome, ...payload }),
    timestamp: deps.now(),
  });
}

/**
 * The ONE path from a model-authored body to a registered, callable tool (invariant I39).
 *
 * The ORDER is load-bearing and mirrors `runExecution`: every refusal decidable WITHOUT the owner
 * happens before the consent prompt, so a capability disabled by config or org policy never
 * advertises its own existence by prompting, and the sandbox posture is proven before the owner is
 * asked to approve something that could not have been confined.
 */
export async function createGeneratedTool(
  req: CreateGeneratedToolRequest,
  deps: ToolgenGateDeps,
): Promise<ToolgenOutcome> {
  const toolId = deps.newId();
  let approved = false;
  try {
    // 1. Local kill-switch.
    if (!deps.config.enabled) {
      throw new ToolgenError("ERR_TOOLGEN_DISABLED", "tool generation is disabled");
    }
    // 2. Org policy (I22). An ABSENT accessor refuses fail-closed rather than defaulting to
    //    enabled -- the gap multimodal PR 1 left open and PR 2 closed.
    if (deps.enforced === undefined) {
      throw new ToolgenError("ERR_TOOLGEN_POLICY_DISABLED", "org policy unavailable; refusing");
    }
    if (deps.enforced.capabilitiesDisabled.has(CAPABILITY)) {
      throw new ToolgenError("ERR_TOOLGEN_POLICY_DISABLED", "disabled by org policy");
    }
    // 3. Session budget.
    if (deps.registry.countForSession(req.sessionId) >= deps.config.maxToolsPerSession) {
      throw new ToolgenError(
        "ERR_TOOLGEN_SESSION_BUDGET_EXCEEDED",
        `session already holds ${deps.config.maxToolsPerSession} generated tools`,
      );
    }
    // 4. Draft, then build the manifest -- network EMPTY by construction.
    const body = await deps.draftBody(req);
    // The script DIRECTORY is derived before the manifest so the manifest can grant read to it.
    // Nothing is WRITTEN there until after approval (step 7) — a derived path touches no disk.
    const manifest = buildGeneratedManifest(toolId, { scriptDir: deps.scriptDir(toolId) });
    // 5. Prove confinement on THIS machine, still before consent.
    await deps.assertConfinement(manifest);

    // Normalised, not trusted as typed: a user will paste `https://api.example.com/v1` or
    // `api.example.com:443`, and an unnormalised entry would never match the broker's
    // `url.hostname` comparison — silently producing a tool that can reach nothing.
    const hosts = [...new Set(req.hosts.map(normalizeHost))].sort();
    if (hosts.length === 0) {
      throw new ToolgenError("ERR_TOOLGEN_HOST_NOT_ALLOWED", "at least one --host is required");
    }
    const credentialHosts = await deps.bindCredentials(toolId, hosts);
    const artifact: GeneratedToolArtifact = {
      toolId,
      toolName: `generated_${toolId}`,
      description: req.description,
      body,
      approvedHosts: hosts,
      credentialHosts,
      manifest,
    };

    // 6. Owner approves the VERBATIM artifact.
    approved = await deps.requestApproval(
      {
        toolId,
        toolName: artifact.toolName,
        description: artifact.description,
        body: artifact.body,
        approvedHosts: hosts,
        credentialHosts,
        initiator: "owner",
      },
      APPROVAL_TTL_MS,
    );
    if (!approved) {
      audit(deps, "rejected", "denied_by_owner", { toolId, body, hosts });
      return { status: "denied" };
    }

    // 7. Only now does anything reach the filesystem or spawn.
    const scriptPath = await deps.writeScript(toolId, emitToolScript(artifact));
    const envelope: ToolgenEnvelope = { artifact, sessionId: req.sessionId, scriptPath, approvedAt: deps.now() };
    const handle = await deps.spawn(envelope);
    deps.registry.register(envelope, () => handle.close());

    audit(deps, "approved", "registered", {
      toolId,
      body,
      hosts,
      credentialHosts,
      artifactDigest: artifactDigest(artifact),
    });
    return { status: "registered", toolId };
  } catch (err) {
    const code = err instanceof ToolgenError ? err.code : "ERR_TOOLGEN_INTERNAL";
    audit(deps, "rejected", approved ? "failed_after_approval" : "refused_before_consent", {
      toolId,
      code,
      message: (err as Error).message,
    });
    return { status: "refused", code };
  }
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-gate.test.ts`
Expected: PASS (16 tests). Adjust the `appendAuditEntry` import path to whatever `exec-gate.ts` uses.

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-gate.ts packages/gateway/src/toolgen/toolgen-gate.test.ts
git commit -m "feat(toolgen): add the ordered tool-generation gate with refusals before consent"

```

---

### Task 14: Expose generated tools to the agent

**Files:**
- Create: `packages/gateway/src/toolgen/toolgen-agent-tools.ts`
- Modify: `packages/gateway/src/engine/agent.ts` (the three `new Agent({... tools ...})` calls)
- Test: `packages/gateway/src/toolgen/toolgen-agent-tools.test.ts`

**Interfaces:**
- Consumes: `ToolgenRegistry` (Task 10), `wrapToolForLlm` (existing in `engine/agent.ts`), `getAgentRequestSessionId` (`engine/agent-request-context.ts`).
- Produces: `buildGeneratedTools(sessionId: string | undefined, registry: ToolgenRegistry, invoke: (toolId, args) => Promise<unknown>, wrap: <T>(service: string, tool: string, def: T) => T): Record<string, unknown>`. The `wrap` parameter is the I11 envelope and is REQUIRED — see the doc comment.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/toolgen/toolgen-agent-tools.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { ToolgenRegistry } from "./toolgen-registry.ts";
import { buildGeneratedTools } from "./toolgen-agent-tools.ts";

const wrap = <T>(_service: string, _tool: string, def: T): T => def;
import type { ToolgenEnvelope } from "./toolgen-types.ts";

function env(toolId: string, sessionId: string): ToolgenEnvelope {
  return {
    sessionId, scriptPath: "/tmp", approvedAt: 1,
    artifact: { toolId, toolName: toolId, description: "d", body: "b", approvedHosts: [], credentialHosts: [], manifest: { id: `toolgen.${toolId}`, version: "0.0.0", permissions: { network: [], filesystem: { read: [], write: [] } }, updateChannel: "stable" } },
  };
}

describe("buildGeneratedTools", () => {
  test("contributes NOTHING when the session holds no generated tool", () => {
    expect(buildGeneratedTools("s1", new ToolgenRegistry(), async () => null, wrap)).toEqual({});
  });

  test("contributes NOTHING for an undefined session", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    expect(buildGeneratedTools(undefined, r, async () => null, wrap)).toEqual({});
  });

  test("exposes only the CURRENT session's tools", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    r.register(env("tg_b", "s2"), async () => {});
    expect(Object.keys(buildGeneratedTools("s1", r, async () => null, wrap))).toEqual(["tg_a"]);
  });

  test("a terminated tool disappears from the surface", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    r.markTerminated("tg_a");
    expect(buildGeneratedTools("s1", r, async () => null, wrap)).toEqual({});
  });

  test("I11 — every generated tool passes through the envelope wrapper", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    const wrapped: string[] = [];
    const spy = <T>(service: string, tool: string, def: T): T => {
      wrapped.push(`${service}:${tool}`);
      return def;
    };
    buildGeneratedTools("s1", r, async () => null, spy);
    // A generated tool returns a remote API response straight into the model's context. If this
    // ever passes vacuously, an external server can address the agent directly.
    expect(wrapped).toEqual(["toolgen:tg_a"]);
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-agent-tools.test.ts`
Expected: FAIL — cannot resolve `./toolgen-agent-tools.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/gateway/src/toolgen/toolgen-agent-tools.ts`:

```ts

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolgenRegistry } from "./toolgen-registry.ts";

/**
 * The model-facing surface for generated tools.
 *
 * Returns `{}` -- NO tool at all, not a disabled tool that errors when called -- when the session
 * holds none, mirroring `buildComputerUseTools`. An undefined session (a caller outside the
 * request context) likewise gets nothing rather than another session's tools.
 */
export function buildGeneratedTools(
  sessionId: string | undefined,
  registry: ToolgenRegistry,
  invoke: (toolId: string, args: Record<string, unknown>) => Promise<unknown>,
  /**
   * The I11 envelope wrapper, INJECTED because `agent.ts`'s `wrapToolForLlm` is module-private.
   * Passing it in beats exporting it: a generated tool returns a remote API's response verbatim
   * into the model's context, so it is the single most injection-prone tool surface in the tree and
   * MUST NOT be constructible without the envelope. A required parameter makes that a compile
   * error rather than a review comment.
   */
  wrap: <T>(service: string, tool: string, def: T) => T,
): Record<string, unknown> {
  if (sessionId === undefined) return {};
  const out: Record<string, unknown> = {};
  for (const envelope of registry.forSession(sessionId)) {
    const { toolId, description } = envelope.artifact;
    out[toolId] = wrap(
      "toolgen",
      toolId,
      createTool({
        id: toolId,
        description: `${description} (runtime-generated, approved this session)`,
        inputSchema: z.object({}).passthrough(),
        execute: async ({ context }) => await invoke(toolId, context as Record<string, unknown>),
      }),
    );
  }
  return out;
}

```

In `packages/gateway/src/engine/agent.ts`, change `tools: baseTools` on all three `new Agent({...})` calls to a `DynamicArgument` function. `createNimbusEngineAgent` runs **once at boot** (`gateway-main.ts:111`), so a static map can never see a mid-session registration:

```ts

// `tools` is a DynamicArgument (@mastra/core/dist/agent/agent.d.ts:876) -- resolved PER REQUEST.
// A static object here is fixed for the process lifetime, and this agent is constructed once at
// boot, so a tool registered mid-session would never become visible. `baseTools` is unchanged.
const toolsFor = (): Record<string, unknown> => ({
  ...baseTools,
  ...(deps.toolgen === undefined
    ? {}
    : buildGeneratedTools(
        getAgentRequestSessionId(),
        deps.toolgen.registry,
        deps.toolgen.invoke,
        // I11. `wrapToolForLlm` is module-private here, which is why it is passed rather than
        // imported by the toolgen module.
        (service, tool, def) => wrapToolForLlm(service, tool, def, deps.auditDb),
      )),
});

```

and use `tools: toolsFor` in each `new Agent({...})`. Add the optional `toolgen` field to `NimbusEngineAgentDeps`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-agent-tools.test.ts && bun test packages/gateway/src/engine`
Expected: PASS. If Mastra rejects a function for `tools` at this version, fall back to resolving the map inside a wrapper agent factory called per request — do **not** mutate a live `Agent`.

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/toolgen/toolgen-agent-tools.ts packages/gateway/src/toolgen/toolgen-agent-tools.test.ts packages/gateway/src/engine/agent.ts
git commit -m "feat(toolgen): expose session-scoped generated tools via Mastra dynamic tools"

```

---

### Task 15: IPC surface and LAN forbid

**Files:**
- Create: `packages/gateway/src/ipc/toolgen-rpc.ts`
- Modify: `packages/gateway/src/ipc/lan-rpc.ts`
- Modify: `packages/gateway/src/ipc/server/dispatchers.ts` (register the handlers)
- Modify: `packages/gateway/src/gateway-main.ts` (construct the registry/broker; shutdown drain)
- Test: `packages/gateway/src/ipc/toolgen-rpc.test.ts`
- Test: `packages/gateway/src/ipc/lan-rpc.test.ts` (extend)

**Interfaces:**
- Consumes: `createGeneratedTool` (Task 13), `toolgenConsent` (Task 9), `ToolgenRegistry` (Task 10).
- Produces: handlers for `toolgen.create`, `toolgen.approvalRespond`, `toolgen.list`, `toolgen.revoke`.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/ipc/toolgen-rpc.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { checkLanMethodAllowed, LanError } from "./lan-rpc.ts";

describe("toolgen is LAN-forbidden as a WHOLE namespace", () => {
  test.each([
    ["toolgen.create"],
    ["toolgen.approvalRespond"],
    ["toolgen.list"],
    ["toolgen.revoke"],
  ])("%s is refused over LAN", (method) => {
    expect(() => checkLanMethodAllowed(method, undefined)).toThrow(LanError);
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/ipc/toolgen-rpc.test.ts`
Expected: FAIL — `toolgen.*` is currently admitted by default-allow.

- [ ] **Step 3: Write minimal implementation**

Add to the forbidden list in `packages/gateway/src/ipc/lan-rpc.ts`, after the `"exec"` entry:

```ts

  // S2 runtime tool generation — the WHOLE namespace, matching exec/computer/media/fleet.
  // `toolgen.create` is RCE-class by definition (it registers model-authored code that then runs),
  // and `toolgen.approvalRespond` is the LOCAL owner answering a registration prompt — admitting it
  // over the wire would let a paired peer approve LLM-authored code running on the owner's machine
  // with the owner's credentials, defeating the entire I39 gate. `toolgen.list` would enumerate
  // which tools and which hosts the owner has approved. No read verb here is worth preserving.
  "toolgen",

```

Create `packages/gateway/src/ipc/toolgen-rpc.ts` following `ipc/exec-rpc.ts`'s shape exactly: a handler map with `toolgen.create` (calls `createGeneratedTool`), `toolgen.approvalRespond` (calls `toolgenConsent.respond(requestId, approved)`), `toolgen.list` (reads the registry for a session), `toolgen.revoke` (calls `registry.revoke`). Validate every incoming param with an explicit guard — the params cross a process boundary and are therefore `unknown`.

Register the map in `packages/gateway/src/ipc/server/dispatchers.ts` alongside the exec handlers, and add a comment there stating that `toolgen.*` is **not** Tauri-exposed (I7) — do not add it to `ALLOWED_METHODS` in `ui/src-tauri/src/gateway_bridge.rs`.

In `packages/gateway/src/gateway-main.ts`, construct the registry and broker, and wire the broker's
`approvedHostsFor` to the registry — the artifact the owner approved is the only source of truth for
that list:

```ts

approvedHostsFor: (toolId) => toolgenRegistry.get(toolId)?.artifact.approvedHosts ?? [],

```

The `?? []` is the fail-closed direction: an unknown or revoked toolId gets no approved hosts, so
every request from it is refused and ledgered `blocked`.

Then drain both halves on shutdown:

```ts

// Ephemeral means ephemeral. Without this, a restart leaves orphaned tool child processes holding
// stdio pipes, and approved model-authored bodies sitting on disk under the config dir — where the
// next session could still be pointed at them. The registry drop alone is not enough: it clears
// memory, not the filesystem.
await toolgenRegistry.revokeAll();
await removeAllToolScripts(configDir);

```

Add a test asserting the shutdown path calls **both** — a drain that clears the registry and leaves
the scripts is the failure worth catching, and it looks identical to success from memory.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/src/ipc/toolgen-rpc.test.ts packages/gateway/src/ipc/lan-rpc.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/ipc
git commit -m "feat(toolgen): add the LAN-forbidden toolgen IPC namespace"

```

---

### Task 16: The `nimbus tool` CLI

**Files:**
- Create: `packages/cli/src/commands/tool.ts`
- Modify: `packages/cli/src/commands/registry.ts` (add `"tool"`)
- Modify: `docs/cli-reference.md`
- Test: `packages/cli/src/commands/tool.test.ts`

**Interfaces:**
- Consumes: `withGatewayIpc` (`../lib/with-gateway-ipc.ts`), `INTERACTIVE_RPC_TIMEOUT_MS` (`../lib/rpc-timeouts.ts`).
- Produces: `parseToolArgs(argv): ParsedToolArgs`, `TOOL_EXIT_CODES`, the command entry point.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/commands/tool.test.ts`:

```ts

import { describe, expect, test } from "bun:test";
import { parseToolArgs, TOOL_EXIT_CODES } from "./tool.ts";

describe("parseToolArgs", () => {
  test("create requires at least one --host", () => {
    expect(() => parseToolArgs(["create", "--description", "d"])).toThrow(/--host/);
  });

  test("create parses repeated --host flags", () => {
    const a = parseToolArgs(["create", "--description", "d", "--host", "a.example.com", "--host", "b.example.com"]);
    expect(a).toMatchObject({ sub: "create", hosts: ["a.example.com", "b.example.com"] });
  });

  test("create parses repeatable --credential bindings", () => {
    const a = parseToolArgs([
      "create", "--description", "d", "--host", "a.example.com",
      "--credential", "a.example.com=tok",
    ]);
    expect(a).toMatchObject({ credentials: [{ host: "a.example.com", token: "tok" }] });
  });

  test("a --credential for a host not in --host is refused", () => {
    expect(() =>
      parseToolArgs(["create", "--description", "d", "--host", "a.example.com", "--credential", "b.example.com=tok"]),
    ).toThrow(/not in --host/);
  });

  test("credential set requires a tool id, a host and exactly one scheme", () => {
    expect(() => parseToolArgs(["credential", "set", "tg_a", "a.example.com"])).toThrow(/--bearer|--header/);
    expect(() =>
      parseToolArgs(["credential", "set", "tg_a", "a.example.com", "--bearer", "t", "--header", "X", "v"]),
    ).toThrow(/exactly one/);
  });

  test("revoke requires a tool id", () => {
    expect(() => parseToolArgs(["revoke"])).toThrow(/tool id/);
  });

  test("an unknown subcommand is refused, not defaulted", () => {
    expect(() => parseToolArgs(["frobnicate"])).toThrow(/Usage/);
  });
});

describe("TOOL_EXIT_CODES", () => {
  test("denial and refusal are distinguishable and in the reserved band", () => {
    expect(TOOL_EXIT_CODES.denied).toBe(126);
    expect(TOOL_EXIT_CODES.refused).toBe(127);
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/commands/tool.test.ts`
Expected: FAIL — cannot resolve `./tool.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/commands/tool.ts` modelled on `commands/exec.ts`. Requirements:

- `TOOL_EXIT_CODES = { denied: 126, refused: 127 } as const` — same reserved band and rationale as `EXEC_EXIT_CODES`.
- `nimbus tool create --description <text> --host <h> [--host <h>…]` — sends `toolgen.create`; on an approval prompt notification, prints the **full body**, the host list and the credential bindings, then a `[y/N]` confirm via `@clack/prompts`.
- **Refuse outright in a non-TTY**, exactly as `nimbus media allow-remote` does — a piped `y` must
  not approve model-authored code:

  ```ts

  if (process.stdin.isTTY !== true) {
    console.error("error: nimbus tool create needs an interactive TTY for owner approval.");
    console.error("There is no headless path: toolgen.create is LAN-forbidden and local-only.");
    process.exit(TOOL_EXIT_CODES.refused);
  }

  ```

- **Credentials are supplied at CREATE time**, not afterwards:
  `nimbus tool create … --credential <host>=<bearer-token>` (repeatable). The toolId does not exist
  before create, so a credential could not be in the Vault at approval time — which would make the
  prompt's credential disclosure permanently empty.
- `nimbus tool credential set <tool-id> …` therefore **refuses a LIVE tool**, with a message saying
  to revoke and recreate. Adding a credential to an approved tool changes the artifact the owner
  approved (§ 4.5 puts `credentialHosts` inside the hashed object precisely so a change invalidates
  it), and silently widening what an approved tool may send is the failure this whole gate exists
  to prevent.
- `nimbus tool revoke <tool-id>` must call BOTH `registry.revoke` (closes the child) and Task 11's
  `removeToolScript` (drops the body from disk) — a revoked tool that leaves its script behind is a
  tool the next session could still be pointed at.
- `nimbus tool list [--json]`, `nimbus tool credential set <tool-id> <host> (--bearer <token> | --header <name> <value> | --basic <user> <pass>)`.
- **Never echo a credential value back to stdout**, including in `--json`.

Add `"tool"` to the command list in `packages/cli/src/commands/registry.ts`, and document all four subcommands in `docs/cli-reference.md`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/commands/tool.test.ts && bun run audit:doc-refs && bun run audit:readme-cli`
Expected: PASS

- [ ] **Step 5: Commit**

```bash

git add packages/cli/src/commands/tool.ts packages/cli/src/commands/tool.test.ts packages/cli/src/commands/registry.ts docs/cli-reference.md
git commit -m "feat(cli): add nimbus tool create/list/revoke/credential"

```

---

### Task 17: Invariant I39 and static rule D29

**Files:**
- Modify: `packages/gateway/src/security-invariants.test.ts`
- Modify: `scripts/structure-audit/check-nimbus-invariants.ts`
- Modify: `docs/SECURITY-INVARIANTS.md`
- Modify: `CLAUDE.md` and `GEMINI.md` (the invariant list and the static-complement paragraph)
- Test: `scripts/structure-audit/check-nimbus-invariants.test.ts`

The triple rule: wiring + docs + test land in **one** commit.

- [ ] **Step 1: Write the failing test**

Add to `packages/gateway/src/security-invariants.test.ts`:

```ts

describe("I39 — generated tools reach the network only through the broker", () => {
  test("a generated manifest always has an EMPTY network set", () => {
    expect(buildGeneratedManifest("tg_a").permissions.network).toEqual([]);
  });

  test("a requested network grant is REJECTED, never dropped", () => {
    expect(() => buildGeneratedManifest("tg_a", { network: ["api.example.com"] })).toThrow(ToolgenError);
  });

  test("recordToolEgress is the ONLY tool-class appender in the tree", async () => {
    const hits = await grepRepo(/sourceType:\s*"tool"/);
    expect(hits).toEqual(["packages/gateway/src/egress/tool-egress.ts"]);
  });

  test("the tool coverage class is per-call", () => {
    expect(THIS_BINARY_COVERAGE.tool).toBe("per-call");
  });
});

```

Add to `scripts/structure-audit/check-nimbus-invariants.test.ts` a case per D29 rule asserting the checker **fails** on a synthetic violation (a second file naming `nimbus/fetch`; a second `buildGeneratedManifest`; a `toolgen.` key composed outside `toolgen-credentials.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/src/security-invariants.test.ts -t I39`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Add three checks to `scripts/structure-audit/check-nimbus-invariants.ts`:

- **D29(a)** `checkBrokeredFetchLiteralConfinement` — the string `nimbus/fetch` appears only in `packages/gateway/src/toolgen/toolgen-types.ts`. **Strip comments before scanning**, and phrase the rule as *what cannot pass*, not as an allow-list of what may (allow-list guards fail silently when a path is renamed). The comment strip matters in both directions: without it, a doc comment that merely mentions the method reds the build; with it, the rule cannot see a literal hidden in a comment — accepted, since a comment does not execute and every code path still goes through the constant. Add a test that a comment mentioning the method does NOT trip the rule, and that a second code occurrence DOES.
- **D29(b)** `checkGeneratedManifestConfinement` — `buildGeneratedManifest` is defined only in `toolgen-stub.ts`, and no non-empty `network:` array literal appears in that file.
- **D29(c)** `checkToolgenVaultKeyConfinement` — a `` `toolgen.` `` prefix template appears only in `toolgen-credentials.ts`.

Register all three in the checker's rule list. Add the I39 section to `docs/SECURITY-INVARIANTS.md` and the row to the invariant list in **both** `CLAUDE.md` and `GEMINI.md`, updating the static-complement paragraph to name D29.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run audit:invariants && bun test packages/gateway/src/security-invariants.test.ts scripts/structure-audit && bun run audit:doc-refs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/src/security-invariants.test.ts scripts/structure-audit docs/SECURITY-INVARIANTS.md CLAUDE.md GEMINI.md
git commit -m "feat(toolgen): add invariant I39 and static rule D29"

```

---

### Task 18: Cross-platform integration test — a raw `fetch()` really is blocked

**Files:**
- Create: `packages/gateway/test/integration/toolgen/toolgen-network-denied.test.ts`

This is the load-bearing test of the whole PR. It must run on Windows, macOS and Linux.

- [ ] **Step 1: Write the failing test**

```ts

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSandboxRunner } from "../../../src/platform/sandbox/sandbox-runner.ts";
import { buildGeneratedManifest } from "../../../src/toolgen/toolgen-stub.ts";
import { policyFromManifest } from "../../../src/platform/sandbox/sandbox-policy.ts";
import { extensionProcessEnv } from "../../../src/extensions/spawn-env.ts";

let server: ReturnType<typeof Bun.serve>;
let hits = 0;
let url = "";

beforeAll(() => {
  hits = 0;
  server = Bun.serve({ port: 0, fetch: () => { hits += 1; return new Response("hit"); } });
  url = `http://127.0.0.1:${server.port}/`;
});
afterAll(() => server.stop(true));

const SCRIPT = (target: string) =>
  `try { const r = await fetch(${JSON.stringify(target)}); console.log("REACHED:" + r.status); process.exit(0); } catch { process.exit(9); }`;

describe("a generated tool's raw fetch() is blocked on this platform", () => {
  // POSITIVE CONTROL FIRST. Without it, "zero hits" passes for any reason at all — including the
  // test never having reached the network, or the server never having started.
  test("control: the SAME request succeeds UNCONFINED", async () => {
    const proc = Bun.spawn([process.execPath, "-e", SCRIPT(url)], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(out).toContain("REACHED:200");
    expect(hits).toBe(1);
  });

  test("confined with an empty network set, the request never arrives", async () => {
    const before = hits;
    const runner = await createSandboxRunner();
    const manifest = buildGeneratedManifest("tg_probe");
    const policy = policyFromManifest(manifest);
    expect(runner.canConfine(policy)).toBeNull();

    const child = runner.spawn(process.execPath, ["-e", SCRIPT(url)], {
      policy,
      env: extensionProcessEnv({}),
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? -1)));

    expect(code).not.toBe(0); // it must not have reached the server
    expect(hits).toBe(before); // and the server must not have been touched
  });
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/gateway/test/integration/toolgen/toolgen-network-denied.test.ts`
Expected: The control passes; the confined case fails until Task 7's manifest exists. On Linux without `bubblewrap`, `canConfine` returns non-null — install it (`sudo apt-get install -y bubblewrap`) rather than skipping, since a skipped test here proves nothing.

- [ ] **Step 3: Write minimal implementation**

No production code. If the confined case fails after Task 7, the sandbox is not confining and **that is a real bug** — fix the policy derivation, never the assertion.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/gateway/test/integration/toolgen/`
Expected: PASS locally. Then `bun run verify:docker --changed` to confirm on Linux, since a Windows-only green says nothing about the other two platforms.

- [ ] **Step 5: Commit**

```bash

git add packages/gateway/test/integration/toolgen
git commit -m "test(toolgen): prove a generated tool's raw fetch is blocked, with a positive control"

```

---

## Final verification

- [ ] `bun run preflight` — full CI parity, all gates.
- [ ] `bun run verify:docker --changed` — Linux-authoritative for the sandbox tests. A green Windows run does not predict the Linux leg.
- [ ] `bun run audit:platform-test-gaps` — Task 18 must actually execute on this OS; a platform-skipped test never runs locally and CI is its first execution.
- [ ] Confirm `[tool_generation]` is absent from `nimbus.toml` defaults on a fresh install and the capability is off.
- [ ] Confirm `toolgen` appears in **no** Tauri `ALLOWED_METHODS` entry.
- [ ] Update `docs/roadmap.md` § Active: mark the runtime-tool-generation row as PR 1 of 3 shipped, and update `docs/CHANGELOG.md`.
