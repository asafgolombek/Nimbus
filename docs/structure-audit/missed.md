# B3 Structure Audit — Phase 2 Missed Findings

**Generated at commit:** `4cc006544d7da49fd359f550e32e17a4c6dba82a`
**Date:** 2026-05-01
**Phase 2 of:** [`docs/superpowers/specs/2026-04-30-structure-audit-design.md`](../superpowers/specs/2026-04-30-structure-audit-design.md)
**Baseline:** [`docs/structure-audit/baseline.md`](./baseline.md)

This file ranks every Phase 2 threshold violation against the Phase 1 baseline,
ordered by `structural_impact_score / engineering_cost_estimate` (design spec § 5).
The top 5 ≤ 1-engineer-day fixes are named explicitly and grouped by subsystem
into fix plans (one PR per plan). Findings exceeding 1 engineer-day route
automatically to [`deferred-backlog.md`](./deferred-backlog.md) with a
`Refactor candidate` note.

Confidence column mirrors B1/B2: **High** = tool-detected with no judgement;
**Medium** = small judgement call (e.g. orphan removal grep verification);
**Low** = qualitative / requires reviewer interpretation.

---

## Top 5 fixes (cost ≤ 2)

Three distinct subsystem groups produced cost-≤-2 candidates this phase, so the
top-5 collapses to **3 fix plans**, not the 1–2 hinted at in design spec § 5.4.
Slots 4 and 5 are intentionally unused — no other dimension produced a
cost-≤-2 candidate. The 3-plan layout is the smaller blast radius: one plan
per dimension keeps each PR's scope auditable.

| Slot | Group | Score | Confidence | Fix plan |
|---|---|---|---|---|
| 1 | D10 — sync-connector spawns (5 sites) | 5/1 = **5.0** | High | [`2026-05-01-structure-fixes-d10-sync-connector-spawn.md`](../superpowers/plans/2026-05-01-structure-fixes-d10-sync-connector-spawn.md) |
| 2 | D11 Bucket A — comment-based opt-out (20 false-positive sites) | 5/1 = **5.0** | High | [`2026-05-01-structure-fixes-d11-bucket-a-fp-suppression.md`](../superpowers/plans/2026-05-01-structure-fixes-d11-bucket-a-fp-suppression.md) |
| 3 | D7 Bucket A — 6-file orphan deletion | 1/1 = **1.0** | Medium | [`2026-05-01-structure-fixes-d7-orphan-deletion.md`](../superpowers/plans/2026-05-01-structure-fixes-d7-orphan-deletion.md) |
| 4 | _(unused — no cost-≤-2 candidate available)_ | — | — | — |
| 5 | _(unused — no cost-≤-2 candidate available)_ | — | — | — |

### Slot 1 — D10: sync-connector spawn env scoping

5 sites under `packages/gateway/src/connectors/` spawn child processes without
routing the env through `extensionProcessEnv()` (security invariant I1). Single
fix plan replaces each spawn site (or its env-builder helper) with the canonical
helper.

| # | File | Line | Fix shape | Brief |
|---|---|---|---|---|
| 1 | `packages/gateway/src/connectors/aws-sync.ts` | 69 | helper refactor | `awsProcessEnv()` at line 45 currently builds env via `{ ...process.env }`; replace with `extensionProcessEnv({ AWS_*: ... })`. The spawn site at line 69 then inherits the fix automatically. |
| 2 | `packages/gateway/src/connectors/azure-sync.ts` | 41 | direct site fix | Env literal at lines 35-40 → `extensionProcessEnv({ AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET })`. |
| 3 | `packages/gateway/src/connectors/gcp-sync.ts` | 37 | direct site fix | Env literal at lines 33-36 → `extensionProcessEnv({ GOOGLE_APPLICATION_CREDENTIALS: credPath })`. |
| 4 | `packages/gateway/src/connectors/kubernetes-sync.ts` | 111 | direct site fix | Env at line 112 is `{ ...process.env, KUBECONFIG }` → `extensionProcessEnv({ KUBECONFIG: kubeconfig })`. |
| 5 | `packages/gateway/src/connectors/filesystem-v2-sync.ts` | 69 | additive | Spawn site at line 79 has **no `env` field** → add `env: extensionProcessEnv({})`. |

Impact 5 (security-invariant I1 wired incorrectly), cost 1 (single-file each, narrow change). Score **5.0**, confidence **High** (tool-detected by `audit:invariants`).

### Slot 2 — D11 Bucket A: comment-based false-positive suppression

20 of the 56 D11 violations are false positives: JSDoc references, manifest
entries enumerating canonical key names, log-redaction key arrays, and one
runtime `endsWith(".oauth")` check. Single fix plan adds a per-line
`// audit-ignore-next-line D11-vault-key (reason)` comment at each site and a
~1-line change to `check-nimbus-invariants.ts` to honour the directive.

Files affected (FP-site count):

| File | FP sites | Lines |
|---|---|---|
| `packages/gateway/src/connectors/lazy-mesh.ts` | 7 | 567, 622, 665, 701, 775, 811, 886 (JSDoc references) |
| `packages/gateway/src/connectors/connector-secrets-manifest.ts` | 7 | 14, 15, 17, 19, 21, 34, 35 (manifest entries) |
| `packages/gateway/src/platform/gateway-log-file.ts` | 2 | 73, 74 (log-redaction keys) |
| `packages/gateway/src/connectors/registry.ts` | 1 | 17 (JSDoc) |
| `packages/gateway/src/auth/oauth-vault-tokens.ts` | 1 | 109 (JSDoc) |
| `packages/mcp-connectors/outlook/src/server.ts` | 1 | 5 (JSDoc) |
| `packages/gateway/src/commands/data-import.ts` | 1 | 96 (`endsWith(".oauth")` runtime check) |

Impact 5 (CI gate gives spurious failures, drowns real signal), cost 1
(comment + script tweak). Score **5.0**, confidence **High**.

### Slot 3 — D7 Bucket A: 6-file orphan deletion

Six fully-orphaned files (zero importers across the entire repo, Grep-verified)
totalling 114 lines. All are barrel/index files or one-off helpers that lost
their last caller during Phase 3.5 / Phase 4 churn.

| # | File | LoC |
|---|---|---|
| 1 | `packages/gateway/src/auth/index.ts` | 13 |
| 2 | `packages/gateway/src/extensions/index.ts` | 23 |
| 3 | `packages/gateway/src/index/index.ts` | 14 |
| 4 | `packages/gateway/src/sync/index.ts` | 19 |
| 5 | `packages/cli/src/lib/repo-root.ts` | 23 (`getRepoRoot()` never invoked) |
| 6 | `packages/ui/src/components/Skeleton.tsx` | 22 |

Impact 1 (internal helpers, low traffic, no public API exposure), cost 1
(plain `git rm`). Score **1.0**, confidence **Medium** — knip flagged the
files, manual Grep across the repo confirmed zero importers.

---

## Per-dimension findings (full list)

Findings exceeding 1 engineer-day (cost ≥ 3) auto-route to
[`deferred-backlog.md`](./deferred-backlog.md). Cost-≤-2 findings outside the
top 5 also route to the backlog when they don't displace a higher-scoring
entry.

| Dim | Finding | Impact | Cost | Score | Confidence | Disposition |
|---|---|---|---|---|---|---|
| D4 | `packages/gateway/src/connectors/lazy-mesh.ts` (1401 LoC, 37 commits/90d, p80+) | 4 | 4 | 1.0 | High | Deferred — `Refactor candidate: split MCP-spawn-config from server-record state machine (by-concern, single export surface preserved)` |
| D4 | `packages/gateway/src/ipc/server.ts` (1239 LoC, 56 commits/90d, p80+) | 4 | 4 | 1.0 | High | Deferred — `Refactor candidate: extract per-namespace handler registries (dispatcher stays thin)` |
| D4 | `packages/cli/src/commands/connector.ts` (1238 LoC, 32 commits/90d, p80+) | 4 | 4 | 1.0 | High | Deferred — `Refactor candidate: split per-subcommand modules under cli/commands/connector/` |
| D4 | `packages/gateway/src/ipc/connector-rpc-handlers.ts` (1103 LoC, 30 commits/90d, p80+) | 4 | 4 | 1.0 | High | Deferred — `Refactor candidate: split by namespace (status / config / oauth / removal)` |
| D4 | `packages/gateway/src/index/local-index.ts` (987 LoC, 45 commits/90d, p80+) | 4 | 4 | 1.0 | High | Deferred — `Refactor candidate: extract write/read/migration concerns into sibling modules` |
| D4 | `packages/gateway/src/auth/pkce.ts` (886 LoC, 12 commits/90d, p80+) | 4 | 3 | 1.33 | High | Deferred — `Refactor candidate: split by OAuth provider flow (Google / Microsoft / generic PKCE core)` |
| D6 | C1 — 9 connector files share an 8-statement `decodeCursor` prelude (~106 tokens): pagerduty, slack, circleci, github-actions, github, gitlab, jenkins, jira, linear `-sync.ts` | 4 | 2 | 2.0 | High | Deferred (tracked, not scheduled) — does not displace top-5; extract shared helper + 9 caller updates |
| D6 | C6 — 3 mcp-connectors share MCP-server bootstrap epilogue | 3 | 3 | 1.0 | Medium | Deferred — `Refactor candidate: shared bootstrap helper in @nimbus-dev/sdk` |
| D6 | Global duplication — 3.62% overall (`jscpd-report.json` `statistics.total.percentage`) | 2 | 5 | 0.4 | High | Informational — under 5% target; trend monitored via CI artifact |
| D7 | Bucket A — 6-file orphan deletion (114 LoC total) | 1 | 1 | 1.0 | Medium | **Top-5 slot 3** |
| D7 | Bucket B — 39 files / 77 unused exports (bulk reference; full breakdown in deferred-backlog) | 2 | 4 | 0.5 | Medium | Deferred — bulk knip findings; per-file judgement required |
| D7 | `packages/gateway/src/db/health.ts` — 184 lines, listed in CLAUDE.md, zero callers | 3 | 2 | 1.5 | Medium | Deferred — wire-or-remove decision needed (impacts CLAUDE.md) |
| D7 | gateway/perf module barrel — 147-line orphan | 2 | 2 | 1.0 | Medium | Deferred — prune barrel |
| D7 | Unused exports in `connectors/registry.ts` (5), `config/nimbus-toml.ts` (11), `db/write.ts`+`db/snapshot.ts` (9), UI `ipc/types.ts` (4) | 2 | 2 | 1.0 | Medium | Deferred — per-file judgement |
| D7 | 28× declared-but-unused `@nimbus-dev/sdk` dep across `packages/mcp-connectors/*/package.json` | 2 | 2 | 1.0 | Medium | Deferred — package.json clean-up |
| D7 | 5× UI deps unused (radix-ui ×3, tauri plugin-global-shortcut, plugin-shell) | 2 | 2 | 1.0 | Medium | Deferred — verify before removal (radix may be transitive) |
| D7 | 1× cli `ink-text-input` unused | 1 | 1 | 1.0 | Medium | Deferred — bundled with bulk dep clean-up |
| D9 | 399 risky `as <Type>` sites (informational only, design spec § 6.3) | 3 | 5 | 0.6 | Low | Deferred — `Refactor candidate: type-safety debt sweep (rolled-up)` |
| D10 | 5 sync-connector spawn sites missing `extensionProcessEnv()` | 5 | 1 | 5.0 | High | **Top-5 slot 1** |
| D11 | Bucket A — 20 false-positive sites (JSDoc / manifests / log-redaction / runtime check) | 5 | 1 | 5.0 | High | **Top-5 slot 2** |
| D11 | Bucket B — 15 real sites across 14 canonical-reader files (one site per file) reading static PAT/API keys or per-service OAuth tokens | 3 | 2 | 1.5 | High | Deferred — `Refactor candidate: route through future readConnectorSecret(serviceId) helper`; 14-file allow-list would dilute the audit |
| D11 | Bucket C — 12 real sites in `lazy-mesh.ts` (lines 488/502/674/710/820/895/1231/1234/1235/1237/1238/1240) | 4 | 3 | 1.33 | High | Deferred — `Refactor candidate: route lazy-mesh vault-key reads through readConnectorSecret(serviceId) helper in connector-vault.ts` |
| D11 | Bucket C — 9 real sites in `connector-rpc-handlers.ts` (lines 365/401/510/529/551/809/837/1020/1022) | 4 | 3 | 1.33 | High | Deferred — `Refactor candidate: route writes through writeConnectorSecret(serviceId, value) and sharedOAuthKey(provider) helpers` |
| D12 | 94 `db.run()` sites outside `db/write.ts` (census per design spec § 6.3) | 4 | 5 | 0.8 | High | Deferred — `Refactor candidate: typed dbRun migration (S5-F4 in roadmap)` |

---

## Pass-through dimensions (no findings)

These dimensions met their Phase 1 baseline without violation:

| Dim | Baseline | Phase 2 result |
|---|---|---|
| D1 — Forbidden cross-package imports | 0 | 0 violations (pass) |
| D2 — Cyclic imports within a workspace | 0 | 0 violations (pass) |
| D3 — PAL leakage | 0 | 0 violations (pass) |
| D8 — `any` count | 2 (locked baseline) | 2 (matches; baseline holds) |

D1/D2/D3 are gate dimensions — any regression fails CI on the next push.
D8 is the manual-ratchet baseline (design spec § 3.3); reductions require an
in-PR `any-baseline.json` update.

---

## Pending dimensions

| Dim | Status |
|---|---|
| D5 — Cognitive complexity > 15 per function | Pending the first SonarCloud cognitive-complexity dashboard upload. No threshold violation can be ranked until SonarQube analysis completes. |

When the dashboard is live, D5 enters the next audit pass; for B3 it is
deliberately out of scope (design spec § 6.3 — D5 is dashboard-only, not a
gate dimension).

---

## Provenance

- Pre-task SHA: `4cc006544d7da49fd359f550e32e17a4c6dba82a` (path-correction commit on `dev/asafgolombek/structure-audit-phase-2`)
- Phase 1 baseline: [`docs/structure-audit/baseline.md`](./baseline.md) @ `a3f327b`
- Audit run blob: `docs/structure-audit/run-2026-04-30T18-20-59-111Z.json`
- Tool reports (committed for provenance):
  - `docs/structure-audit/jscpd-report.json` — duplication (D6)
  - `docs/structure-audit/knip-report.json` — unused exports / orphans (D7)
  - `docs/structure-audit/risky-assertions.json` — `as <Type>` sites (D9)
  - `docs/structure-audit/file-loc.json` — file LOC measurements (D4)
  - `docs/structure-audit/db-run-census.json` — `db.run()` census (D12)
  - `docs/structure-audit/churn-90d.json` — 90-day commit counts (impact-score input)
  - `docs/structure-audit/any-baseline.json` — `any` count baseline (D8)
- Triage scripts: `scripts/structure-audit/*.ts` @ pre-task SHA above
- Ranking rubric: design spec § 5 (`impact / cost`, ties broken by reviewer judgement)
- Stop rule: design spec § 5.3 (cost ≥ 3 → auto-defer regardless of impact)
