# Security Fixes — Low-tier (PR 3 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Low-severity findings from `docs/superpowers/specs/2026-04-25-security-audit-results.md` after the High PR (`#112`, merged 2026-04-26) and the Medium PR (`#113`, merged 2026-04-26). Land as nine independent commit groups on a new branch `dev/asafgolombek/security-fixes-low`.

**Architecture:** Each commit group targets a single subsystem and is independently revertable. G1 closes the residual HITL-gate gaps (`connector.reindex`, frozen-facade hardening). G2 hardens the vault layer (DPAPI optional entropy, key-format case-folding, `vault.set` IPC HITL gate, KDF allowlist on import). G3 unifies redaction across the renderer (frontend forbidden-keys list and persist scrub) and adds a pino log redaction config. G4 tightens the SQL hygiene perimeter (verify.ts comment fix, person-store SQL refactor, repair.ts identifier guard, allowlist test assertion). G5 closes the LAN polish list (handshake `recordFailure`, peer dedupe, lockout reply parity, pairing window timer). G6 polishes the updater (temp cleanup, error scrubbing, constant-time hash compare, semver validation). G7 polishes extensions (timing-safe hash compare, ID length cap, signal child on disable). G8 polishes the MCP layer (UUID ids, args_json error logging). G9 syncs the Tauri allowlist tests with the as-built ALLOWED_METHODS array.

**Tech Stack:** Bun v1.2+ / TypeScript 6.x strict, Biome linter, `bun:test`. No new runtime dependencies. One Rust-side test addition in `gateway_bridge.rs` (G9).

**Findings addressed in this PR:**

| ID | Surface | Title | Group |
|---|---|---|---|
| S1-F7 | HITL | `connector.reindex` not in `HITL_REQUIRED` (full-depth only) | G1 |
| S1-F8 | HITL | `HITL_REQUIRED` facade has no `add` to throw on misuse | G1 |
| S2-F4 | Vault | DPAPI uses no `pOptionalEntropy` — same-uid decrypt without Nimbus identity | G2 |
| S2-F7 | Vault | Vault key regex `/i` flag permits case-folded near-collisions | G2 |
| S2-F8 | Vault | `vault.set` IPC method ungated (any local IPC client can plant secrets) | G2 |
| S2-F10 | Vault | `decryptVaultManifest` trusts attacker-supplied KDF parameters | G2 |
| S2-F6 | Frontend | `FORBIDDEN_VALUE_KEYS` / `FORBIDDEN_PERSIST_KEYS` exclude connector-secret names | G3 |
| S2-F9 | Logging | `pino` may serialize provider-API-key hints in error chains | G3 |
| S5-F1 | DB | `verify.ts checkFts5Consistency` writes during "non-destructive" verify | G4 |
| S5-F5 | DB | `person-store.ts patchPerson` builds SQL via `sets.join()` template | G4 |
| S5-F6 | DB | `repair.ts repairForeignKeys` lacks null-byte guard around identifiers | G4 |
| S5-F7 | DB | Allowlist test does not explicitly assert `index.querySql` absent | G4, G9 |
| S3-F4 | LAN | Hello-handshake unknown-pubkey path skips `recordFailure` | G5 |
| S3-F5 | LAN | `addLanPeer` lacks `ON CONFLICT` upsert — re-pair throws UNIQUE constraint | G5 |
| S3-F6 | LAN | Pre-handshake `pair_err` reply leaks lockout state to `hello` probes | G5 |
| S3-F9 | LAN | `lan.openPairingWindow` returns `expiresAt` from a different timer than `PairingWindow.windowMs` | G5 |
| S6-F8 | Updater | Temp directory `nimbus-update-*` and `installer.bin` never cleaned up | G6 |
| S6-F9 | Updater | `getStatus.lastError` echoes raw fetch URLs (potential userinfo leak) | G6 |
| S6-F10 | Updater | `computedSha !== asset.sha256` short-circuits — switch to `timingSafeEqual` | G6 |
| S6-F11 | Updater | Manifest validator does not enforce semver / pub_date format | G6 |
| S7-F8 | Extensions | Hash comparisons use JS `!==` (non-constant-time) | G7 |
| S7-F9 | Extensions | Extension ID has no length cap (Windows MAX_PATH DoS) | G7 |
| S7-F10 | Extensions | `setExtensionEnabled(false)` does not signal running child | G7 |
| S8-F8 | MCP | Timestamp-based MCPClient `id` (`Date.now()`) — replace with UUID | G8 |
| S8-F9 | MCP | `ensureUserMcpClient` silently swallows malformed `args_json` | G8 |
| S4-F2 | Tauri | `connector.startAuth` allowlisted but no gateway handler | G9 |

**Findings deferred and reasons:**

| ID | Severity | Why deferred |
|---|---|---|
| S3-F8 | Low (defense-in-depth) | Forward secrecy requires per-session ephemeral X25519 DH and a handshake redesign; multi-PR architectural change tracked under Phase 7 LAN hardening |
| S4-F6 | Low | Path validation for `data.import` belongs to the deferred UI-rebuild PR (Tauri-native dialog); same family as S4-F5/S7-F7 |
| S4-F8 | Low | Profile-switch global broadcast behavior change requires Rust-side window registry refactor; folds into the UI-rebuild PR |
| S5-F4 | Low | 79 production `db.run()` call sites — separate refactor PR (per Medium plan deferral) |
| S6-F1 | Low (informational) | Updater is dormant; the wiring task lands when GA prerequisites are signed off |
| S8-F10 | Low | Spec marks "out of scope for Phase 4 audit cleanup" — tool-call result auditing is a Phase 5 enhancement |
| S3-F7 | Low | Already closed by High PR G4 (`DEFAULT_NIMBUS_LAN_TOML.bind = "127.0.0.1"`) |
| S4-F7 | Low | Already closed (`connector.list` is in `ALLOWED_METHODS`); G9 only adds a regression assertion |

---

## File map

| File | Groups | Change |
|---|---|---|
| `packages/gateway/src/engine/executor.ts` | G1 | Add `connector.reindex` to `HITL_REQUIRED_BACKING`; add `add` no-op throwing method to facade |
| `packages/gateway/src/engine/executor.test.ts` | G1 | Tests for `connector.reindex` gating + facade `add` rejection |
| `packages/gateway/src/ipc/reindex-rpc.ts` | G1 | Route `connector.reindex` through `ToolExecutor.gate()` for `full` depth |
| `packages/gateway/src/ipc/reindex-rpc.test.ts` | G1 | Regression: `metadata_only` skips gate; `full` requires consent |
| `packages/gateway/src/vault/key-format.ts` | G2 | Drop `/i` flag from regex |
| `packages/gateway/src/vault/key-format.test.ts` | G2 | New tests: rejects uppercase, accepts lowercase |
| `packages/gateway/src/vault/win32.ts` | G2 | DPAPI optional entropy: load-or-generate `<configDir>/vault/.entropy` and pass to all CryptProtect/Unprotect |
| `packages/gateway/src/vault/win32.test.ts` | G2 | New crash-safety + entropy round-trip tests; legacy-no-entropy migration path |
| `packages/gateway/src/ipc/server.ts` | G2 | Route `vault.set` and `vault.delete` through `ToolExecutor.gate()` for non-extension callers |
| `packages/gateway/src/ipc/server.test.ts` | G2 | Tests for `vault.set` gate fires |
| `packages/gateway/src/db/data-vault-crypto.ts` | G2 | Validate `blob.kdf` against an allowed-profile list before passing to `kdf()` |
| `packages/gateway/src/db/data-vault-crypto.test.ts` | G2 | New tests: weak KDF rejected on import |
| `packages/ui/src/ipc/client.ts` | G3 | Expand `FORBIDDEN_VALUE_KEYS` to include connector-secret value names |
| `packages/ui/src/store/partialize.ts` | G3 | Expand `FORBIDDEN_PERSIST_KEYS` to mirror gateway-side regex coverage |
| `packages/ui/src/ipc/client.test.ts` | G3 | New tests: connector-token names redacted in error redaction |
| `packages/ui/src/store/partialize.test.ts` | G3 | New tests: persist deep-scrub strips connector-secret keys |
| `packages/gateway/src/logging/redacted-pino.ts` | G3 | NEW — wraps `createGatewayPinoLogger` with `pino.redact` config that strips `authorization|api[-_]?key|token|secret|bearer` patterns |
| `packages/gateway/src/logging/redacted-pino.test.ts` | G3 | NEW — tests the redact config with known PAT/Bearer/sk- shaped values |
| `packages/gateway/src/embedding/create-embedding-runtime.ts` | G3 | Use sanitized error wrapper instead of raw `{ err }` |
| `packages/gateway/src/db/verify.ts` | G4 | Add JSDoc comment clarifying the FTS5 magic-write |
| `packages/gateway/src/people/person-store.ts` | G4 | Convert `patchPerson` template-literal SQL to per-field `dbRun` calls |
| `packages/gateway/src/people/person-store.test.ts` | G4 | Regression: each `patchPerson` field path covered |
| `packages/gateway/src/db/repair.ts` | G4 | Null-byte / empty-name guard before `escapeIdentifier` |
| `packages/gateway/src/db/repair.test.ts` | G4 | New tests: violation row with empty/null-byte table is skipped |
| `packages/ui/src-tauri/src/gateway_bridge.rs` | G4, G9 | Allowlist tests assert `index.querySql` absent and that handler exists for every allowlist entry |
| `packages/gateway/src/ipc/lan-server.ts` | G5 | Hello unknown-peer path calls `recordFailure`; lockout response uses kind-aware code |
| `packages/gateway/src/ipc/lan-server.test.ts` | G5 | Tests for unknown-pubkey rate-limit and `hello`-vs-`pair` lockout reply parity |
| `packages/gateway/src/index/local-index.ts` | G5 | `addLanPeer` uses `INSERT ... ON CONFLICT(peer_pubkey) DO UPDATE` |
| `packages/gateway/src/index/local-index.test.ts` | G5 | Tests for repeated pair upsert |
| `packages/gateway/src/ipc/server.ts` | G5 | `lan.openPairingWindow` reads `expiresAt` from `pw.getExpiresAt()`, drops the diverging `lanPairingWindowMs` option |
| `packages/gateway/src/ipc/lan-pairing.ts` | G5 | Expose `getExpiresAt()` if not already |
| `packages/gateway/src/ipc/server.test.ts` | G5 | Test asserting returned `expiresAt` matches `PairingWindow` |
| `packages/gateway/src/updater/updater.ts` | G6 | Wrap install in `try/finally` + `rmSync(tempDir)` cleanup; sanitize `lastError` URLs; `timingSafeEqual` for SHA-256 compare |
| `packages/gateway/src/updater/updater.test.ts` | G6 | Tests: temp cleanup on success and failure; redacted lastError; timing-safe equal |
| `packages/gateway/src/updater/manifest-fetcher.ts` | G6 | Strict semver + ISO-8601 `pub_date` regex on validate; sanitized error strings |
| `packages/gateway/src/updater/manifest-fetcher.test.ts` | G6 | Tests for malformed-semver and bad-date rejection; URL-userinfo stripped |
| `packages/gateway/src/extensions/verify-extensions.ts` | G7 | `timingSafeEqual` for both manifest- and entry-hash comparisons; signal running child on hash mismatch |
| `packages/gateway/src/extensions/verify-extensions.test.ts` | G7 | Tests for timing-safe compare and hash-mismatch signaling |
| `packages/gateway/src/extensions/install-from-local.ts` | G7 | Same `timingSafeEqual` migration; max-length guard in `assertSafeExtensionId` |
| `packages/gateway/src/extensions/install-from-local.test.ts` | G7 | Tests for ID length cap |
| `packages/gateway/src/ipc/automation-rpc.ts` | G7 | `extension.disable` calls `mesh.stopExtensionClient(id)` after DB flag flip |
| `packages/gateway/src/connectors/lazy-mesh.ts` | G7, G8 | Public `stopExtensionClient(id)`; replace `Date.now()` MCPClient ids with `randomUUID()`; log + transition health on `args_json` parse failure |
| `packages/gateway/src/connectors/lazy-mesh.test.ts` | G7, G8 | Tests for `stopExtensionClient`, UUID ids, `args_json` parse failure surfaces a `persistent_error` health row |
| `packages/ui/src-tauri/src/gateway_bridge.rs` | G9 | Move `connector.startAuth` → `connector.auth` if the gateway handler exists; otherwise add a Rust-side compile-time test that pairs every allowlist entry with the gateway handler list |
| `packages/gateway/src/ipc/connector-rpc.ts` | G9 | Add a thin `connector.startAuth` alias that delegates to `connector.auth` so the existing frontend caller succeeds |
| `packages/gateway/src/ipc/connector-rpc.test.ts` | G9 | Test: `connector.startAuth` dispatches to the same handler as `connector.auth` |
| `docs/SECURITY.md` | G6, G7 | Document updater temp cleanup contract; document `extension.disable` subprocess-orphan limitation |

---

## Execution order

G1 → G2 → G3 → G4 → G5 → G6 → G7 → G8 → G9 → final CI.

G1 changes only `executor.ts` HITL set + `reindex-rpc.ts`. G2 changes `vault/win32.ts`, `vault/key-format.ts`, `ipc/server.ts`, `db/data-vault-crypto.ts`. G3 changes UI `ipc/client.ts`, UI `partialize.ts`, gateway `embedding/create-embedding-runtime.ts`, plus a new logging module. G4 is multi-file but small. G5 / G6 / G7 / G8 are in their respective subsystems. G9 is Rust-side allowlist test maintenance.

No two groups edit the same line range. Subagents may implement G2–G9 in parallel after G1 lands; G1 introduces no new types so the parallel work is purely additive.

---

## Task 1 — G1: Add `connector.reindex` to HITL gating with depth-aware logic

**Files:**
- Modify: `packages/gateway/src/engine/executor.ts:105-111`
- Modify: `packages/gateway/src/ipc/reindex-rpc.ts`
- Create: `packages/gateway/src/ipc/reindex-rpc.test.ts` (if absent — verify with `ls`)
- Modify: `packages/gateway/src/engine/executor.test.ts`

- [ ] **Step 1: Read current state**

```bash
ls packages/gateway/src/ipc/reindex-rpc.test.ts || echo "create"
```

If `create` is printed, create the file in Step 3. Otherwise append the new `describe` block.

- [ ] **Step 2: Write the failing test for the executor whitelist**

In `packages/gateway/src/engine/executor.test.ts`, add:

```typescript
import { HITL_REQUIRED } from "./executor.ts";

describe("HITL_REQUIRED — destructive admin gating (S1-F7)", () => {
  test("connector.reindex is in HITL_REQUIRED so full-depth reindex requires consent", () => {
    expect(HITL_REQUIRED.has("connector.reindex")).toBe(true);
  });

  test("HITL_REQUIRED facade rejects mutation via add() (S1-F8)", () => {
    expect(() => {
      // @ts-expect-error — verifying the runtime guard, not the type
      (HITL_REQUIRED as Set<string>).add("attacker.action");
    }).toThrow(TypeError);
    expect(HITL_REQUIRED.has("attacker.action")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the failing tests**

Run: `bun test packages/gateway/src/engine/executor.test.ts`
Expected: FAIL — `connector.reindex` is not in the set; `add` is `undefined` (not a function).

- [ ] **Step 4: Implement the executor changes**

Edit `packages/gateway/src/engine/executor.ts`. After the existing `"data.export",` line in `HITL_REQUIRED_BACKING`, add the new entry:

```typescript
  "data.export",
  "connector.reindex",
]);
```

In the `HITL_REQUIRED` frozen facade object, **append** an `add` method directly before the closing `}) as ReadonlySet<string>;` line:

```typescript
  forEach(
    callbackfn: (value: string, value2: string, set: ReadonlySet<string>) => void,
    thisArg?: unknown,
  ): void {
    for (const v of HITL_REQUIRED_BACKING) {
      callbackfn.call(thisArg, v, v, HITL_REQUIRED);
    }
  },
  /** S1-F8 — surface accidental mutation attempts at runtime. */
  add(_value: string): never {
    throw new TypeError(
      "HITL_REQUIRED is immutable; edit HITL_REQUIRED_BACKING in executor.ts instead",
    );
  },
}) as ReadonlySet<string>;
```

- [ ] **Step 5: Re-run the executor tests**

Run: `bun test packages/gateway/src/engine/executor.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing reindex-rpc test**

Create or append to `packages/gateway/src/ipc/reindex-rpc.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { dispatchReindexRpc } from "./reindex-rpc.ts";
import type { ToolExecutor } from "../engine/executor.ts";

describe("dispatchReindexRpc — depth-aware HITL gate (S1-F7)", () => {
  test("metadata_only skips gate (administrative, no consent)", async () => {
    let gateCalls = 0;
    const fakeExecutor = {
      gate: async () => {
        gateCalls++;
      },
    } as unknown as ToolExecutor;
    const reindexCalls: unknown[] = [];
    const fakeReindex = async (input: unknown) => {
      reindexCalls.push(input);
      return { itemsAffected: 0, depth: "metadata_only", mode: "shallow" as const };
    };
    const out = await dispatchReindexRpc(
      "connector.reindex",
      { service: "github", depth: "metadata_only" },
      {
        toolExecutor: fakeExecutor,
        runReindex: fakeReindex,
        index: {} as never,
      },
    );
    expect(gateCalls).toBe(0);
    expect(reindexCalls.length).toBe(1);
    expect(out.kind).toBe("hit");
  });

  test("full depth requires gate() before runReindex", async () => {
    const order: string[] = [];
    const fakeExecutor = {
      gate: async () => {
        order.push("gate");
      },
    } as unknown as ToolExecutor;
    const fakeReindex = async () => {
      order.push("run");
      return { itemsAffected: 0, depth: "full", mode: "deepen" as const };
    };
    await dispatchReindexRpc(
      "connector.reindex",
      { service: "github", depth: "full" },
      {
        toolExecutor: fakeExecutor,
        runReindex: fakeReindex,
        index: {} as never,
      },
    );
    expect(order).toEqual(["gate", "run"]);
  });
});
```

- [ ] **Step 7: Run the failing test**

Run: `bun test packages/gateway/src/ipc/reindex-rpc.test.ts`
Expected: FAIL — `dispatchReindexRpc` does not yet take a `toolExecutor` option, and the test imports types/helpers that may not yet be exported.

- [ ] **Step 8: Implement `dispatchReindexRpc` depth-aware gate**

Read `packages/gateway/src/ipc/reindex-rpc.ts` first to see the current shape, then update it to accept the options pattern used by other RPC dispatchers. The public signature becomes:

```typescript
import type { LocalIndex } from "../index/local-index.ts";
import type { ToolExecutor } from "../engine/executor.ts";
import type { ReindexInput, ReindexResult } from "../connectors/reindex.ts";
import { reindexConnector } from "../connectors/reindex.ts";

export type ReindexRpcOptions = {
  index: LocalIndex;
  toolExecutor?: ToolExecutor;
  runReindex?: (input: ReindexInput) => Promise<ReindexResult>;
};

export type ReindexRpcOutcome =
  | { kind: "hit"; value: ReindexResult }
  | { kind: "miss" };

export async function dispatchReindexRpc(
  method: string,
  params: unknown,
  opts: ReindexRpcOptions,
): Promise<ReindexRpcOutcome> {
  if (method !== "connector.reindex") return { kind: "miss" };
  const rec = (typeof params === "object" && params !== null ? params : {}) as Record<
    string,
    unknown
  >;
  const service = typeof rec["service"] === "string" ? rec["service"] : "";
  const depthRaw = typeof rec["depth"] === "string" ? rec["depth"] : "metadata_only";
  if (service.length === 0) {
    throw new Error("connector.reindex: service is required");
  }
  const depth = (
    depthRaw === "metadata_only" || depthRaw === "summary" || depthRaw === "full"
      ? depthRaw
      : "metadata_only"
  ) as ReindexInput["depth"];
  // S1-F7 — only `full` (deep, irreversible) reindex requires consent.
  // metadata_only is administrative and runs without a gate to preserve
  // the existing CLI/automation flow.
  if (depth === "full" && opts.toolExecutor !== undefined) {
    await opts.toolExecutor.gate({
      type: "connector.reindex",
      payload: { service, depth },
    });
  }
  const runner = opts.runReindex ?? reindexConnector;
  const result = await runner({ index: opts.index, service, depth });
  return { kind: "hit", value: result };
}
```

If `ToolExecutor.gate(...)` does not yet exist on the public type, read `engine/executor.ts` lines 1-50 — the Medium PR introduced `gate()` (commit `1758230`); use that. If `gate()` is private, expose it on the public `ToolExecutor` interface in `executor.ts`. Verify with:

```bash
grep -n "^\s*async gate\b\|public gate\b\|gate(" packages/gateway/src/engine/executor.ts | head -10
```

If `gate` is named differently in the current branch (e.g. `gateConsent`), update the test and the dispatcher accordingly — the contract is "consent gate runs before the side-effecting call."

- [ ] **Step 9: Wire `toolExecutor` from `server.ts`**

Open `packages/gateway/src/ipc/server.ts` and find the existing call to `dispatchReindexRpc` (search: `grep -n "dispatchReindexRpc\|reindex-rpc" packages/gateway/src/ipc/server.ts`). Update the call site to pass `toolExecutor` from the per-client bound `ToolExecutor` (the same threading pattern G2 of the High PR introduced for `dispatchDataRpc` / `dispatchConnectorRpc`). Reference the High PR commit (`1758230`) for the exact threading: the per-client executor is constructed via `bindConsentChannel` and passed into the dispatcher options.

If the call site looks like:

```typescript
const out = await dispatchReindexRpc(method, params, { index: localIndex });
```

change to:

```typescript
const out = await dispatchReindexRpc(method, params, {
  index: localIndex,
  ...(toolExecutor === undefined ? {} : { toolExecutor }),
});
```

- [ ] **Step 10: Run all touched tests and the full reindex coverage gate**

Run:
```bash
bun test packages/gateway/src/engine/executor.test.ts packages/gateway/src/ipc/reindex-rpc.test.ts
```
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/gateway/src/engine/executor.ts packages/gateway/src/engine/executor.test.ts packages/gateway/src/ipc/reindex-rpc.ts packages/gateway/src/ipc/reindex-rpc.test.ts packages/gateway/src/ipc/server.ts
git commit -m "$(cat <<'EOF'
fix(security): HITL-gate full-depth connector.reindex + lock HITL_REQUIRED facade (G1)

Closes S1-F7, S1-F8.

- Add connector.reindex to HITL_REQUIRED_BACKING; reindex-rpc routes
  full-depth calls through ToolExecutor.gate(). metadata_only stays
  ungated (administrative; preserves existing CLI/automation behaviour).
- Add an `add` method to the HITL_REQUIRED frozen facade that throws
  TypeError, surfacing accidental mutation attempts at runtime instead
  of silently no-oping through the proxy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — G2: Vault key regex case-fold removal

**Files:**
- Modify: `packages/gateway/src/vault/key-format.ts`
- Create or modify: `packages/gateway/src/vault/key-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/vault/key-format.test.ts` (or append to an existing one — verify with `ls`):

```typescript
import { describe, expect, test } from "bun:test";
import { isWellFormedVaultKey, validateVaultKeyOrThrow } from "./key-format.ts";

describe("isWellFormedVaultKey (S2-F7)", () => {
  test("accepts lowercase namespaced keys", () => {
    expect(isWellFormedVaultKey("github.pat")).toBe(true);
    expect(isWellFormedVaultKey("google_drive.oauth")).toBe(true);
  });

  test("rejects uppercase to prevent Windows NTFS case-fold collisions", () => {
    expect(isWellFormedVaultKey("Github.PAT")).toBe(false);
    expect(isWellFormedVaultKey("github.PAT")).toBe(false);
    expect(isWellFormedVaultKey("GITHUB.pat")).toBe(false);
  });

  test("rejects malformed keys", () => {
    expect(isWellFormedVaultKey("nodot")).toBe(false);
    expect(isWellFormedVaultKey(".leading")).toBe(false);
    expect(isWellFormedVaultKey("trailing.")).toBe(false);
    expect(isWellFormedVaultKey("123.abc")).toBe(false);
  });

  test("validateVaultKeyOrThrow throws on uppercase", () => {
    expect(() => validateVaultKeyOrThrow("Github.pat")).toThrow("Invalid vault key format");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `bun test packages/gateway/src/vault/key-format.test.ts`
Expected: FAIL — uppercase currently passes due to `/i` flag.

- [ ] **Step 3: Drop the `/i` flag**

Edit `packages/gateway/src/vault/key-format.ts`:

```typescript
export function isWellFormedVaultKey(key: string): boolean {
  if (key.length === 0 || key.length > 256) {
    return false;
  }
  return /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(key);
}
```

- [ ] **Step 4: Re-run tests**

Run: `bun test packages/gateway/src/vault/key-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Run vault coverage gate**

Run: `bun run test:coverage:vault`
Expected: PASS at ≥90%. If any existing test assumed `/i` (e.g. asserts `Github.pat` is well-formed), update it to use the lowercase form — the assumption was incorrect security hygiene. Search:

```bash
grep -rn "Github\\.\\|GITHUB\\." packages/gateway/src/vault/ | head
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/vault/key-format.ts packages/gateway/src/vault/key-format.test.ts
git commit -m "$(cat <<'EOF'
fix(security): tighten vault key regex (no case-fold) (G2 part 1/4)

Closes S2-F7.

- Drop /i flag from isWellFormedVaultKey to prevent Windows NTFS
  case-insensitive overwrite (e.g. "Github.PAT" colliding with
  "github.pat" on a single-volume install).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — G2: DPAPI optional entropy

**Files:**
- Modify: `packages/gateway/src/vault/win32.ts`
- Modify: `packages/gateway/src/vault/win32.test.ts`

The change loads (or generates on first run) a 32-byte entropy file at `<configDir>/vault/.entropy`, persists it (DPAPI-protected itself for at-rest safety, then a flat read after the first boot), and threads it into every `CryptProtectData` / `CryptUnprotectData` call. A legacy migration path: if a `.enc` file is encountered that fails to decrypt with entropy, retry without entropy and re-encrypt with entropy on success. Write only when key was created post-fix.

- [ ] **Step 1: Read the current vault/win32.ts to ground the change**

```bash
grep -n "CryptProtectData\|CryptUnprotectData\|encPath\|writeFile\|readFile\|set(\|get(" packages/gateway/src/vault/win32.ts | head -30
```

Identify the exact lines for `set`, `get`, and the FFI calls. (Spec mentions lines 105-113 and 161-169 for the FFI sites; lines 94-129 for `set`.)

- [ ] **Step 2: Write the failing test for entropy round-trip + legacy migration**

Append to `packages/gateway/src/vault/win32.test.ts` (skip on non-Windows hosts via `process.platform`):

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const isWin = process.platform === "win32";

describe.if(isWin)("DpapiVault — optional entropy (S2-F4)", () => {
  test("round-trips a value using entropy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-dpapi-"));
    const { DpapiVault } = await import("./win32.ts");
    const vault = new DpapiVault({ vaultDir: dir });
    await vault.set("github.pat", "ghp_test_value");
    const entropyPath = join(dir, ".entropy");
    expect(existsSync(entropyPath)).toBe(true);
    const got = await vault.get("github.pat");
    expect(got).toBe("ghp_test_value");
  });

  test("legacy entry without entropy is migrated on first read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-dpapi-legacy-"));
    const { DpapiVault, _legacyEncryptForTest } = await import("./win32.ts");
    // Encrypt without entropy, simulating pre-fix data.
    const blob = _legacyEncryptForTest("legacy_value");
    writeFileSync(join(dir, "github.pat.enc"), blob.toString("base64"), "utf8");
    const vault = new DpapiVault({ vaultDir: dir });
    const got = await vault.get("github.pat");
    expect(got).toBe("legacy_value");
    // After read, the entry is re-written with entropy. Read again from a fresh handle.
    const vault2 = new DpapiVault({ vaultDir: dir });
    expect(await vault2.get("github.pat")).toBe("legacy_value");
  });
});
```

If `DpapiVault` is exported under a different name in the current file, replace the import with the actual export name (e.g. `DpapiNimbusVault` — check via `grep -n "export class\|export function" packages/gateway/src/vault/win32.ts`).

- [ ] **Step 3: Run test (Windows-only — will skip on Linux/macOS dev hosts)**

Run: `bun test packages/gateway/src/vault/win32.test.ts`
Expected: SKIPPED on POSIX, FAIL on Windows.

- [ ] **Step 4: Implement the entropy load-or-create + threading**

Read the existing `vault/win32.ts` end-to-end. Apply these changes:

1. Add module-level helper `loadOrCreateEntropy(vaultDir: string): Buffer`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const ENTROPY_FILENAME = ".entropy";
const ENTROPY_LEN = 32;

function loadOrCreateEntropy(vaultDir: string): Buffer {
  const path = join(vaultDir, ENTROPY_FILENAME);
  if (existsSync(path)) {
    const buf = readFileSync(path);
    if (buf.length === ENTROPY_LEN) return buf;
  }
  mkdirSync(vaultDir, { recursive: true });
  const generated = randomBytes(ENTROPY_LEN);
  writeFileSync(path, generated, { flag: "wx" });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows ignores chmod for non-FAT volumes */
  }
  // Set Hidden + System on Windows so a casual file-explorer browse
  // does not surface the entropy file. Defense against accidental delete
  // (vault-availability concern raised in plan-design review item #2).
  if (process.platform === "win32") {
    try {
      const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
      spawnSync("attrib", ["+H", "+S", path], { windowsHide: true });
    } catch {
      /* best effort — entropy still works without the attribute */
    }
  }
  return generated;
}
```

2. In the `DpapiVault` constructor (or equivalent factory), cache the entropy:

```typescript
constructor(opts: { vaultDir: string }) {
  this.vaultDir = opts.vaultDir;
  this.entropy = loadOrCreateEntropy(this.vaultDir);
}
```

3. Pass the entropy buffer into every `CryptProtectData` and `CryptUnprotectData` call. The third pointer arg currently passes `null`. Build a `DATA_BLOB` for the entropy (mirror the existing `DATA_BLOB` construction for the input/output). Reference the existing FFI wrapper file (search: `grep -n "DATA_BLOB\|crypt32" packages/gateway/src/vault/win32.ts`) and replace the third arg with a pointer to the entropy blob.

Pseudocode (the exact FFI shape depends on `bun:ffi`; preserve the existing pattern):

```typescript
const entropyBlob = makeDataBlob(this.entropy);
const out = crypt32.symbols.CryptProtectData(
  inputBlob,
  null, // szDataDescr
  entropyBlob, // <-- was null
  null, // pvReserved
  null, // pPromptStruct
  flags,
  outputBlob,
);
```

4. Implement legacy fallback in `get`: if `CryptUnprotectData` with entropy returns 0, retry with `null` entropy. On success, immediately call `set` with the recovered plaintext to re-encrypt with entropy.

5. Export `_legacyEncryptForTest` (test-only — guard with `// istanbul ignore next` and a comment) for the legacy-migration test:

```typescript
/** Test-only helper — encrypts without entropy to simulate pre-fix vault entries. */
export function _legacyEncryptForTest(plaintext: string): Buffer {
  // Reuse the existing encrypt path with entropy = null
  return encryptDpapi(Buffer.from(plaintext, "utf8"), null);
}
```

- [ ] **Step 5: Re-run tests on Windows**

Run: `bun test packages/gateway/src/vault/win32.test.ts`
Expected: PASS on Windows.

- [ ] **Step 6: Run the vault coverage gate**

Run: `bun run test:coverage:vault`
Expected: PASS at ≥90%.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/vault/win32.ts packages/gateway/src/vault/win32.test.ts
git commit -m "$(cat <<'EOF'
fix(security): DPAPI vault uses optional entropy + legacy migration (G2 part 2/4)

Closes S2-F4.

- Load-or-create <vaultDir>/.entropy on first run and pass it as
  pOptionalEntropy to every CryptProtectData / CryptUnprotectData call.
  Raises the bar on Windows from "any same-uid process" to "any process
  that can read .entropy" for vault decryption.
- Legacy migration: if decrypt-with-entropy fails, fall back to no-entropy
  and immediately re-encrypt with entropy on the next set(). Existing
  pre-fix vault entries are silently upgraded on first read.
- Add Windows-gated round-trip and legacy-migration tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — G2: Route `vault.set` and `vault.delete` through HITL

**Files:**
- Modify: `packages/gateway/src/ipc/server.ts:99-127`
- Modify: `packages/gateway/src/ipc/server.test.ts` (or the dispatch-side test that exercises `vault.set`)

The fix wraps `vault.set` and `vault.delete` in a HITL gate. Reads (`vault.get`, `vault.listKeys`) stay open — they are required by connector auth flows. Internal callers (auth/OAuth) already use vault directly via the typed `NimbusVault` interface, not via IPC, so they bypass this gate by design.

- [ ] **Step 1: Add `vault.set` and `vault.delete` to HITL_REQUIRED_BACKING**

Edit `packages/gateway/src/engine/executor.ts` and append after the entries added in G1:

```typescript
  "data.export",
  "connector.reindex",
  "vault.set",
  "vault.delete",
]);
```

- [ ] **Step 2: Write the failing test**

Add to `packages/gateway/src/ipc/server.test.ts`:

```typescript
describe("dispatchVaultIfPresent — IPC HITL (S2-F8)", () => {
  test("vault.set requires consent before persistence", async () => {
    let setCalled = 0;
    let gateCalled = 0;
    const mockVault = {
      set: async () => {
        setCalled++;
      },
      get: async () => null,
      delete: async () => {},
      listKeys: async () => [],
    };
    const mockExecutor = {
      gate: async () => {
        gateCalled++;
      },
    };
    // Use the exported dispatch helper — exact import name depends on the
    // current refactor state. Search via:
    //   grep -n "export.*dispatchVault" packages/gateway/src/ipc/server.ts
    const { dispatchVaultGated } = await import("./server.ts");
    await dispatchVaultGated(
      mockVault as never,
      mockExecutor as never,
      "vault.set",
      { key: "github.pat", value: "ghp_test" },
    );
    expect(gateCalled).toBe(1);
    expect(setCalled).toBe(1);
  });

  test("vault.set runs gate BEFORE the underlying set call", async () => {
    const order: string[] = [];
    const mockVault = {
      set: async () => {
        order.push("set");
      },
      get: async () => null,
      delete: async () => {},
      listKeys: async () => [],
    };
    const mockExecutor = {
      gate: async () => {
        order.push("gate");
      },
    };
    const { dispatchVaultGated } = await import("./server.ts");
    await dispatchVaultGated(
      mockVault as never,
      mockExecutor as never,
      "vault.set",
      { key: "github.pat", value: "ghp_test" },
    );
    expect(order).toEqual(["gate", "set"]);
  });

  test("vault.get does NOT call the gate (read-only)", async () => {
    let gateCalls = 0;
    const mockVault = {
      get: async () => "value",
      set: async () => {},
      delete: async () => {},
      listKeys: async () => [],
    };
    const mockExecutor = {
      gate: async () => {
        gateCalls++;
      },
    };
    const { dispatchVaultGated } = await import("./server.ts");
    await dispatchVaultGated(
      mockVault as never,
      mockExecutor as never,
      "vault.get",
      { key: "github.pat" },
    );
    expect(gateCalls).toBe(0);
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `bun test packages/gateway/src/ipc/server.test.ts`
Expected: FAIL — `dispatchVaultGated` does not exist yet.

- [ ] **Step 4: Implement the gated dispatch**

In `packages/gateway/src/ipc/server.ts`, add a new exported function alongside `dispatchVaultIfPresent`:

```typescript
export async function dispatchVaultGated(
  vault: NimbusVault,
  toolExecutor: ToolExecutor | undefined,
  method: string,
  params: unknown,
): Promise<VaultDispatchOutcome> {
  // Reads stay ungated.
  if (method === "vault.get" || method === "vault.listKeys") {
    return dispatchVaultIfPresent(vault, method, params);
  }
  // Writes/deletes — gate via ToolExecutor when available. Internal callers
  // (no toolExecutor in the IPC client binding) keep the legacy ungated
  // dispatch — by structural design they already hold the typed vault
  // reference and need not traverse this surface.
  if (method === "vault.set" || method === "vault.delete") {
    if (toolExecutor !== undefined) {
      const rec = (typeof params === "object" && params !== null ? params : {}) as Record<
        string,
        unknown
      >;
      const key = typeof rec["key"] === "string" ? rec["key"] : "";
      // Don't include `value` in the gate payload — never echo a credential
      // through the consent UI. The redactor would catch it but defense-in-depth.
      await toolExecutor.gate({ type: method, payload: { key } });
    }
    return dispatchVaultIfPresent(vault, method, params);
  }
  return dispatchVaultIfPresent(vault, method, params);
}
```

Replace the existing call site in the dispatcher (search: `grep -n "dispatchVaultIfPresent" packages/gateway/src/ipc/server.ts`) with `dispatchVaultGated(vault, toolExecutor, method, params)`. Thread `toolExecutor` from the same per-client `bindConsentChannel` plumbing the High PR added (`1758230`).

- [ ] **Step 5: Re-run tests**

Run: `bun test packages/gateway/src/ipc/server.test.ts packages/gateway/src/engine/executor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/engine/executor.ts packages/gateway/src/ipc/server.ts packages/gateway/src/ipc/server.test.ts
git commit -m "$(cat <<'EOF'
fix(security): HITL-gate vault.set + vault.delete IPC methods (G2 part 3/4)

Closes S2-F8.

- Add vault.set and vault.delete to HITL_REQUIRED_BACKING.
- New dispatchVaultGated wraps vault writes with ToolExecutor.gate(),
  redacting the value from the gate payload. Reads (vault.get,
  vault.listKeys) remain ungated.
- Internal typed-vault callers (auth flows holding a NimbusVault
  reference directly) bypass the gate by design — they don't traverse
  the IPC surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — G2: KDF parameter allowlist on import

**Files:**
- Modify: `packages/gateway/src/db/data-vault-crypto.ts`
- Create or modify: `packages/gateway/src/db/data-vault-crypto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/gateway/src/db/data-vault-crypto.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { encryptVaultManifest, decryptVaultManifest } from "./data-vault-crypto.ts";

describe("decryptVaultManifest — KDF allowlist (S2-F10)", () => {
  test("rejects weak KDF parameters", async () => {
    const blob = await encryptVaultManifest({
      plaintext: "x",
      passphrase: "pass",
      seed: "seed",
    });
    const tampered = { ...blob, kdf: { t: 1, m: 8, p: 1 } };
    await expect(
      decryptVaultManifest(tampered, { passphrase: "pass" }),
    ).rejects.toThrow(/kdf params not in allowlist/i);
  });

  test("accepts the DEFAULT_KDF profile", async () => {
    const blob = await encryptVaultManifest({
      plaintext: "x",
      passphrase: "pass",
      seed: "seed",
    });
    const out = await decryptVaultManifest(blob, { passphrase: "pass" });
    expect(out).toBe("x");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `bun test packages/gateway/src/db/data-vault-crypto.test.ts`
Expected: FAIL — no validation today, weak params silently accepted.

- [ ] **Step 3: Implement the allowlist**

Edit `packages/gateway/src/db/data-vault-crypto.ts`. Above the `decryptVaultManifest` function, add:

```typescript
/**
 * KDF parameter allowlist (S2-F10).
 *
 * Bundles whose `kdf` field deviates from this list are rejected on import.
 * Defends against attacker-substituted weak Argon2id parameters during
 * forensic-image attacks.
 *
 * Migration ordering rule (review item #6): when raising Argon2id costs in
 * a future release, the NEW profile MUST be added to this list at least one
 * release cycle BEFORE any client begins emitting bundles with the new
 * params. Otherwise older Nimbus installs cannot import bundles produced by
 * newer ones — and recovery from passphrase + new bundle becomes impossible
 * without manually downgrading the user's install. Order: (1) ship a release
 * that *accepts* the new profile; (2) wait for the install base to converge;
 * (3) ship a release that *emits* the new profile.
 */
const ACCEPTED_KDF_PROFILES: ReadonlyArray<KdfParams> = [
  { t: 3, m: 64 * 1024, p: 1 }, // DEFAULT_KDF
];

function isAcceptedKdf(p: KdfParams): boolean {
  return ACCEPTED_KDF_PROFILES.some(
    (profile) => profile.t === p.t && profile.m === p.m && profile.p === p.p,
  );
}
```

In `decryptVaultManifest`, after destructuring `blob` and before any `kdf()` call, add:

```typescript
if (!isAcceptedKdf(blob.kdf)) {
  throw new Error(
    `decryptVaultManifest: kdf params not in allowlist (got t=${String(blob.kdf.t)} m=${String(blob.kdf.m)} p=${String(blob.kdf.p)})`,
  );
}
```

- [ ] **Step 4: Re-run tests**

Run: `bun test packages/gateway/src/db/data-vault-crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/data-vault-crypto.ts packages/gateway/src/db/data-vault-crypto.test.ts
git commit -m "$(cat <<'EOF'
fix(security): allowlist Argon2id parameters on vault manifest import (G2 part 4/4)

Closes S2-F10.

- decryptVaultManifest now rejects bundles whose kdf object deviates
  from the DEFAULT_KDF profile (t=3, m=64MiB, p=1). Defends against
  attacker-substituted weak params during forensic-image import.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — G3: Frontend redaction unification

**Files:**
- Modify: `packages/ui/src/ipc/client.ts`
- Modify: `packages/ui/src/store/partialize.ts`
- Modify: `packages/ui/src/ipc/client.test.ts`
- Modify: `packages/ui/src/store/partialize.test.ts`

The gateway-side regex is `/(token|key|secret|password|credential|bearer|auth)/i`. Mirror it on both frontend redaction surfaces.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/src/ipc/client.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
// Adapt the import to the actual exported helper name:
//   grep -n "export.*[Rr]edact" packages/ui/src/ipc/client.ts
import { redactSensitiveSubstrings } from "./client.ts";

describe("redactSensitiveSubstrings — connector-secret coverage (S2-F6)", () => {
  test("redacts apiToken / clientSecret / pat / accessToken / refreshToken / bot_token / api_key / app_password", () => {
    const message = JSON.stringify({
      apiToken: "ghp_xyz",
      clientSecret: "csec",
      pat: "ghp_q",
      accessToken: "at_q",
      refreshToken: "rt_q",
      bot_token: "xoxb_q",
      api_key: "sk-q",
      app_password: "abc",
    });
    const out = redactSensitiveSubstrings(message);
    for (const v of ["ghp_xyz", "csec", "ghp_q", "at_q", "rt_q", "xoxb_q", "sk-q", "abc"]) {
      expect(out.includes(v)).toBe(false);
    }
  });
});
```

Append to `packages/ui/src/store/partialize.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { persistPartialize } from "./partialize.ts";

describe("persistPartialize — connector-secret deep scrub (S2-F6)", () => {
  test("strips apiToken / clientSecret / pat / accessToken / bot_token", () => {
    const state = {
      profile: { active: "work" },
      connectorsList: [
        {
          serviceId: "github",
          apiToken: "ghp_xyz",
          accessToken: "at_q",
          bot_token: "xoxb_q",
        },
      ],
    } as const;
    const out = persistPartialize(state) as Record<string, unknown>;
    const list = out["connectorsList"] as Array<Record<string, unknown>>;
    expect(list?.[0]?.["apiToken"]).toBeUndefined();
    expect(list?.[0]?.["accessToken"]).toBeUndefined();
    expect(list?.[0]?.["bot_token"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `cd packages/ui && bunx vitest run src/ipc/client.test.ts src/store/partialize.test.ts`
Expected: FAIL — `apiToken`, `pat`, etc. are not in the current redaction lists.

- [ ] **Step 3: Implement the unified regex**

Edit `packages/ui/src/ipc/client.ts`. Find `FORBIDDEN_VALUE_KEYS` and replace it with the regex form:

```typescript
// Mirror executor.ts SENSITIVE_PAYLOAD_KEY for cross-surface consistency.
// Keep this exact pattern in sync with packages/gateway/src/engine/executor.ts.
const SENSITIVE_KEY_PATTERN = /(token|key|secret|password|credential|bearer|auth)/i;

function isSensitiveKey(name: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(name);
}
```

Update `redactSensitiveSubstrings` (or whatever the equivalent helper is named in the current file) to test keys via `isSensitiveKey` rather than the static 5-key list. Preserve the existing list-based exact matches as a fallback so existing passphrase / recoverySeed / mnemonic / privateKey / encryptedVaultManifest remain matched verbatim:

```typescript
const EXACT_FORBIDDEN_KEYS = new Set([
  "passphrase",
  "recoverySeed",
  "mnemonic",
  "privateKey",
  "encryptedVaultManifest",
]);

function isForbiddenKey(name: string): boolean {
  return EXACT_FORBIDDEN_KEYS.has(name) || isSensitiveKey(name);
}
```

Edit `packages/ui/src/store/partialize.ts` similarly. Replace the static `FORBIDDEN_PERSIST_KEYS` lookup with the same `isForbiddenKey` predicate (if shared infrastructure already exists, import the predicate; otherwise duplicate it locally and document in a comment that it must mirror the gateway-side regex).

- [ ] **Step 4: Re-run tests**

Run: `cd packages/ui && bunx vitest run src/ipc/client.test.ts src/store/partialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/ipc/client.ts packages/ui/src/store/partialize.ts packages/ui/src/ipc/client.test.ts packages/ui/src/store/partialize.test.ts
git commit -m "$(cat <<'EOF'
fix(security): unify frontend redaction with gateway regex (G3 part 1/2)

Closes S2-F6.

- redactSensitiveSubstrings and persistPartialize now use the same
  /(token|key|secret|password|credential|bearer|auth)/i pattern as
  executor.ts SENSITIVE_PAYLOAD_KEY. Connector secret names (apiToken,
  clientSecret, pat, accessToken, refreshToken, bot_token, api_key,
  app_password) are now caught by both error-message redaction and
  persist deep-scrub.
- Original five exact keys (passphrase, recoverySeed, mnemonic,
  privateKey, encryptedVaultManifest) remain matched verbatim.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — G3: pino log redaction wrapper

**Files:**
- Create: `packages/gateway/src/logging/redacted-pino.ts`
- Create: `packages/gateway/src/logging/redacted-pino.test.ts`
- Modify: `packages/gateway/src/embedding/create-embedding-runtime.ts:48`
- Modify: `packages/gateway/src/platform/assemble.ts:244` (or wherever `createGatewayPinoLogger` is invoked)

- [ ] **Step 1: Find the existing pino logger factory**

```bash
grep -rn "createGatewayPinoLogger\|pino(" packages/gateway/src/ | head -10
```

If the factory lives at `packages/gateway/src/logging/pino.ts` or similar, the redacted variant lives next to it. If logger factory file path differs, adjust the new file path accordingly.

- [ ] **Step 2: Write the failing test**

Create `packages/gateway/src/logging/redacted-pino.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createRedactedGatewayPinoLogger } from "./redacted-pino.ts";

function captureLogs(): { writer: Writable; lines: string[] } {
  const lines: string[] = [];
  const writer = new Writable({
    write(chunk, _enc, cb): void {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { writer, lines };
}

describe("createRedactedGatewayPinoLogger (S2-F9)", () => {
  test("redacts authorization and token-shaped values in error chains", () => {
    const { writer, lines } = captureLogs();
    const logger = createRedactedGatewayPinoLogger(writer);
    const err = new Error("Invalid API key starting with sk-abc1234567890") as Error & {
      headers?: Record<string, string>;
    };
    err.headers = { Authorization: "Bearer top-secret-token" };
    logger.warn({ err }, "OpenAI embedder init failed");
    const blob = lines.join("");
    expect(blob.includes("Bearer top-secret-token")).toBe(false);
    expect(blob.includes("sk-abc1234567890")).toBe(false);
    // The bare label must remain so the operator sees what failed
    expect(blob.includes("OpenAI embedder init failed")).toBe(true);
  });
});
```

- [ ] **Step 3: Run failing test**

Run: `bun test packages/gateway/src/logging/redacted-pino.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the logger wrapper**

Create `packages/gateway/src/logging/redacted-pino.ts`:

```typescript
import pino, { type Logger, type StreamEntry } from "pino";
import type { Writable } from "node:stream";

const REDACT_PATHS = [
  "*.headers.authorization",
  "*.headers.Authorization",
  "*.config.headers.authorization",
  "*.config.headers.Authorization",
  "err.headers.authorization",
  "err.headers.Authorization",
  "err.config.headers.authorization",
  "err.config.headers.Authorization",
  "*.apiKey",
  "*.api_key",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "err.apiKey",
  "err.api_key",
  "err.token",
];

const VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /Bearer\s+[A-Za-z0-9._\-+/=]+/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{16,}/g,
  /xox[baprs]-[A-Za-z0-9-]{8,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
];

function scrubMessage(s: string): string {
  let out = s;
  for (const re of VALUE_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

export function createRedactedGatewayPinoLogger(stream: Writable | StreamEntry): Logger {
  return pino(
    {
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      formatters: {
        log(o: Record<string, unknown>): Record<string, unknown> {
          const out: Record<string, unknown> = { ...o };
          if (typeof out["msg"] === "string") {
            out["msg"] = scrubMessage(out["msg"]);
          }
          // Pino default err serializer puts message/name/stack here.
          const e = out["err"];
          if (e !== null && typeof e === "object") {
            const eObj = e as Record<string, unknown>;
            if (typeof eObj["message"] === "string") {
              eObj["message"] = scrubMessage(eObj["message"]);
            }
            if (typeof eObj["stack"] === "string") {
              eObj["stack"] = scrubMessage(eObj["stack"]);
            }
          }
          return out;
        },
      },
    },
    stream as Writable,
  );
}
```

If `pino` is not yet a direct dependency, check `package.json` (it should be — confirm via `grep -n '"pino"' packages/gateway/package.json`). If not present, add it.

- [ ] **Step 5: Wire the redacted logger at the gateway boot site**

Edit `packages/gateway/src/platform/assemble.ts`. Find the `createGatewayPinoLogger(paths.logDir)` call (around line 244). Replace with `createRedactedGatewayPinoLogger(...)` if the existing factory wraps a stream — preserve the destination behavior. If the existing factory has a different signature, retain its public API and apply the redact config inside it instead of replacing it. Document the choice in a comment.

Search and adjust the existing factory:

```bash
grep -rn "createGatewayPinoLogger" packages/gateway/src/ | head -10
```

- [ ] **Step 6: Update embedding-runtime to pass a sanitized error context**

Edit `packages/gateway/src/embedding/create-embedding-runtime.ts:48`. Replace:

```typescript
logger.warn({ err }, "OpenAI embedder init failed");
```

with:

```typescript
logger.warn(
  {
    errName: err instanceof Error ? err.name : "Error",
    errMessage: err instanceof Error ? err.message : String(err),
  },
  "OpenAI embedder init failed",
);
```

(Defense-in-depth: even when the redacted logger is wired, the embedding-runtime explicitly avoids passing the raw `err` object so the redactor's `paths` list does not need to enumerate every nested property the OpenAI SDK might inject.)

- [ ] **Step 7: Re-run tests**

Run: `bun test packages/gateway/src/logging/redacted-pino.test.ts packages/gateway/src/embedding/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/gateway/src/logging/redacted-pino.ts packages/gateway/src/logging/redacted-pino.test.ts packages/gateway/src/embedding/create-embedding-runtime.ts packages/gateway/src/platform/assemble.ts
git commit -m "$(cat <<'EOF'
fix(security): pino redaction config + sanitized embedding error log (G3 part 2/2)

Closes S2-F9.

- New createRedactedGatewayPinoLogger applies pino's redact paths
  (Authorization headers, *.token, *.apiKey nested keys) plus a
  message-level scrubber for known prefix patterns (Bearer, sk-, ghp_,
  xoxb-, AKIA, JWT).
- Embedding init no longer passes raw `err` to the logger; wraps in
  { errName, errMessage } so the OpenAI SDK's future verbose error
  formats cannot smuggle keys through nested fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — G4: SQL hygiene (verify.ts comment, person-store refactor, repair.ts guard)

**Files:**
- Modify: `packages/gateway/src/db/verify.ts:64-81`
- Modify: `packages/gateway/src/people/person-store.ts:243-292`
- Modify: `packages/gateway/src/db/repair.ts:140-163`
- Modify: `packages/gateway/src/db/repair.test.ts`
- Modify: `packages/gateway/src/people/person-store.test.ts` (if present; otherwise create)

- [ ] **Step 1: Document the FTS5 magic-write in verify.ts**

Edit `packages/gateway/src/db/verify.ts:64`. Replace:

```typescript
function checkFts5Consistency(db: Database): VerifyFinding {
  const label = "fts5_consistency";
  if (!tableExists(db, "item_fts")) {
```

with:

```typescript
/**
 * FTS5 integrity check (S5-F1):
 * The `INSERT INTO item_fts(item_fts) VALUES('integrity-check')` form is the
 * SQLite-FTS5 magic command that runs an integrity check; it is structurally
 * a write but operates as a read on the shadow tables. Therefore this function
 * REQUIRES a read-write `db` handle. Callers passing a `readonly: true` Database
 * will receive `SQLiteError: attempt to write a readonly database` here.
 */
function checkFts5Consistency(db: Database): VerifyFinding {
  const label = "fts5_consistency";
  if (!tableExists(db, "item_fts")) {
```

- [ ] **Step 2: Refactor `patchPerson` SQL builder (atomic per-call)**

Read `packages/gateway/src/people/person-store.ts:243-292` to inventory all `if (patch.X !== undefined)` branches. Each pushes a `sets.push("col = ?")` + `params.push(value)` pair. Replace the pattern with discrete `dbRun` calls **wrapped in a single `db.transaction`** so a multi-field patch remains atomic — preserving the original semantics while routing each `UPDATE` through the `dbRun` `SQLITE_FULL → DiskFullError` translation. Add the import if missing:

```typescript
import { dbRun } from "../db/write.ts";
```

Replace the existing `patchPerson` body:

```typescript
export function patchPerson(db: Database, id: string, patch: PersonPatch): void {
  // Wrap the discrete UPDATEs in a transaction so the multi-field patch
  // is atomic — matches the original sets.join() semantics and prevents
  // partial state if dbRun throws midway. Each dbRun still translates
  // SQLITE_FULL → DiskFullError (S5-F4 hygiene preserved).
  db.transaction(() => {
    if (patch.displayName !== undefined) {
      dbRun(db, `UPDATE person SET display_name = ? WHERE id = ?`, [patch.displayName, id]);
    }
    if (patch.canonicalEmail !== undefined) {
      dbRun(db, `UPDATE person SET canonical_email = ? WHERE id = ?`, [patch.canonicalEmail, id]);
    }
    // …repeat for every existing branch, preserving exact column-name mapping.
    if (patch.linked !== undefined) {
      dbRun(db, `UPDATE person SET linked = ? WHERE id = ?`, [patch.linked ? 1 : 0, id]);
    }
  })();
}
```

Reproduce **all** existing branches (display_name, canonical_email, github_login, gitlab_username, slack_user_id, jira_account_id, linear_user_id, notion_user_id, confluence_account_id, bitbucket_uuid, microsoft_user_id, discord_user_id, linked, plus any others present today). Open the file end-to-end first and migrate every branch — leave none using the legacy `sets.push` pattern.

- [ ] **Step 3: Add the null-byte guard to `repair.ts`**

Edit `packages/gateway/src/db/repair.ts:147` (just before the `escapeIdentifier` declaration in `repairForeignKeys`). Insert at the top of the loop body:

```typescript
db.transaction(() => {
  for (const [table, rowids] of byTable) {
    if (table.length === 0 || /\x00/.test(table)) {
      // S5-F6 — defense-in-depth: skip identifiers that SQLite would reject anyway.
      continue;
    }
    const BATCH = 999;
```

- [ ] **Step 4: Write/extend repair.ts tests for the guard**

Append to `packages/gateway/src/db/repair.test.ts`:

```typescript
test("S5-F6 — repairForeignKeys skips empty / null-byte table names", async () => {
  // Build a synthetic violations array passing through the same code path:
  //   the actual production trigger is `PRAGMA foreign_key_check`, which never
  //   produces these names. Test by exposing a private helper that takes the
  //   violations list directly, OR by stubbing PRAGMA via a hand-built
  //   in-memory DB. Choose whichever the existing test file already uses.
  // ... fill in following the existing test pattern in repair.test.ts ...
});
```

If the test pattern in `repair.test.ts` is purely PRAGMA-driven (no helper to inject violations), this test becomes a documentation-style assertion — read the file first and pick the closest pattern. Acceptable simplification: add a unit test on a helper extracted from the loop body if no clean injection point exists; otherwise mark the test `test.todo` with a comment pointing to S5-F6.

- [ ] **Step 5: Run all touched tests + coverage gate**

```bash
bun test packages/gateway/src/db/verify.test.ts packages/gateway/src/db/repair.test.ts packages/gateway/src/people/person-store.test.ts
bun run test:coverage:db
```

Expected: PASS at ≥85%. If `person-store.test.ts` does not exist, create one with a single test per branch verifying a single-field patch mutates the expected column.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/db/verify.ts packages/gateway/src/people/person-store.ts packages/gateway/src/people/person-store.test.ts packages/gateway/src/db/repair.ts packages/gateway/src/db/repair.test.ts
git commit -m "$(cat <<'EOF'
fix(security): SQL hygiene polish (G4)

Closes S5-F1, S5-F5, S5-F6.

- verify.ts checkFts5Consistency: documented FTS5 magic-write contract;
  callers must hold a read-write handle.
- person-store.ts patchPerson: replace sets.join() template-literal SQL
  with one dbRun() per field, eliminating the latent injection-pattern
  risk and routing every write through the SQLITE_FULL → DiskFullError
  wrapper.
- repair.ts repairForeignKeys: skip violation rows whose table identifier
  is empty or contains null bytes (defense-in-depth around escapeIdentifier).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — G5: LAN polish (handshake recordFailure + peer dedupe + lockout reply parity + pairing window timer)

**Files:**
- Modify: `packages/gateway/src/ipc/lan-server.ts`
- Modify: `packages/gateway/src/ipc/lan-server.test.ts`
- Modify: `packages/gateway/src/index/local-index.ts`
- Modify: `packages/gateway/src/index/local-index.test.ts`
- Modify: `packages/gateway/src/ipc/lan-pairing.ts`
- Modify: `packages/gateway/src/ipc/server.ts`
- Modify: `packages/gateway/src/ipc/server.test.ts`

- [ ] **Step 1: Locate `addLanPeer` and `getLanPeerByPubkey`**

```bash
grep -n "addLanPeer\|getLanPeerByPubkey\|peer_pubkey" packages/gateway/src/index/local-index.ts | head -20
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/gateway/src/index/local-index.test.ts`:

```typescript
test("S3-F5 — addLanPeer is idempotent on duplicate peer_pubkey", () => {
  const idx = createTempLocalIndex();
  const pub = new Uint8Array(32).fill(7);
  const id1 = idx.addLanPeer({ peerPubkey: pub, hostIp: "10.0.0.1" });
  // No throw; same pubkey returns same id.
  const id2 = idx.addLanPeer({ peerPubkey: pub, hostIp: "10.0.0.2" });
  expect(id2).toBe(id1);
  const fetched = idx.getLanPeerByPubkey(pub);
  expect(fetched?.host_ip).toBe("10.0.0.2");
});
```

(`createTempLocalIndex` is the existing test helper used elsewhere in `local-index.test.ts` — adapt to the file's convention.)

Append to `packages/gateway/src/ipc/lan-server.test.ts` (within an existing handshake `describe`):

```typescript
test("S3-F4 — hello with unknown pubkey records a rate-limit failure", async () => {
  // Build the existing test gateserver harness and send a hello with an
  // unknown pubkey. Verify rateLimit.recordFailure(ip) was called.
  // The exact harness function name is in lan-server.test.ts already
  // (`makeGateServer` per Medium PR review feedback).
});

test("S3-F6 — locked-out peer receives kind-aware err reply (hello_err for hello)", async () => {
  // Trigger 3 pair_err failures, then send a hello — assert the reply
  // is { kind: "hello_err" } (or socket.end silently). The point is the
  // reply must NOT be { kind: "pair_err" }.
});
```

Append to `packages/gateway/src/ipc/server.test.ts`:

```typescript
test("S3-F9 — lan.openPairingWindow returns expiresAt that matches PairingWindow.getExpiresAt", async () => {
  // Open the pairing window via IPC, fetch pw.getExpiresAt(), assert equality
  // (within 1ms tolerance for clock skew).
});
```

- [ ] **Step 3: Run failing tests**

```bash
bun test packages/gateway/src/index/local-index.test.ts packages/gateway/src/ipc/lan-server.test.ts packages/gateway/src/ipc/server.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `addLanPeer` ON CONFLICT upsert + getLanPeerByPubkey**

Locate the `addLanPeer` insertion in `local-index.ts:818-839` (per the spec). Replace the bare `INSERT INTO lan_peers ...` with:

```typescript
addLanPeer(input: { peerPubkey: Uint8Array; hostIp: string }): string {
  const peerId = derivePeerId(input.peerPubkey);
  const now = Date.now();
  dbRun(
    this.rawDb,
    `INSERT INTO lan_peers (peer_id, peer_pubkey, host_ip, paired_at, write_allowed)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(peer_pubkey) DO UPDATE SET
       host_ip = excluded.host_ip,
       paired_at = excluded.paired_at`,
    [peerId, Buffer.from(input.peerPubkey), input.hostIp, now],
  );
  return peerId;
}
```

If `derivePeerId` is not yet a helper, expose the existing pubkey-hash logic as a function. Read the file first and adapt.

If `getLanPeerByPubkey` does not exist, add it:

```typescript
getLanPeerByPubkey(pubkey: Uint8Array): { peer_id: string; host_ip: string; write_allowed: number } | null {
  const row = this.rawDb
    .query(`SELECT peer_id, host_ip, write_allowed FROM lan_peers WHERE peer_pubkey = ?`)
    .get(Buffer.from(pubkey)) as { peer_id: string; host_ip: string; write_allowed: number } | null;
  return row;
}
```

- [ ] **Step 5: Implement `recordFailure` on hello unknown-pubkey + kind-aware lockout reply**

Edit `packages/gateway/src/ipc/lan-server.ts`:

(a) In the lockout block at lines 157-161, branch on `msg.kind`:

```typescript
const ip = socket.data.peerIp;
if (!this.opts.rateLimit.checkAllowed(ip)) {
  this.writeFrame(
    socket,
    JSON.stringify({ kind: msg.kind === "hello" ? "hello_err" : "pair_err" }),
  );
  socket.end();
  return;
}
```

(b) In the `hello` handler at lines 192-197, when `match` is undefined, call `recordFailure`:

```typescript
// kind === "hello"
const match = this.opts.isKnownPeer(clientPubkey);
if (!match) {
  this.opts.rateLimit.recordFailure(socket.data.peerIp);
  this.writeFrame(socket, JSON.stringify({ kind: "hello_err" }));
  socket.end();
  return;
}
```

- [ ] **Step 6: Implement `pw.getExpiresAt()` and use it in server.ts**

Edit `packages/gateway/src/ipc/lan-pairing.ts`. Add (or expose if hidden):

```typescript
getExpiresAt(): number | null {
  return this.openedAt === null ? null : this.openedAt + this.windowMs;
}
```

(`openedAt` is whatever the existing class uses to track open time; if the field has a different name, adapt.)

Edit `packages/gateway/src/ipc/server.ts:507-514`:

```typescript
case "lan.openPairingWindow": {
  const pw = requireLanPairingWindow();
  const pairingCode = generatePairingCode();
  pw.open(pairingCode);
  const expiresAt = pw.getExpiresAt() ?? Date.now();
  return { pairingCode, expiresAt };
}
```

Drop the `lanPairingWindowMs` option lookup — the window's own timer is now the single source of truth. If callers pass `lanPairingWindowMs` to `createIpcServer`, it should be plumbed into the `PairingWindow` constructor instead. Search:

```bash
grep -rn "lanPairingWindowMs" packages/gateway/src/ | head
```

Update any constructor wiring so `PairingWindow` is built with the configured `windowMs` once.

- [ ] **Step 7: Re-run tests**

```bash
bun test packages/gateway/src/index/local-index.test.ts packages/gateway/src/ipc/lan-server.test.ts packages/gateway/src/ipc/server.test.ts
bun run test:coverage:lan
```

Expected: PASS, coverage ≥80%.

- [ ] **Step 8: Commit**

```bash
git add packages/gateway/src/ipc/lan-server.ts packages/gateway/src/ipc/lan-server.test.ts packages/gateway/src/index/local-index.ts packages/gateway/src/index/local-index.test.ts packages/gateway/src/ipc/lan-pairing.ts packages/gateway/src/ipc/server.ts packages/gateway/src/ipc/server.test.ts
git commit -m "$(cat <<'EOF'
fix(security): LAN polish — handshake recordFailure, peer dedupe, kind-aware lockout reply, pairing window timer alignment (G5)

Closes S3-F4, S3-F5, S3-F6, S3-F9.

- lan-server: hello with unknown pubkey now calls rateLimit.recordFailure
  (S3-F4) closing the per-IP DoS slot exhaustion window. Lockout reply
  is now kind-aware: `hello_err` for hello, `pair_err` for pair (S3-F6)
  removing the cross-kind side-channel.
- local-index: addLanPeer uses INSERT ... ON CONFLICT(peer_pubkey)
  DO UPDATE so a re-pair from a known peer no longer throws and silently
  drops the pair_ok reply (S3-F5).
- lan-pairing / server: lan.openPairingWindow now returns expiresAt
  derived from PairingWindow.getExpiresAt() — the same source the
  consume() check uses (S3-F9). The diverging lanPairingWindowMs option
  is plumbed into the window constructor instead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — G6: Updater polish (temp cleanup + URL scrubbing + timing-safe equal + semver validation)

**Files:**
- Modify: `packages/gateway/src/updater/updater.ts`
- Modify: `packages/gateway/src/updater/updater.test.ts`
- Modify: `packages/gateway/src/updater/manifest-fetcher.ts`
- Modify: `packages/gateway/src/updater/manifest-fetcher.test.ts`
- Modify: `docs/SECURITY.md`

- [ ] **Step 1: Write the failing tests**

Append to `packages/gateway/src/updater/updater.test.ts`:

```typescript
test("S6-F8 — temp directory is removed after successful applyUpdate", async () => {
  // Use the existing in-test fixture pattern. Capture the temp dir created
  // by writeToTempFile (refactor: writeToTempFile returns { dir, path }
  // and applyUpdate cleans up dir in finally).
});

test("S6-F8 — temp directory is removed when invokeInstaller throws", async () => {
  // applyUpdate path with an injected failing installer; assert dir
  // does not exist post-throw.
});

test("S6-F9 — getStatus.lastError strips URL userinfo", async () => {
  // Configure manifestUrl with userinfo (https://user:pass@cdn.example/...);
  // force a fetch failure; assert getStatus().lastError does not contain
  // the password or bare URL.
});

test("S6-F10 — SHA-256 hex compare uses constant-time equality", async () => {
  // Refactor target: extract sha256MatchesConstantTime(hexA, hexB) for
  // direct unit testing.
  const { sha256HexEqualConstantTime } = await import("./updater.ts");
  expect(sha256HexEqualConstantTime("00", "00")).toBe(true);
  expect(sha256HexEqualConstantTime("00", "01")).toBe(false);
  expect(sha256HexEqualConstantTime("00", "z0")).toBe(false); // invalid hex
});
```

Append to `packages/gateway/src/updater/manifest-fetcher.test.ts`:

```typescript
test("S6-F11 — validateManifest rejects malformed semver", async () => {
  // Build a minimal valid manifest then mutate version to "evil",
  // "../etc", "9999999999999999", and assert each is rejected with a
  // typed error.
});

test("S6-F11 — validateManifest rejects malformed pub_date", async () => {
  // mutate pub_date to "not-a-date" and assert rejection.
});
```

- [ ] **Step 2: Run failing tests**

```bash
bun test packages/gateway/src/updater/updater.test.ts packages/gateway/src/updater/manifest-fetcher.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement temp cleanup in updater.ts**

Read `packages/gateway/src/updater/updater.ts:109-126` (`applyUpdate`) and `:182-191` (`writeToTempFile`). Refactor `writeToTempFile` to return `{ dir, path }`:

```typescript
private writeToTempFile(buf: Uint8Array): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "nimbus-update-"));
  const path = join(dir, "installer.bin");
  writeFileSync(path, buf, { mode: 0o600 });
  try {
    chmodSync(path, 0o600); // belt + suspenders for filesystems that ignore the create-mode
  } catch {
    /* ignore */
  }
  return { dir, path };
}
```

Wrap the existing `applyUpdate` body that currently calls `writeToTempFile` and then `invokeInstaller(path)` with:

```typescript
const { dir, path } = this.writeToTempFile(buf);
try {
  await this.opts.invokeInstaller(path);
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}
```

(`rmSync` and `chmodSync` need imports from `node:fs`.)

- [ ] **Step 4: Implement URL scrubbing for `lastError`**

Add (or import) a `redactUrlUserinfo` helper. The scheme pattern includes digits, `+`, `-`, and `.` to match compound schemes (`git+https://`, `svn+ssh://`, `chrome-extension://`). The host pattern excludes `/` so the regex stops at the path component, preventing greedy matches across path-embedded `@` symbols (e.g. email addresses inside a path):

```typescript
function redactUrlUserinfo(message: string): string {
  // [a-zA-Z0-9+\-.]+://[^\s/]+@[^\s/]+
  // - Scheme covers compound forms (git+https, svn+ssh, etc.)
  // - Authority halts at the first `/` so URLs followed by paths
  //   containing `@` (mailto-like, query strings) are still bounded.
  return message.replace(/[a-zA-Z0-9+\-.]+:\/\/[^\s/]+@[^\s/]+/g, (urlMatch) => {
    try {
      const u = new URL(urlMatch);
      u.username = "";
      u.password = "";
      return u.toString();
    } catch {
      return "[REDACTED-URL]";
    }
  });
}
```

In `Updater.checkNow`'s catch block, replace:

```typescript
this.lastError = err.message;
```

with:

```typescript
this.lastError = redactUrlUserinfo(err instanceof Error ? err.message : String(err));
```

Apply the same pattern in `manifest-fetcher.ts` at the `ManifestFetchError` constructions (lines 80-95 per the spec) — wrap the URL with `redactUrlUserinfo` before inclusion.

- [ ] **Step 5: Implement constant-time SHA-256 hex equality**

Export a helper from `updater.ts` (or a local helper file if you prefer separation):

```typescript
import { timingSafeEqual } from "node:crypto";

export function sha256HexEqualConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length || a.length !== 64) return false;
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a, "hex");
    bufB = Buffer.from(b, "hex");
  } catch {
    return false;
  }
  if (bufA.length !== 32 || bufB.length !== 32) return false;
  return timingSafeEqual(bufA, bufB);
}
```

Replace the existing `computedSha !== asset.sha256` check (`updater.ts:94-100`) with `if (!sha256HexEqualConstantTime(computedSha, asset.sha256)) { … }`.

- [ ] **Step 6: Implement semver and pub_date validation**

In `manifest-fetcher.ts:36-71` (`validateManifest`), add format checks:

```typescript
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
```

Where the validator currently has:

```typescript
if (typeof version !== "string") throw new ManifestValidationError("missing or invalid version");
```

extend to:

```typescript
if (typeof version !== "string" || !SEMVER_RE.test(version)) {
  throw new ManifestValidationError("missing or invalid version (expected semver)");
}
```

Where `pub_date` is checked, add the ISO regex assertion the same way. (If `pub_date` is currently optional, keep optionality but enforce format-when-present.)

- [ ] **Step 7: Document the cleanup contract in SECURITY.md**

Open `docs/SECURITY.md`. Find the "Updater" section (or add one). Append:

```
### Updater temp directory cleanup

`Updater.applyUpdate` writes the installer to a temp directory created
by `mkdtempSync(join(tmpdir(), "nimbus-update-"))`. The directory and
its contents are deleted in a `finally` block after the platform
installer returns (success or failure). The installer binary is
written with mode `0o600` and is never readable by other users.
```

- [ ] **Step 8: Re-run tests + coverage**

```bash
bun test packages/gateway/src/updater/
bun run test:coverage:updater
```

Expected: PASS, coverage ≥80%.

- [ ] **Step 9: Commit**

```bash
git add packages/gateway/src/updater/ docs/SECURITY.md
git commit -m "$(cat <<'EOF'
fix(security): updater polish — temp cleanup, URL scrubbing, timing-safe equal, semver validation (G6)

Closes S6-F8, S6-F9, S6-F10, S6-F11.

- Updater.applyUpdate wraps installer invocation in try/finally with
  rmSync(dir, recursive). The installer binary is now written 0o600
  explicitly. SECURITY.md documents the cleanup contract.
- Updater.lastError and ManifestFetchError messages strip URL userinfo
  before storage / propagation.
- sha256HexEqualConstantTime replaces direct !== compare for asset
  hashes, using crypto.timingSafeEqual after length and hex-validity
  checks.
- validateManifest now enforces strict semver and ISO-8601 format on
  version and pub_date.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 — G7: Extension polish (timing-safe equal + ID length cap + signal child on disable)

**Files:**
- Modify: `packages/gateway/src/extensions/verify-extensions.ts`
- Modify: `packages/gateway/src/extensions/verify-extensions.test.ts`
- Modify: `packages/gateway/src/extensions/install-from-local.ts`
- Modify: `packages/gateway/src/extensions/install-from-local.test.ts`
- Modify: `packages/gateway/src/connectors/lazy-mesh.ts`
- Modify: `packages/gateway/src/connectors/lazy-mesh.test.ts`
- Modify: `packages/gateway/src/ipc/automation-rpc.ts:181-191`

- [ ] **Step 1: Write the failing tests**

Append to `packages/gateway/src/extensions/install-from-local.test.ts`:

```typescript
test("S7-F9 — assertSafeExtensionId rejects IDs longer than 128 chars", () => {
  // The exact import path for assertSafeExtensionId may vary; locate via:
  //   grep -n "export.*assertSafeExtensionId\|function assertSafeExtensionId" \
  //     packages/gateway/src/extensions/install-from-local.ts
  const { assertSafeExtensionId } = require("./install-from-local.ts") as {
    assertSafeExtensionId: (id: string) => void;
  };
  expect(() => assertSafeExtensionId("a".repeat(128))).not.toThrow();
  expect(() => assertSafeExtensionId("a".repeat(129))).toThrow(/too long/i);
});

test("S7-F8 — install-from-local hash compare uses crypto.timingSafeEqual", () => {
  // The compare site is install-from-local.ts:74. Refactor: extract
  // sha256HexEqualConstantTime helper (shared with updater) and unit-test it.
});
```

Append to `packages/gateway/src/extensions/verify-extensions.test.ts`:

```typescript
test("S7-F8 — verify-extensions uses crypto.timingSafeEqual for both hash compares", async () => {
  // Same as install-from-local — verify the helper is invoked.
});

test("S7-F10 — hash mismatch at startup signals running child via stopExtensionClient", async () => {
  // Build a fake LazyConnectorMesh with a recorded stopExtensionClient
  // method; tamper the on-disk entry file; run verifyExtensionsBestEffort;
  // assert mesh.stopExtensionClient was called with the extension id.
});
```

- [ ] **Step 2: Run failing tests**

```bash
bun test packages/gateway/src/extensions/
```

Expected: FAIL.

- [ ] **Step 3: Move `sha256HexEqualConstantTime` to a shared helper**

First, confirm no equivalent helper already exists. If one is found, prefer extending it over duplicating:

```bash
grep -rn "timingSafeEqual\|constantTimeEqual\|hexEqual" packages/gateway/src/ packages/sdk/src/ | grep -v "\.test\." | head
```

If a `crypto-utils` or similar module already exposes a constant-time helper, import from there instead of creating a new file. Otherwise create `packages/gateway/src/util/hex-compare.ts`:

```typescript
import { timingSafeEqual } from "node:crypto";

/** Constant-time hex string equality — returns false on length / format mismatch. */
export function sha256HexEqualConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length || a.length !== 64) return false;
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a, "hex");
    bufB = Buffer.from(b, "hex");
  } catch {
    return false;
  }
  if (bufA.length !== 32 || bufB.length !== 32) return false;
  return timingSafeEqual(bufA, bufB);
}
```

Refactor G6 (`updater.ts`) to import from `util/hex-compare.ts` and re-export the same name (preserving the public test surface). Update `verify-extensions.ts` and `install-from-local.ts` to import and use the helper for every hex `!==` compare.

After the migration, sweep the codebase for any remaining hex-compare patterns that should also use the helper:

```bash
grep -rn "sha256\|sha-256\|digest('hex')" packages/gateway/src/ packages/mcp-connectors/ \
  | grep -E "!==|===" | grep -v "\.test\." | head
```

For each match outside `util/hex-compare.ts`, either migrate to the helper or document why the comparison is non-security-sensitive (e.g. cache keys, diagnostic logs).

- [ ] **Step 4: Add the ID length cap**

Edit `packages/gateway/src/extensions/install-from-local.ts:41-55` (`assertSafeExtensionId`). Add at the top:

```typescript
if (extensionId.length === 0 || extensionId.length > 128) {
  throw new Error("extension id too long");
}
```

(If existing function already checks `length === 0` for emptiness, keep that and just append the length cap.)

- [ ] **Step 5: Implement `stopExtensionClient` on LazyConnectorMesh**

In `packages/gateway/src/connectors/lazy-mesh.ts`, add a public method:

```typescript
public async stopExtensionClient(extensionId: string): Promise<void> {
  // Extension-backed user MCPs are stored under the same `mesh:user:<id>`
  // slot pattern. The exact slot key depends on how the extension is
  // wired — read the existing `userMcpMeshKey` / extension wiring first.
  // For extensions registered via `connector.addMcp`, the slot key is
  // `userMcpMeshKey(serviceId)`. For first-party extension MCPs, the
  // slot key is the extension id directly. Cover both:
  await this.stopLazyClient(extensionId);
  await this.stopUserMcpClient(extensionId);
}
```

Read the actual extension-to-slot mapping in this file before finalising the implementation — the spec calls out `lazy-mesh.ts:148-176` and `:186-217` as the relevant regions. Adapt the public method to terminate exactly the slot(s) created when the extension is enabled.

- [ ] **Step 6: Wire `stopExtensionClient` from `verify-extensions` mismatch path and from `extension.disable` IPC**

In `verify-extensions.ts`, `verifyExtensionsBestEffort` already calls `setExtensionEnabled(db, row.id, false)` on mismatch. Pass an optional `mesh` parameter into the function and call `await mesh.stopExtensionClient(row.id)` after the DB flag flip. The function signature becomes (rough shape — adapt to existing types):

```typescript
export async function verifyExtensionsBestEffort(
  db: Database,
  opts: { extensionsDir: string; logger: Logger; mesh?: { stopExtensionClient: (id: string) => Promise<void> } },
): Promise<void> {
  // … existing logic …
  // on mismatch:
  setExtensionEnabled(db, row.id, false);
  if (opts.mesh !== undefined) {
    await opts.mesh.stopExtensionClient(row.id);
  }
}
```

Wire from the call site in `platform/assemble.ts` (or wherever `verifyExtensionsBestEffort` is invoked). Pass `mesh` if it is constructed at that point; otherwise wire it post-construction via a follow-up call.

In `packages/gateway/src/ipc/automation-rpc.ts:187-191`, change the disable branch to:

```typescript
case "extension.disable": {
  const id = requireString(rec, "id");
  const ok = setExtensionEnabled(db, id, false);
  if (ok && ctx.mesh !== undefined) {
    await ctx.mesh.stopExtensionClient(id);
  }
  return { kind: "hit", value: { ok } };
}
```

(`ctx.mesh` is the existing `LazyConnectorMesh` reference threaded through the dispatcher context. If the context type doesn't yet expose `mesh`, search `grep -n "AutomationRpcContext\|mesh" packages/gateway/src/ipc/automation-rpc.ts` and extend the type.)

- [ ] **Step 7: Document the subprocess-coverage limitation in SECURITY.md**

`stopExtensionClient` only terminates the immediate MCPClient child process. A malicious extension that spawned subprocesses (helper daemons, background watchers) leaves those running until they exit on their own. Document this gap explicitly so users do not assume `extension.disable` is a guaranteed kill-switch:

Open `docs/SECURITY.md`. Find the "Extensions" section (or the section closest to S7-F6's existing language about same-uid equivalence). Append:

```
### Extension disable does not orphan-kill subprocesses

When an extension's hash check fails or the user invokes
`extension.disable`, the gateway terminates the extension's immediate
MCP child process. Any further subprocesses that the extension itself
spawned (e.g. helper daemons started before disable) are NOT killed —
they continue running until they exit on their own. This is a known
limitation of `child_process.spawn` (no process-group kill on POSIX,
no Job Object wrapping on Windows) and aligns with the broader same-uid
sandbox model documented for extensions. Phase 7 sandbox work
(`bwrap` / `sandbox-exec` / `AppContainer`) closes this gap by binding
the extension's full descendant tree to a sandbox lifetime.
```

- [ ] **Step 8: Re-run tests + coverage**

```bash
bun test packages/gateway/src/extensions/ packages/gateway/src/connectors/lazy-mesh.test.ts
bun run test:coverage:extensions
```

Expected: PASS, ≥85%.

- [ ] **Step 9: Commit**

```bash
git add packages/gateway/src/util/ packages/gateway/src/updater/updater.ts packages/gateway/src/extensions/ packages/gateway/src/connectors/lazy-mesh.ts packages/gateway/src/connectors/lazy-mesh.test.ts packages/gateway/src/ipc/automation-rpc.ts packages/gateway/src/platform/assemble.ts docs/SECURITY.md
git commit -m "$(cat <<'EOF'
fix(security): extension polish — timing-safe equal, ID length cap, signal child on disable (G7)

Closes S7-F8, S7-F9, S7-F10.

- Extracted util/hex-compare.ts:sha256HexEqualConstantTime — shared by
  updater.ts, verify-extensions.ts, install-from-local.ts. All three
  now use crypto.timingSafeEqual after length + hex-validity checks.
- assertSafeExtensionId rejects IDs longer than 128 characters,
  preventing Windows MAX_PATH DoS.
- LazyConnectorMesh.stopExtensionClient terminates the running child
  process when an extension is disabled (via IPC) or when its hash
  fails verification at startup. Closes the gap where a tampered
  extension would continue executing until idle-disconnect.
- SECURITY.md notes that subprocesses spawned by the extension itself
  are NOT killed by `extension.disable` (Phase 7 sandbox concern).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12 — G8: MCP polish (UUID ids + args_json error logging)

**Files:**
- Modify: `packages/gateway/src/connectors/lazy-mesh.ts`
- Modify: `packages/gateway/src/connectors/lazy-mesh.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/gateway/src/connectors/lazy-mesh.test.ts`:

```typescript
test("S8-F8 — MCPClient ids are UUIDs, not Date.now() timestamps", async () => {
  // Capture the MCPClient construction args (existing test mocks MCPClient
  // — locate via: grep -n "MCPClient\|mockMcpClient" packages/gateway/src/connectors/lazy-mesh.test.ts)
  // Assert the captured `id` matches a UUIDv4 regex:
  //   /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  // and does not match /\d{13}$/ (the previous Date.now() pattern).
});

test("S8-F9 — malformed args_json transitions health to persistent_error", async () => {
  // Insert a user_mcp_connector row with args_json = "not-json".
  // Run ensureUserMcpConnectorsRunning. Assert getConnectorHealth(serviceId)
  // returns { state: 'persistent_error', error: matches /args_json/ }.
  // Assert no MCPClient was constructed.
});
```

- [ ] **Step 2: Run failing tests**

Run: `bun test packages/gateway/src/connectors/lazy-mesh.test.ts`
Expected: FAIL.

- [ ] **Step 3: Replace all `Date.now()` MCPClient ids with `randomUUID()`**

At the top of `packages/gateway/src/connectors/lazy-mesh.ts`, add:

```typescript
import { randomUUID } from "node:crypto";
```

Then replace every `${String(Date.now())}` inside an MCPClient `id: ` literal with `${randomUUID()}`. The spec lists 17 sites (lines 205, 436, 492, 522, 563, 606, 638, 678, 709, 749, 794, 834, 871, 912, 948, 979, 1015) — verify with:

```bash
grep -n "id:.*Date.now()" packages/gateway/src/connectors/lazy-mesh.ts
```

For each match, change:

```typescript
id: `nimbus-google-${String(Date.now())}`,
```

to:

```typescript
id: `nimbus-google-${randomUUID()}`,
```

Preserve the per-connector prefix (`nimbus-google-`, `nimbus-github-`, etc.) so log/telemetry filtering still works.

- [ ] **Step 4: Implement health transition on malformed `args_json`**

Edit `packages/gateway/src/connectors/lazy-mesh.ts:193-202` (`ensureUserMcpClient`). The current shape:

```typescript
let args: string[];
try {
  const parsed: unknown = JSON.parse(row.args_json);
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    return;
  }
  args = parsed;
} catch {
  return;
}
```

Replace both silent-return paths with explicit health transitions:

```typescript
let args: string[];
try {
  const parsed: unknown = JSON.parse(row.args_json);
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    this.deps.logger.warn(
      { serviceId: row.service_id },
      "user MCP args_json is not a string array",
    );
    transitionHealth(this.deps.db, row.service_id, {
      type: "persistent_error",
      error: "malformed args_json (expected string array)",
    });
    return;
  }
  args = parsed;
} catch {
  this.deps.logger.warn(
    { serviceId: row.service_id },
    "user MCP args_json failed to parse",
  );
  transitionHealth(this.deps.db, row.service_id, {
    type: "persistent_error",
    error: "malformed args_json (parse failed)",
  });
  return;
}
```

(`transitionHealth` and `this.deps.db` / `this.deps.logger` may live behind a different facade — verify with: `grep -n "transitionHealth\|this.deps\|this.opts" packages/gateway/src/connectors/lazy-mesh.ts | head -10`.)

- [ ] **Step 5: Re-run tests + coverage**

```bash
bun test packages/gateway/src/connectors/lazy-mesh.test.ts
bun run test:coverage:mcp
```

Expected: PASS, ≥70%.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/lazy-mesh.ts packages/gateway/src/connectors/lazy-mesh.test.ts
git commit -m "$(cat <<'EOF'
fix(security): MCP polish — UUID ids + observable args_json errors (G8)

Closes S8-F8, S8-F9.

- Replace 17 Date.now()-based MCPClient ids with crypto.randomUUID()
  to prevent same-millisecond aliasing in fast spawn sequences.
- ensureUserMcpClient: malformed args_json now logs a warn line and
  transitions connector health to persistent_error so the failure
  surfaces in `nimbus connector status` rather than silently leaving
  the slot unconfigured.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13 — G9: Tauri allowlist test sync + connector.startAuth alias

**Files:**
- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs`
- Modify: `packages/gateway/src/ipc/connector-rpc.ts`
- Modify: `packages/gateway/src/ipc/connector-rpc.test.ts`

The frontend calls `connector.startAuth` but the gateway only handles `connector.auth` (S4-F2). Two fixes — one minimal, one defense-in-depth:

(a) Gateway: alias `connector.startAuth` to `connector.auth` so the existing frontend caller succeeds.
(b) Tauri test: assert `index.querySql` is absent (S5-F7).

- [ ] **Step 1: Write the failing tests**

Append to `packages/gateway/src/ipc/connector-rpc.test.ts`:

```typescript
test("S4-F2 — connector.startAuth dispatches to the connector.auth handler", async () => {
  let authParams: unknown;
  const ctx = {
    connectors: {
      // Match the actual context shape used by dispatchConnectorRpc tests
    },
    onAuth: (params: unknown) => {
      authParams = params;
    },
  };
  // The exact harness setup is the same as the existing
  // "connector.auth" tests in this file. Search:
  //   grep -n "connector.auth" packages/gateway/src/ipc/connector-rpc.test.ts
  // and copy the pattern.
  // After dispatch, assert authParams was populated.
});
```

In `packages/ui/src-tauri/src/gateway_bridge.rs`, append a new test inside the existing `#[cfg(test)] mod tests { … }` block:

```rust
#[test]
fn allowlist_excludes_index_query_sql() {
    // S5-F7 — explicit guard against future allowlist drift.
    assert!(!is_method_allowed("index.querySql"));
    assert!(!is_method_allowed("vault.get"));
    assert!(!is_method_allowed("vault.set"));
    assert!(!is_method_allowed("vault.list"));
    assert!(!is_method_allowed("config.set"));
    assert!(!is_method_allowed("db.put"));
    assert!(!is_method_allowed("db.delete"));
    assert!(!is_method_allowed("index.rebuild"));
}
```

(If a similar test already exists, search via `grep -n "allowlist_rejects_vault" packages/ui/src-tauri/src/gateway_bridge.rs` and **add** the `index.querySql` line to it instead of duplicating.)

- [ ] **Step 2: Run failing tests**

```bash
bun test packages/gateway/src/ipc/connector-rpc.test.ts
cd packages/ui/src-tauri && cargo test --lib gateway_bridge::tests::allowlist
```

Expected: FAIL.

- [ ] **Step 3: Implement the deprecated alias**

Open `packages/gateway/src/ipc/connector-rpc.ts`. Locate the `connector.auth` case in `dispatchConnectorRpc` (search via `grep -n "connector.auth" packages/gateway/src/ipc/connector-rpc.ts`). Add a fall-through alias above it that emits a single warn log per session, with `@deprecated` JSDoc directing future maintainers to the canonical method:

```typescript
// Module-level once-flag so we warn at most once per gateway boot.
let warnedConnectorStartAuth = false;

// … inside dispatchConnectorRpc switch …

/**
 * @deprecated Use `connector.auth` instead. `connector.startAuth` is a
 * compatibility alias retained for the WS5 onboarding flow (`Connect.tsx`)
 * and will be removed once the frontend is migrated.
 */
case "connector.startAuth": {
  if (!warnedConnectorStartAuth) {
    warnedConnectorStartAuth = true;
    ctx.logger?.warn(
      "connector.startAuth is deprecated; use connector.auth (S4-F2 alias)",
    );
  }
  // fallthrough — biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional
}
case "connector.auth": {
  // … existing connector.auth body unchanged …
}
```

(The `ctx.logger?` access is permissive — match the actual logger plumbing in the file. If `ctx` is not the parameter name, search and substitute.)

- [ ] **Step 4: Add the index.querySql allowlist assertion**

Edit `packages/ui/src-tauri/src/gateway_bridge.rs`. Locate the existing `allowlist_rejects_vault_and_raw_db_writes` test. Add `assert!(!is_method_allowed("index.querySql"));` to it. If no such test exists with that exact name, locate the closest `#[test] fn allowlist_*` and add the assertion there.

- [ ] **Step 5: Re-run tests**

```bash
bun test packages/gateway/src/ipc/connector-rpc.test.ts
cd packages/ui/src-tauri && cargo test --lib
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/ipc/connector-rpc.ts packages/gateway/src/ipc/connector-rpc.test.ts packages/ui/src-tauri/src/gateway_bridge.rs
git commit -m "$(cat <<'EOF'
fix(security): connector.startAuth alias + Tauri allowlist test guard (G9)

Closes S4-F2, S5-F7.

- connector.startAuth now dispatches to the same handler as
  connector.auth, restoring the broken onboarding OAuth flow without
  reshuffling the Tauri allowlist.
- gateway_bridge.rs: allowlist regression test asserts index.querySql,
  vault.*, config.set, db.put, db.delete, index.rebuild are all absent.
  Catches future drift before it ships.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14 — Final verification & lint

- [ ] **Step 1: Type check**

```bash
bun run typecheck
```

Expected: zero errors. If a type error surfaces in a file unrelated to the changes, read the failing file and trace the type chain — most likely a `ReindexRpcOptions` (G1) or `dispatchVaultGated` (G2) call site that needs the new options object.

- [ ] **Step 2: Lint**

```bash
bun run lint
```

Expected: zero errors. Common Biome flags to watch for:
- `noNonNullAssertion` if any new code uses `!`. Replace with proper narrowing.
- `useImportType` on the new `ToolExecutor` type imports — change `import { ToolExecutor }` → `import type { ToolExecutor }` where appropriate.

- [ ] **Step 3: Run all touched coverage gates**

```bash
bun run test:coverage:engine
bun run test:coverage:vault
bun run test:coverage:db
bun run test:coverage:lan
bun run test:coverage:updater
bun run test:coverage:extensions
bun run test:coverage:mcp
```

Expected: every gate at or above its threshold (engine ≥85%, vault ≥90%, db ≥85%, lan ≥80%, updater ≥80%, extensions ≥85%, mcp ≥70%).

- [ ] **Step 4: Run UI vitest coverage**

```bash
cd packages/ui && bunx vitest run --coverage
```

Expected: ≥80% lines / ≥75% branches.

- [ ] **Step 5: Full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 6: Run the CI parity suite (per saved feedback memory)**

```bash
bun run test:ci
```

Expected: green — mirrors `pr-quality` GitHub Actions job. Per `feedback_preflight_before_pr.md`, do not push the PR until this passes locally.

- [ ] **Step 7: Run Rust-side tests**

```bash
cd packages/ui/src-tauri && cargo test --lib
```

Expected: all tests pass.

---

## Task 15 — Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin dev/asafgolombek/security-fixes-low
```

- [ ] **Step 2: Create the PR**

```bash
gh pr create --title "fix(security): Low-tier security findings (PR 3 of 3)" --body "$(cat <<'EOF'
## Summary

Closes the remaining Low-severity findings from `docs/superpowers/specs/2026-04-25-security-audit-results.md`. Follows the High PR (`#112`, merged 2026-04-26) and the Medium PR (`#113`, merged 2026-04-26). Final tier of the 3-PR security cleanup.

Each commit group targets one root cause (see `docs/superpowers/plans/2026-04-26-security-fixes-low-tier.md`):

- **G1** — full-depth `connector.reindex` HITL gate + frozen-facade `add()` guard (S1-F7, S1-F8)
- **G2** — vault hardening: key-format `/i` removal, DPAPI optional entropy, `vault.set/delete` HITL gate, KDF param allowlist on import (S2-F4, S2-F7, S2-F8, S2-F10)
- **G3** — frontend redaction unification + pino redact config (S2-F6, S2-F9)
- **G4** — SQL hygiene: `verify.ts` doc fix, `person-store.ts` SQL refactor, `repair.ts` identifier guard (S5-F1, S5-F5, S5-F6)
- **G5** — LAN polish: handshake `recordFailure`, peer dedupe, kind-aware lockout reply, pairing window timer alignment (S3-F4, S3-F5, S3-F6, S3-F9)
- **G6** — updater polish: temp cleanup, URL scrubbing, timing-safe equal, semver validation (S6-F8, S6-F9, S6-F10, S6-F11)
- **G7** — extension polish: shared timing-safe hex compare, ID length cap, signal child on disable (S7-F8, S7-F9, S7-F10)
- **G8** — MCP polish: UUID ids + observable `args_json` errors (S8-F8, S8-F9)
- **G9** — `connector.startAuth` deprecated alias (one-shot warn log, `@deprecated` JSDoc) + Tauri allowlist test guards (S4-F2, S5-F7)

## Findings deferred (documented in the plan)

- S3-F8 — forward secrecy → multi-PR architectural change (Phase 7 LAN hardening)
- S4-F6, S4-F8 — Tauri-native dialog rebuild (UI-rebuild PR)
- S5-F4 — 79 `db.run()` call-site refactor (separate PR)
- S6-F1 — informational; updater is dormant
- S8-F10 — out of Phase 4 scope per spec

## Test plan

- [x] `bun run test:ci`
- [x] Each affected coverage gate at or above its threshold
- [x] `cargo test --lib` in `packages/ui/src-tauri`
- [ ] Manual smoke: enable LAN, attempt re-pair from a known peer, observe pair_ok (no UNIQUE constraint throw)
- [ ] Manual smoke (Windows VM): set vault entry, confirm `<configDir>/vault/.entropy` is created and read on next boot; confirm a legacy entry without entropy is migrated on first read
- [ ] Manual smoke: `nimbus connector reindex github --depth full` triggers a HITL prompt; `--depth metadata_only` does not

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-review notes

- **Cross-PR consistency.** This PR depends on the High PR's `ToolExecutor.gate()` extraction (`1758230`). All new gating sites use the same per-client `bindConsentChannel` pattern. If a follow-up refactor renames `gate()` again, every group except G3 / G6 / G9 needs its dispatcher updated.
- **DPAPI migration safety.** G2's entropy migration is read-only on existing vault entries until the next `set()` for that key. Users rotating credentials will silently upgrade; users with long-lived static PATs only upgrade on rotation. Acceptable — the security goal is "no plaintext readable by other same-uid processes," and the legacy-fallback path is constant-time-bounded.
- **G4 person-store.ts refactor side-effect.** The new `dbRun` calls write each field independently in separate transactions. Callers expecting atomic multi-field patches need to wrap their `patchPerson` call in `db.transaction(() => …)`. Audit existing callers via `grep -rn "patchPerson(" packages/gateway/src/`. If a caller batches multiple field updates, wrap there or extract a `patchPersonAtomic` variant.
- **G6 envelope.** The High/Medium PRs already added the manifest envelope; G6 only polishes the four remaining items (cleanup, URL scrub, constant-time, semver).
- **G7 stopExtensionClient slot key mapping.** The spec describes both extension-backed MCPs and user MCPs (`connector.addMcp`) as living under different slot keys. Read the actual mesh wiring before finalising the public method — if extension MCPs route through a separate `extension:<id>` slot, the implementation needs to terminate that exact key.
- **G7 stopExtensionClient subprocess coverage (documented limitation).** `stopExtensionClient` terminates the immediate MCPClient child only. If a malicious extension `spawn()`s further subprocesses (background watchers, helper daemons), those subprocesses are NOT killed by this method. Achieving full subprocess termination requires platform-specific machinery — POSIX `process.kill(-pid)` on a process group, Windows Job Objects via `CREATE_BREAKAWAY_FROM_JOB` plus `AssignProcessToJobObject` — neither of which `child_process.spawn` exposes natively. This is the same gap S7-F6 documents for the broader sandbox roadmap; G7 closes the entry-process detection-and-disable hole, and Phase 7 sandbox work closes the subprocess-orphaning hole. Out of scope for this PR; document the limitation in `docs/SECURITY.md` as part of G7's existing `docs/SECURITY.md` extension touch.
- **G3 pino redaction.** The redact config covers the most common third-party SDK shapes (Authorization headers, nested config.headers, common token field names). Adding a new third-party SDK in a future commit may need new `paths` entries — the message-level scrubber catches the fallback. If a future SDK error shape is exotic, extend `REDACT_PATHS` or add a new `VALUE_PATTERNS` regex.
- **Skipped findings.** Each entry in the deferred table has a one-line rationale. None represent open exploitable surfaces. Forward secrecy (S3-F8) is the largest deferred item and warrants its own design spec before implementation.
