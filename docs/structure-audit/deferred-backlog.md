# B3 Structure Audit — Phase 2 Deferred Backlog

**Generated at commit:** `98d21bd0ea45c70904cdd41a566c4db9f4e527ca`
**Date:** 2026-05-01
**Companion:** [`missed.md`](./missed.md) (ranked findings; top-5 fix plans)

This file collects every audit finding that did NOT make the top-5 cut —
either because its `engineering_cost_estimate` is ≥ 3 (auto-deferred per
spec § 5.3) or because it was lower-priority than the 5 chosen fixes. Each
entry carries a `Confidence` field (mirrors B1/B2) and a one-line "why
deferred" reason.

The user picks which deferred entries (if any) get promoted into a
`2026-??-??-refactor-<name>-design.md` follow-up; B3 itself does not write
those specs eagerly.

---

## D4 — large files (split candidates)

All cost ≥ 3 (multi-day refactor each — spec § 5.2 auto-defers any 800+ LOC
file). Each row is a single `Refactor candidate` requiring its own design
spec; churn (90d) is `commits90d` from `file-loc.json` and gates p80
prioritisation.

| File | LOC | Churn (90d) | Why deferred | Confidence |
|---|---|---|---|---|
| `packages/gateway/src/connectors/lazy-mesh.ts` | 1401 | 37 (p80+) | Refactor candidate: split MCP-spawn-config from server-record state machine — by-concern preserves single export surface; own design spec | High |
| `packages/gateway/src/ipc/server.ts` | 1239 | 56 (p80+) | Refactor candidate: extract per-namespace handler registries; dispatcher stays thin — own design spec | High |
| `packages/cli/src/commands/connector.ts` | 1238 | 32 (p80+) | Refactor candidate: split per-subcommand modules under `cli/commands/connector/` — own design spec | High |
| `packages/gateway/src/ipc/connector-rpc-handlers.ts` | 1103 | 30 (p80+) | Refactor candidate: split by namespace (status / config / oauth / removal) — own design spec | High |
| `packages/gateway/src/index/local-index.ts` | 987 | 45 (p80+) | Refactor candidate: extract write/read/migration concerns into sibling modules — own design spec | High |
| `packages/gateway/src/auth/pkce.ts` | 886 | 12 (p80+) | Refactor candidate: split by OAuth provider flow (Google / Microsoft / generic core) — own design spec | High |

---

## D11 — vault-key Bucket B Cost-1 (deferred via audit-dilution)

15 sites across 14 files where the canonical reader pattern (`vault.read(VAULT_KEY)`)
is mechanically cost-1 to allow-list. The triager's recommendation is to defer
rather than ignore: each new connector landing in the future would otherwise
have to bump `VAULT_KEY_ALLOW_LIST`, diluting the audit signal. The intended
follow-up is to introduce a `readConnectorSecret(serviceId)` helper that the
allow-list can target by name (one entry, structurally), then route all 15
sites through it.

| Description | Sites | Files | Why deferred | Confidence |
|---|---|---|---|---|
| Bucket B canonical-reader sites in production code | 15 | 14 | Refactor candidate: introduce `readConnectorSecret(serviceId)` helper in `connector-vault.ts`; route 15 canonical-reader sites through it; cost ~3 (helper + 14 caller updates + tests). Defer over individual allow-list bumps to avoid diluting the D11 audit signal as new connectors land. | Medium |

Affected files (1 site each unless noted):

- `packages/gateway/src/auth/notion-access-token.ts`
- `packages/gateway/src/auth/slack-access-token.ts`
- `packages/gateway/src/auth/oauth-vault-tokens.ts` (2 sites — Microsoft canonical reader)
- `packages/gateway/src/platform/assemble.ts`
- `packages/gateway/src/embedding/create-embedding-runtime.ts`
- `packages/gateway/src/testing/bun-test-support.ts`
- `packages/gateway/src/connectors/datadog-sync.ts`
- `packages/gateway/src/connectors/github-actions-sync.ts`
- `packages/gateway/src/connectors/github-sync.ts`
- `packages/gateway/src/connectors/gitlab-sync.ts`
- `packages/gateway/src/connectors/linear-sync.ts`
- `packages/gateway/src/connectors/newrelic-sync.ts`
- `packages/gateway/src/connectors/notion-sync.ts`
- `packages/gateway/src/connectors/slack-sync.ts`

---

## D11 — vault-key centralization (Bucket C)

Sites in hot-path files where the fix shape is "route through `connector-vault.ts`
helpers" requiring multi-file coordinated change. Cost ≥ 3 (auto-defer per
spec § 5.3).

| File | Site count | Lines | Why deferred | Confidence |
|---|---|---|---|---|
| `packages/gateway/src/connectors/lazy-mesh.ts` | 12 | 488, 502, 674, 710, 820, 895, 1231, 1234, 1235, 1237, 1238, 1240 | Refactor candidate: route lazy-mesh vault-key reads through `readConnectorSecret(serviceId)` helper in `connector-vault.ts`; coordinated with the Bucket-B helper introduction above. | Medium |
| `packages/gateway/src/ipc/connector-rpc-handlers.ts` | 9 | 365, 401, 510, 529, 551, 809, 837, 1020, 1022 | Refactor candidate: route writes through `writeConnectorSecret(serviceId, value)` and `sharedOAuthKey(provider)` helpers; the lines 1020/1022 sharedKey-switch is tightly coupled with 510-551 / 809-837 per-service writers, so the refactor must move together. | Medium |

---

## D6 — duplication blocks (cost-≥3 candidates)

Only the cross-MCP-connector block clears the cost-≥3 bar. The 9-connector
`decodeCursor` prelude (~106 tokens, cost-2) is tracked-but-not-scheduled in
[`missed.md`](./missed.md) — it isn't deferred, just below the top-5 cutoff.

| Block | Files | Tokens | Why deferred | Confidence |
|---|---|---|---|---|
| C6 | `packages/mcp-connectors/{aws,azure,gcp}/src/server.ts` | ~54 (conservative) | Refactor candidate: generic MCP-server-runner abstraction; cost ≥ 3, wide blast radius across all MCP connectors (touches startup, transport, error mapping). | Medium |

---

## D7 — unused exports / orphan files (long tail)

Bulk buckets — each is a multi-file cleanup project worth its own focus
session, not gated by CI. Numbered for cross-reference from `missed.md`.

| ID | Bucket | Approx count | Why deferred | Confidence |
|---|---|---|---|---|
| D7-defer-1 | Prune `packages/gateway/src/perf/index.ts` module barrel | ~70 surface symbols (147-line orphan barrel) | Refactor candidate: prune perf module barrel after the bench harness stabilises; cost 2 (delete + verify CI scripts/imports). Low-priority. | Medium |
| D7-defer-2 | Wire-or-remove `packages/gateway/src/db/health.ts` | 184 LOC, 0 in-source callers | Refactor candidate: `startDiskMonitor` is listed in CLAUDE.md as a key file but has no callers. Either wire it into Gateway startup or remove it and update CLAUDE.md. Cost 3, medium-priority — security-adjacent (disk-full behavior). | Medium |
| D7-defer-3 | Prune `packages/gateway/src/connectors/registry.ts` re-exports | 5 unused | Refactor candidate: tighten registry re-export surface; cost 2. Low-priority. | Medium |
| D7-defer-4 | Prune `packages/gateway/src/config/nimbus-toml.ts` exports | 11 unused (largest single-file hotspot) | Refactor candidate: tighten config public surface; cost 2. Low-priority. | Medium |
| D7-defer-5 | Prune `packages/gateway/src/db/{write,snapshot}.ts` exports | 9 unused total | Refactor candidate: tighten db write/snapshot public surface; cost 2. Low-priority. | Medium |
| D7-defer-6 | Prune UI `packages/ui/src/ipc/{types,client}.ts` re-exports | 4 unused | Refactor candidate: tighten UI ipc/store public surface; cost 2. Low-priority. | Medium |
| D7-defer-7 | Remove declared-but-unused `@nimbus-dev/sdk` dep across MCP connectors | 28 packages | Refactor candidate: `bun remove @nimbus-dev/sdk` in each `packages/mcp-connectors/*/package.json`; cost 2 (mechanical, lockfile churn). Low-priority. | High |
| D7-defer-8 | Remove declared-but-unused UI deps from `packages/ui/package.json` | 5 deps (`@radix-ui/react-{dialog,slot,tooltip}`, `@tauri-apps/plugin-{global-shortcut,shell}`) | Refactor candidate: remove unused UI deps; cost 1. **Verify Tauri runtime plugin loading first** — the two `@tauri-apps/plugin-*` may be loaded via Tauri capabilities even without TS imports. Low-priority. | Low |
| D7-defer-9 | Remove declared-but-unused `ink-text-input` from `packages/cli/package.json` | 1 dep | Refactor candidate: `bun remove ink-text-input`; cost 1. Low-priority. | High |
| D7-defer-10 | Bulk reference for trend tracking | 39 files / 77 unused exports | Aggregate D7 surface area for next audit; full per-bucket breakdown in `missed.md`'s per-dimension table. No single fix plan — clean up opportunistically when touching the file. | Low |

---

## D9 — risky type assertions

Single rolled-up entry. The script's output (`risky-assertions.json`) is the
long list.

| Description | Sites | Why deferred | Confidence |
|---|---|---|---|
| Type-safety debt: `as <Type>` casts outside tests, excluding `as const` / `as unknown` | 399 | Refactor candidate: type-safety hardening is its own sub-project — would need a heuristic ranking (e.g., `as unknown as T` worse than `as BaseType`) the B3 spec deliberately avoids (§ 3.3 D9). See [`risky-assertions.json`](./risky-assertions.json) for the full list. | Low |

---

## D12 — `db.run()` outside `db/write.ts`

Single rolled-up entry. The 94 sites are the precursor census for the
typed-`dbRun` migration already on the roadmap as **S5-F4**. B3 does
not execute the migration; the census drives the future design spec.

| Description | Sites | Why deferred | Confidence |
|---|---|---|---|
| Untyped `db.run()` calls outside the central wrapper | 94 — see [`db-run-census.json`](./db-run-census.json) | Refactor candidate: S5-F4 typed `dbRun` migration (existing roadmap row); B3 only produces the census. | High |

---

## Long-tail (low priority)

Aggregate references for entries already itemised above; this section exists
so a reviewer scanning for "what didn't get a row of its own?" finds an
explicit answer.

| Source | Count | Why deferred | Confidence |
|---|---|---|---|
| D7 long-tail rollup (see D7-defer-10 above) | 39 files / 77 unused exports | Low-impact, cost-1 each but no aggregation benefit; clean up opportunistically. | Low |
| D11 Bucket B sites (see Bucket B section above) | 15 sites / 14 files | Low-impact each; aggregated into the `readConnectorSecret` refactor candidate to preserve audit-signal quality. | Medium |
