# Phase 4 Completion — WS5-D + WS6 + WS7 + A.1/A.2 + `v0.1.0` Unsigned Preview Release

**Date:** 2026-04-21
**Author:** Asaf Golombek
**Status:** Design — awaiting approval before writing implementation plans
**Related:**
- `docs/release/v0.1.0-prerequisites.md` (procurement runbook)
- `docs/superpowers/plans/2026-04-19-ws5a-app-shell-foundation.md` (reference shape)
- `docs/roadmap.md`, `docs/architecture.md`, `nimbus-phase-4` skill
- `CLAUDE.md`, `GEMINI.md`

---

## 1. Executive Summary

This spec defines the complete remaining scope of **Phase 4 — Presence**, from the current `dev/asafgolombek/phase_4_ws5` branch state (WS5-C PR pending) through tagging `v0.1.0`. It covers:

#### Spec Amendment 2026-04-22

Between spec authorship (2026-04-21) and Section 2 execution, migrations
V20 (`llm_task_defaults`) and V21 (`sync_state.depth`) landed on `main`.
S2's watcher-graph migration is therefore numbered **V22**; S3's workflow
branching migration will be **V23**. All other S2/S3 scope is unchanged.

- **Two Gateway automation enhancements** — A.1 (graph-aware watcher conditions), A.2 (workflow branching).
- **Three remaining Tauri UI pages** — Extensions Marketplace, Watchers, Workflows.
- **The Rich TUI** (`nimbus tui`) — 4-pane Ink terminal layout with streaming, HITL, history, and `TERM=dumb` fallback.
- **The VS Code extension** — `packages/vscode-extension/`, published to VS Code Marketplace + Open VSX.
- **Release hardening** — production Ed25519 updater signing, GPG-signed Linux artifacts, SBOM, full `release.yml` wiring.
- **Documentation audit pass** — cross-doc consistency aligned to v0.1.0 narrative.
- **Release candidate + manual multi-OS verification + final `v0.1.0` tag + publishing.**

Work is organized as **16 strictly-serial sections** (Section 0 through Section 15), each landing as its own PR to `main` with a dedicated feature branch. Fine-grained sectioning matches the rhythm of WS5-C plans 1–5; each section is ~2–9 days of focused work.

---

## 2. Scope Decisions (from brainstorm)

| Decision | Value | Notes |
|---|---|---|
| Shape | Option A — full spec, "wow" release | No MVP shortcuts; every feature in the Phase 4 skill ships before `v0.1.0`. |
| End state | Option B — tagged + published v0.1.0 | Not just code-complete. Includes publishing to every distribution channel. |
| Code-signing strategy | **Skip paid certs at this stage** | No Apple Developer ID, no Authenticode EV. Ship as **unsigned developer preview** with documented OS workarounds. Defer paid signing to post-customer-validation milestone. |
| Domain | **Keep** `nimbus.dev` (~$12/yr) | Provides stable URLs for registry + extension schema. $12/yr is below rename-tech-debt threshold. |
| Automation enhancements | **Include A.1 + A.2** | Watchers and Workflows pages would feel thin without these; adding them aligns with the "wow" goal. A.3 already delivered. |
| Plan granularity | Fine (~15 sections) | Matches WS5-C cadence; each plan is focused and reviewable. |
| 3-OS verification path | Windows native + Hyper-V Ubuntu + Scaleway M1 pay-per-hour | Total extra hardware cost ~$3–10 one-time. GitHub-hosted `macos-14` runner handles automated signing/notarization plumbing (for updater Ed25519, not Apple certs). |
| Cost bias | Free / minimal wherever possible | Cloudflare Pages for registry, free npm + VS Code + Open VSX publishers, no eSigner, no MacStadium. |
| A.1/A.2 expression language scope | Strict subset — no function calls, no eval | Security-first. Rich expressions deferred to Phase 5 if needed. |

---

## 3. Revised v0.1.0 Release Gate

Each cell scored `code / verified` (implementation exists / manually confirmed on platform).

| Check | Win | mac | Linux |
|---|---|---|---|
| `nimbus ask` via Ollama (no API key) | c/v | c/v | c/v |
| `nimbus ask` via llama.cpp GGUF | c/v | c/v | c/v |
| Voice push-to-talk round-trip (STT → LLM → TTS) | c/v | c/v | c/v |
| `nimbus data export` + `import` round-trips full state | c/v | c/v | c/v |
| `nimbus audit verify` passes (100+ rows) | c/v | c/v | c/v |
| **Unsigned `.exe` launches after `More info → Run anyway`** | c/v | — | — |
| **Unsigned `.app` launches after right-click Open** | — | c/v | — |
| `.deb` + AppImage ship GPG-signed; `gpg --verify` passes | — | — | c/v |
| Tauri UI: Dashboard + HITL + Marketplace + Watchers + Workflows | c/v | c/v | c/v |
| `nimbus tui` launches + streams + HITL inline | c/v | c/v | c/v |
| VS Code extension (Marketplace + Open VSX) connects + Ask + HITL + status bar | c/v | c/v | c/v |
| `updater.applyUpdate` Ed25519 verify + rollback on tamper | c/v | c/v | c/v |

Additional stringency rows verified during Section 14:
- Multi-agent: 3 parallel sub-agents cannot bypass HITL.
- `enforce_air_gap = true` → zero outbound HTTP.
- LAN pairing: 5-minute window closes; 3-failed-attempts lockout.

30 core cells + 3 stringency verifications = 33 verification points.

---

## 4. Branching Strategy

- Start from current branch `dev/asafgolombek/phase_4_ws5` (merge its WS5-C content to `main` in Section 1).
- Per-section branch naming: `dev/asafgolombek/phase4-s{N}-{slug}`.
- One PR per section → squash-merge to `main`. No long-lived integration branches.
- Per-section documentation edits land in the same PR as the motivating code change. Section 12 is a dedicated cross-doc consistency pass — not a replacement for per-section updates.
- RC tags and final `v0.1.0` are cut from `main`, not feature branches.

---

## 5. Sequencing & Dependencies

```
S0 (procurement) ──────────────────────────────────────────────┐
                                                               │
S1 (WS5-C merge) ─► S2 (A.1 watchers-graph) ─► S3 (A.2 workflow-branching)
                                                               │
                                      ┌────────────────────────┘
                                      ▼
                            S4 (Marketplace UI) ─► S5 (Watchers UI) ─► S6 (Workflows UI)
                                      │
                                      ▼
                            S7 (TUI framework) ─► S8 (TUI HITL + history)
                                      │
                                      ▼
                            S9 (VS Code scaffold) ─► S10 (VS Code depth + publish)
                                      │
                                      ▼
                            S11 (release hardening) ─► S12 (docs audit)
                                      │
                                      ▼
                            S13 (rc*) ─► S14 (verify) ─► S15 (tag + publish)
```

**Key dependencies:**
- S2 → S5 (Watchers UI consumes A.1 IPC).
- S3 → S6 (Workflows UI consumes A.2 IPC).
- S4 independent of A.1/A.2.
- S7/S8 (TUI) and S9/S10 (VS Code) are independent of S4/S5/S6 (Tauri UI) and could theoretically run in parallel — saving ~2–3 calendar weeks if a second worker (or a parallel Claude session) is available. Kept strictly serial here per current solo-maintainer preference; this is a one-line decision to revisit later if velocity matters more than focus.
- S13 requires S0 outputs (signing keys, accounts, domain) in hand.

---

## 6. Section Definitions

### Section 0 — Procurement Kickoff

**Objective:** Execute `docs/release/v0.1.0-prerequisites.md` with the cost-reduction decisions applied.

**Scope:**
- **DROP:** Apple Developer Program, EV Authenticode cert, SSL.com eSigner.
- **KEEP:** `nimbus.dev` domain (Cloudflare Registrar — verify availability at WHOIS first; if taken or premium-priced > $100/yr, escalate to a domain-pivot decision before proceeding), GPG master + signing subkey (master key generated on offline/air-gapped machine, exported to two USB drives stored separately, **wiped from CI machine** — only the signing subkey appears in `GPG_SIGNING_SUBKEY` GHA secret), Ed25519 updater keypair, Cloudflare Pages `nimbus-registry` repo + deployment, VS Code Marketplace publisher + PAT, Open VSX namespace + token, npm `@nimbus-dev` org + granular token, GitHub repo config (branch protection, release environment with explicit "required reviewers = project owner" gate, secrets).
- **ADD:** Hyper-V on Windows dev machine + Ubuntu 22.04 ISO; Scaleway account + SSH key for macOS verification rentals (~$0.11/hr).
- Amend `docs/release/v0.1.0-prerequisites.md` to reflect removed rows and added hardware items.

**Deliverables:**
- `nimbus.dev` live on Cloudflare DNS.
- `GPG_SIGNING_SUBKEY`, `GPG_PASSPHRASE`, `UPDATER_ED25519_PRIVATE_KEY`, `VSCE_PAT`, `OVSX_PAT`, `NPM_TOKEN` populated as GHA repo secrets.
- `packages/gateway/src/updater/public-key.ts` updated with production Ed25519 public key; dev-key override retained for tests.
- `docs/release/SIGNING-KEY.asc` (GPG public key) committed.
- `registry.nimbus.dev` responding with a signed empty `index.json`.
- Hyper-V Ubuntu 22.04 VM installed.
- Branch protection, `release` environment, secret scanning configured on the GitHub repo.

**Acceptance criteria:**
- `gpg --verify docs/release/index.json.asc docs/release/index.json` passes locally.
- `openssl pkeyutl -sign` over a test binary verifies against the updated `public-key.ts` in a unit test.
- Branch protection blocks direct push to `main`.
- `release` GitHub environment requires manual reviewer approval; deployment branches restricted to `main` only; protected tags `v*`, `client-v*`, `vscode-v*`. Verified by attempting to dispatch `release.yml` against a pre-release tag and observing the approval gate halt the run before publish jobs execute.
- GPG master key wiped from CI machine; offline backup verified by importing on a clean machine.
- Amended prerequisites runbook committed.

**Estimated effort:** 3–5 business days wall-clock, ~4 hours keyboard time.

**Branch:** `dev/asafgolombek/phase4-s0-procurement`.

---

### Section 1 — WS5-C Merge + Phase 4 Branch Hygiene

**Objective:** Land pending WS5-C work on `main` via a clean PR so subsequent sections start from a merged baseline.

**Scope:**
- Open the pending WS5-C PR from `dev/asafgolombek/phase_4_ws5` to `main`.
- Resolve remaining SonarCloud / CodeQL / Biome / Rust clippy findings.
- Verify `bun run typecheck && bun run lint && bun test && cd packages/ui && bunx vitest run --coverage` all green; `packages/ui` ≥80% line / ≥75% branch.
- Ensure `docs/manual-smoke-ws5c.md` signed off.
- Verify `roadmap.md` WS5-C bullet and `CLAUDE.md` Phase 4 status row match what actually landed.
- **No new features** — pure merge + hygiene.

**Acceptance criteria:** `main` CI green on 3-OS matrix; Dashboard / HITL / Onboarding / Quick-Query / Settings flows smoke-pass on Windows + Linux VM.

**Docs:** Update `roadmap.md` Phase 4 row; update `CLAUDE.md` status line; update `docs/README.md` Phase 4 row if it references WS5 status.

**Branch:** existing `dev/asafgolombek/phase_4_ws5`.
**Effort:** 1–2 days (review latency dominated).

---

### Section 2 — A.1 Gateway: Graph-Aware Watcher Conditions

**Objective:** Extend watcher conditions to reference the people graph and existing `upstream_refs` / `downstream_refs` relationships on indexed items.

**Scope:**
- Extend condition schema in `packages/gateway/src/automation/watcher-store.ts` with a `graph` operator: `{ graph: { relation: "owned_by" | "upstream_of" | "downstream_of", target: PersonRef | ItemRef } }`.
- Compile graph predicates in `watcher-engine.ts` against `packages/gateway/src/graph/relationship-graph.ts` — reuse existing `traverseGraph`.
- Add IPC `watcher.validateCondition` (read-only preview of match count).
- Add IPC `watcher.listCandidateRelations` for UI dropdowns.
- Feature flag `[automation.graph_conditions] = true` in `nimbus.toml`; default on for v0.1.0.
- Schema migration **V22:** `ALTER TABLE watchers ADD COLUMN graph_predicate_json TEXT` (nullable).

**New files:** `packages/gateway/src/automation/graph-predicate.ts`, `graph-predicate.test.ts`, `packages/gateway/src/index/watcher-graph-v22-sql.ts`.

**Modified files:** `watcher-store.ts`, `watcher-engine.ts`, watcher IPC dispatcher (`packages/gateway/src/ipc/automation-rpc.ts`), Tauri `ALLOWED_METHODS` in `packages/ui/src-tauri/src/gateway_bridge.rs`.

**Acceptance criteria:**
- Graph predicates fire correctly against seeded graph fixtures.
- Watcher condition validation round-trips via IPC without exposing secrets.
- `packages/gateway/src/automation/` coverage stays ≥80%.
- Migration V20 reversible via the existing backup/restore path.

**Docs:** `docs/architecture.md` — Watchers section gains a graph-aware example. `CLAUDE.md` — add `watcher-engine.ts` + `graph-predicate.ts` to key-files table.

**Branch:** `dev/asafgolombek/phase4-s2-watcher-graph`.
**Effort:** 3–4 days.

---

### Section 3 — A.2 Gateway: Workflow Branching

**Objective:** Extend workflow YAML schema + runner to support conditional steps (`if` / `when`), producing a branching execution graph.

**Scope:**
- Extend `packages/gateway/src/automation/workflow-store.ts` step schema: optional `when: <expression>` evaluated against prior-step outputs and session context.
- Extend `workflow-runner.ts`: skip steps whose `when` is falsy; skipped steps write `status = "skipped"` (not `failed`). Existing linear pipelines forward-compatible.
- Expression language — strict subset: `$.step_id.field`, comparison operators, `&&`/`||`/`!`, string/number literals, **plus a fixed whitelist of pure side-effect-free functions:** `contains(haystack, needle)`, `startsWith(s, prefix)`, `endsWith(s, suffix)`, `lower(s)`, `upper(s)`, `length(value)`. Parser in `workflow-expression.ts` resolves these via a hard-coded function table — no dynamic dispatch, no user-defined functions, no regex (DOS risk), no `eval`/`Function`. Anything outside the whitelist is a parse error at workflow save time, not runtime. **Rationale:** the whitelist removes the verbose `field == "x" || field == "y" || field == "z"` pain without opening attack surface; each function is < 10 lines of TypeScript with bounded execution.
- Extend `workflow-hitl-preview.ts`: steps whose `when` depends on runtime values are tagged `CONDITIONAL — may be skipped at runtime`.
- New IPC `workflow.simulate` — dry-run with sample inputs returns concrete execution path.
- Schema migration **V23:** `ALTER TABLE workflow_steps ADD COLUMN when_expression TEXT NULL`; `ALTER TABLE workflow_runs ADD COLUMN branching_path_json TEXT NULL`.

**New files:** `workflow-expression.ts`, `workflow-expression.test.ts`, `packages/gateway/src/index/workflow-branching-v23-sql.ts`.

**Modified files:** `workflow-store.ts`, `workflow-runner.ts`, `workflow-hitl-preview.ts`, `automation-rpc.ts`.

**Acceptance criteria:**
- Linear workflows without `when` execute identically — regression covered by existing `workflow-runner-execution.test.ts`.
- New `workflow-branching.test.ts`: `when: true`, `when: false`, expression referencing prior step, nested `&&`/`||`, each whitelisted function (`contains`, `startsWith`, `endsWith`, `lower`, `upper`, `length`), malformed → rejected at save time, attempt to call non-whitelisted function (`eval`, `regex`, user-defined) → rejected at save time.
- HITL preview surfaces conditional HITL steps with `may-skip` marker.
- Expression parser has no code path executing arbitrary JS (explicit test asserts `eval`, `Function`, template literals throw).
- `automation/` coverage stays ≥80%.

**Docs:** `docs/architecture.md` — add branching workflow example. `docs/phase-4-plan.md` — A.2 complete. `CLAUDE.md` — add `workflow-expression.ts`. `docs/README.md` — update the `weekly-cleanup.yml` example to showcase `if:` branching.

**Branch:** `dev/asafgolombek/phase4-s3-workflow-branching`.
**Effort:** 4–5 days.

---

### Section 4 — WS5-D1: Extensions Marketplace Page

**Objective:** Give users a single place to browse, install, enable/disable, update, and remove extensions from the local registry mirror of `registry.nimbus.dev/index.json`.

**Scope:**
- New route `/marketplace` → `packages/ui/src/pages/Marketplace.tsx` with **Browse** + **Installed** tabs.
- Backend addition: `packages/gateway/src/extensions/catalog.ts` — fetches + GPG-verifies signed registry index; returns parsed JSON or `ERR_REGISTRY_UNTRUSTED`.
- Browse tab: `extension.catalog.list` IPC → grid of `ExtensionCard` (name, author, version, permissions badges, hitlRequired badges, sandbox-level badge [`process-isolated` for v0.1.0; component accepts future `syscall-isolated`], Install button).
- Installed tab: `extension.list` IPC → rows with Enable/Disable, Remove, Update-available pill, last-sync timestamp, **and a "Setup Required" pill + Configure secondary action when the extension's required Vault keys are absent or its first sync has never succeeded.** Clicking Configure routes to the existing connector auth flow (`/connectors` deep-link with the extension's connector pre-selected) instead of forcing the user to discover that the extension is broken on first invocation. Backend dependency: `extension.list` response gains a `setupRequired: boolean` + `setupHint: string` field — small change in `packages/gateway/src/extensions/index.ts`.
- Install flow: HITL consent → `extension.installProgress` notification → success toast → tab auto-switch.
- Update flow: Update-available pill → HITL → single `extension.update` IPC (version bump + manifest hash re-verification).
- Remove flow: typed-name confirm (reuse `useConfirm`) → `extension.remove`.
- Categories filter from manifest `tags[]`.
- Empty states: registry unreachable → offline banner + cached catalog note; no installed → CTA.
- Install flow first-auth step: **inline wizard deferred to post-v0.1.0.** v0.1.0 path is install → "Setup Required" pill on the Installed row → Configure click → `/connectors` deep-link. Avoids extending the install wizard while still routing the user to the right place — no "I installed it, why does it say nothing works" moment.

**New files:** `pages/Marketplace.tsx`, `components/marketplace/{ExtensionCard,SandboxBadge,PermissionsBadges}.tsx`, `store/slices/extensions.ts`, gateway `extensions/catalog.ts` + `catalog.test.ts`, co-located `*.test.tsx`.

**Modified files:** `App.tsx`, `Sidebar.tsx`, `gateway_bridge.rs` `ALLOWED_METHODS` (add `extension.catalog.list`, `extension.install`, `extension.update`, `extension.enable`, `extension.disable`, `extension.remove`, `extension.listCategories`). Add install-related methods to `NO_TIMEOUT_METHODS` if install proves long-running.

**Acceptance criteria:**
- Vitest coverage ≥80% lines / ≥75% branches on new files.
- Integration test: stubbed `registry.nimbus.dev` returns signed `index.json`; tampered response rejected.
- HITL fires for Install / Update / Remove.
- Tampered manifest hash at install → install aborts, no partial DB state.

**Docs:** `docs/architecture.md` — update Extension Marketplace UI mock with sandbox badge. `docs/README.md` — Marketplace screenshot slot. `CLAUDE.md` — new files. `docs/roadmap.md` — Marketplace delivered.

**Branch:** `dev/asafgolombek/phase4-s4-marketplace`.
**Effort:** 5–6 days.

---

### Section 5 — WS5-D2: Watchers Page

**Objective:** Visual list / create / edit / enable / pause / test / inspect watchers, including A.1 graph-aware conditions.

**Scope:**
- New route `/watchers` → `packages/ui/src/pages/Watchers.tsx`; layout: left list pane, right detail pane.
- Watcher list: `watcher.list` IPC; rows show name, condition summary, last-fired timestamp, enabled toggle, status pill.
- `components/watchers/ConditionBuilder.tsx`: composable AND/OR groups, **unbounded nesting depth** for flexibility; keyword/field operators + the new `graph` operator from A.1. Graph panel populates from `watcher.listCandidateRelations`.
- Live preview: `watcher.validateCondition` shows "Would fire on N current items." Debounced 300 ms.
- `components/watchers/HistoryDrawer.tsx`: last 50 firings from `watcher.history` IPC; timestamp, matched item summary, action outcome including HITL status from audit log.
- Bulk actions: pause all / resume all / export selected watchers as JSON.
- HITL fires on `watcher.create`, `watcher.update`, `watcher.delete`.

**New files:** `pages/Watchers.tsx`, `components/watchers/{ConditionBuilder,GraphConditionPanel,KeywordConditionPanel,HistoryDrawer,WatcherRow}.tsx`, `store/slices/watchers.ts`, co-located Vitest specs.

**Modified files:** `App.tsx`, `Sidebar.tsx`, `gateway_bridge.rs` `ALLOWED_METHODS` (add `watcher.list`, `watcher.create`, `watcher.update`, `watcher.delete`, `watcher.pause`, `watcher.resume`, `watcher.history`, `watcher.validateCondition`, `watcher.listCandidateRelations`).

**Acceptance criteria:**
- Vitest coverage ≥80% / ≥75% on new files.
- Condition builder round-trips every supported operator without data loss (snapshot test).
- Graph predicate dropdowns populate from real index fixture.
- HITL end-to-end test for writes in `packages/ui/src/__tests__/`.

**Docs:** `docs/architecture.md` — Watchers subsystem section. `CLAUDE.md` — file-location entries. `docs/roadmap.md` — A.1 + Watchers UI delivered.

**Branch:** `dev/asafgolombek/phase4-s5-watchers-ui`.
**Effort:** 6–7 days.

---

### Section 6 — WS5-D3: Workflows Page

**Objective:** Visual workflow editor + run history + dry-run + branching-aware UI for the A.2 workflow engine.

**Scope:**
- New route `/workflows` → `packages/ui/src/pages/Workflows.tsx`; layout: left list, right editor / history / dry-run.
- Workflow list: `workflow.list` IPC.
- `components/workflows/WorkflowEditor.tsx` — **step-list** view (each step as a card; simpler + ships faster than graph canvas; still visually compelling). Cards show prompt, optional label, optional `when:` input, `continue-on-error` toggle, HITL-required badge auto-computed. Add/remove/reorder steps. Save → `workflow.save` IPC.
- Branching affordance: non-empty `when:` renders indented branch visual with expression shown. Live validation via `workflow.parseExpression` IPC — invalid expression blocks save.
- **Read-only Mermaid graph view:** alongside the editor, a "Visualize" tab renders the workflow as a Mermaid `flowchart TD` diagram via `mermaid.js` (~150 KB, client-side only, already on npm — no server dependency). Each step is a node; `when:`-conditional steps render as diamond decisions with truthy/falsy edges. Pure read-only (no graph-canvas editing in v0.1.0); makes complex nested branching intelligible without indentation eye-strain. Auto-rebuilds on every save. Generation is deterministic — small helper `components/workflows/workflow-to-mermaid.ts`. Test coverage proves Mermaid output round-trips for fixture workflows.
- Dry-run toggle: `workflow.simulate` (S3) shows full execution preview including skipped conditional steps. Editable sample inputs. Toggling off reverts to real-run.
- `components/workflows/RunHistory.tsx`: prior runs with status, branching path taken, HITL decisions, outcome. Drawer expands to step-by-step trace.
- HITL preview before Run: lists every HITL step that WILL or MAY hit; conditional HITL tagged `— may require approval`.

**New files:** `pages/Workflows.tsx`, `components/workflows/{WorkflowEditor,StepCard,BranchingAffordance,RunHistory,DryRunPanel,HitlPreview,VisualizeTab}.tsx`, `components/workflows/workflow-to-mermaid.ts`, `store/slices/workflows.ts`, specs.

**Modified files:** `App.tsx`, `Sidebar.tsx`, `packages/ui/package.json` (add `mermaid` dependency), `gateway_bridge.rs` `ALLOWED_METHODS` (add `workflow.list`, `workflow.save`, `workflow.delete`, `workflow.run`, `workflow.runHistory`, `workflow.simulate`, `workflow.parseExpression`).

**Acceptance criteria:**
- Vitest coverage ≥80% / ≥75% on new files.
- Linear workflows round-trip unchanged.
- Workflow with `when:` previews branching correctly in dry-run — verified against two fixture workflows.
- Malformed expression blocks save (UI enforces same rule as gateway).
- Workflow run with HITL step pauses at inline HITL popup; approve/reject produces audit log entry.

**Docs:** `docs/architecture.md` — Workflow subsystem update with branching. `docs/README.md` — continuation of the `weekly-cleanup.yml` showcase. `CLAUDE.md`, `docs/roadmap.md` — A.2 + Workflows UI delivered.

**Branch:** `dev/asafgolombek/phase4-s6-workflows-ui`.
**Effort:** 8–10 days (uplifted from 7–9 to absorb the Mermaid Visualize tab).

---

### Section 7 — WS6-A: TUI Framework + Streaming

**Objective:** Launch `nimbus tui` into a 4-pane Ink layout that runs a query, streams the response token-by-token, and shows connector health.

**Scope:**
- New deps: `ink` + workspace `@nimbus-dev/client` in `packages/cli/package.json`.
- New command: `packages/cli/src/commands/tui.ts` wires `nimbus tui` to `render()` of the Ink app.
- New directory `packages/cli/src/tui/`:
  - `App.tsx` — 4-pane layout (Query Input top, Result Stream left-main, Connector Health right-top, Sub-Task Progress right-bottom). Uses Ink `<Box>` flex.
  - `layout.ts` — breakpoint logic: width < 100 cols OR height < 30 rows → collapse to stacked.
  - `ipc-bridge.ts` — typed hooks (`useStream`, `useSubscription`, `useQuery`) wrapping `@nimbus-dev/client`.
  - `QueryInput.tsx` — multi-line input, Enter submit, Esc clear, Ctrl+C exit.
  - `ResultStream.tsx` — consumes `engine.askStream`; renders token-by-token; shows model badge from token metadata.
  - `ConnectorHealth.tsx` — polls `connector.list` every 30 s.
  - `SubTaskProgress.tsx` — placeholder for S8; "No active sub-tasks."
- HITL encountered → show `⚠ Query requires consent — HITL supported in S8` and abort cleanly.
- Ctrl+C: send `engine.streamCancel` (verify method exists, fall back to subscription close), then `process.exit(0)`.
- New coverage gate `bun run test:coverage:tui` ≥80% lines / ≥75% branches on `packages/cli/src/tui/`.

**New files:** `packages/cli/src/commands/tui.ts`, `packages/cli/src/tui/{App,QueryInput,ResultStream,ConnectorHealth,SubTaskProgress,layout,ipc-bridge}.tsx/.ts`, co-located `*.test.tsx` using `ink-testing-library`.

**Modified files:** `packages/cli/src/index.ts` (register `tui` subcommand), `packages/cli/package.json` (Ink dep), `docs/README.md` (new "Rich TUI" section), `docs/architecture.md` (Rich TUI subsystem), `docs/cli-reference.md` (new `tui` command), `CLAUDE.md` key-files, `.github/workflows/ci.yml` (new coverage script).

**Acceptance criteria:**
- `nimbus tui` launches on Windows (native + Windows Terminal), Linux (Hyper-V VM), macOS (Scaleway).
- Query streams via `engine.askStream`.
- Connector health refreshes every 30 s without blocking stream.
- Terminal resize triggers re-layout.
- Ctrl+C exits cleanly without orphaned stream ids.
- Coverage gate passes.

**Branch:** `dev/asafgolombek/phase4-s7-tui-framework`.
**Effort:** 5–6 days.

---

### Section 8 — WS6-B: TUI HITL, History, Fallback

**Objective:** Complete the TUI to v0.1.0 release-gate quality — HITL works inline, query history persists, SSH/dumb-terminal fallback is automatic, sub-task pane is alive.

**Scope:**
- `components/HitlOverlay.tsx`: subscribes to `consent.request` notifications; full-width modal with structured action preview; Approve/Reject → `consent.respond`. QueryInput disabled while open.
- `lib/query-history.ts`: reads/writes PAL-resolved history path (`%APPDATA%\Nimbus\query_history.json` on Windows, `~/.config/nimbus/query_history.json` elsewhere). Cap 100 entries. Up/Down arrows scrub. Duplicate-suppression. Writes on submit.
- `SubTaskProgress` becomes live: subscribes to `agent.subTaskProgress`; progress bar per running sub-task; `pending → running → done` transitions; distinct colors for `skipped` vs `failed`.
- Fallback: at `tui.ts` entrypoint, detect `TERM=dumb` / `NO_COLOR` / non-TTY stdin **/ legacy Windows console** (Windows + `process.env.WT_SESSION` absent + `process.env.TERM_PROGRAM` not set — heuristic for `cmd.exe`/`conhost.exe` outside Windows Terminal, where Ink's flexbox layout breaks). Any match → print fallback notice (`"Rich TUI unavailable in this terminal — falling back to REPL. Tip: use Windows Terminal for the full experience."` on Windows) and `exec` the Phase 3 REPL entrypoint. **No `--no-tui` flag**; pure automatic detection.
- `WatcherPane.tsx` (moved here from S7 for balance): polls `watcher.list` every 30 s; read-only summary.

**New files:** `packages/cli/src/tui/{HitlOverlay,WatcherPane}.tsx`, `packages/cli/src/tui/lib/{query-history,fallback-detect}.ts`, co-located tests.

**Modified files:** `tui.ts` (fallback detection), `App.tsx` (wire HitlOverlay + live SubTaskProgress + WatcherPane), `QueryInput.tsx` (history nav), `ipc-bridge.ts` (consent.request + agent.subTaskProgress subscriptions).

**Acceptance criteria:**
- HITL query shows overlay mid-stream; approve resumes stream + completes action; reject aborts cleanly.
- `TERM=dumb nimbus tui` falls back to Phase 3 REPL without error. Legacy `cmd.exe` (Windows + no `WT_SESSION`) also triggers fallback. Windows Terminal launches the full TUI.
- History file updates on submit; 101st entry displaces oldest.
- SubTaskPane shows per-sub-task bars during multi-agent query.
- Coverage ≥80% / ≥75%.
- `tui-hitl-roundtrip.e2e.test.ts` in `bun test:e2e:cli` — spawns Gateway + `nimbus tui` via `pty`, enters HITL query, approves, asserts action dispatched.

**Docs:** `docs/architecture.md` — finalize Rich TUI section with HITL + fallback. `docs/cli-reference.md` — expand `tui` entry. `docs/README.md` — full usage screenshot.

**Branch:** `dev/asafgolombek/phase4-s8-tui-hitl-history`.
**Effort:** 4–5 days.

---

### Section 9 — WS7-A: VS Code Scaffolding + Ask + Status Bar

**Objective:** Minimum-wow VS Code extension that connects to local Gateway, runs `Nimbus: Ask` with streaming response into an editor tab, and shows profile + connector health in the status bar.

**Scope:**
- New package `packages/vscode-extension/` with `package.json` (extension manifest, `engines.vscode: ^X.Y.0` — **pin to `min(current Cursor stable VS Code API base, 1.90)` after verifying Cursor's actual API version at S9 start; document the verification result in the PR description.** Cursor frequently lags VS Code by 2–4 minor versions and has historically been on 1.86–1.89 at points where VS Code stable was 1.92+. Wrong pin = silent install failure on Cursor), `activationEvents`, `contributes.commands`, `publisher: "nimbus-dev"`, `categories: ["AI","Other"]`, MIT-licensed), `tsconfig.json`, `.vscodeignore`, `.vscode/launch.json`.
- `src/extension.ts` — `activate()` / `deactivate()`: creates `GatewayClient`, registers commands, wires status bar.
- `src/gateway-client.ts` — wraps `@nimbus-dev/client`, auto-detects socket path, reconnects with exponential backoff (1 s → 30 s), emits `gateway:connected` / `gateway:disconnected` events.
- `src/commands/ask.ts` — `Nimbus: Ask` command; **no default keybinding** (user-configurable via VS Code settings). Prompts via `window.showInputBox`, **opens new untitled Markdown editor tab in `vscode.ViewColumn.Beside` (side-by-side, Editor Group 2)** so the user keeps their code visible while the answer streams. Streams tokens appended at end of buffer. Cancel CodeLens at top of buffer.
- `src/status-bar.ts` — left-side status bar: `◉ nimbus · <profile> · <health-dot>`. Click opens output channel. Subscribes to `profile.switched` + polls `connector.list` every 30 s.
- HITL → status bar flashes amber + info message `"Nimbus: consent required — approve in the Tauri app or CLI"` (S10 fixes with inline HITL).
- `tsup` bundling to `dist/extension.js`. Node.js runtime in VS Code — no Bun runtime dep at user machine.
- CI job `vscode-extension-test` in `.github/workflows/ci.yml` uses `@vscode/test-electron` against a mock Gateway.
- New coverage gate ≥80% / ≥75% on `packages/vscode-extension/src/`.

**New files:** all under `packages/vscode-extension/`.

**Modified files:** root `package.json` workspace array, `docs/README.md` (VS Code section), `docs/architecture.md` (VS Code subsystem), `CLAUDE.md` key-files, `.github/workflows/ci.yml` (new test job).

**Acceptance criteria:**
- Extension installs from a `.vsix` built in CI.
- `Nimbus: Ask` streams a response against a running Gateway.
- Status bar updates within 30 s of connector health transition (verified by forcing `error` state).
- Gateway-offline: status bar shows `Nimbus offline`, commands surface a "Start Gateway" notification action that invokes CLI via `vscode.terminal`.
- Installs on Cursor without modification.

**Branch:** `dev/asafgolombek/phase4-s9-vscode-scaffold`.
**Effort:** 6–7 days.

---

### Section 10 — WS7-B: VS Code Search + Inline HITL + Publish

**Objective:** Complete the VS Code extension with `Nimbus: Search`, inline HITL, and the Marketplace + Open VSX publishing pipeline.

**Scope:**
- `src/commands/search.ts` — `window.createQuickPick`; debounced 150 ms; calls `query.search` IPC `{ query, limit: 20 }`; hits render as QuickPickItems (service, type, name, relative timestamp); selection opens URL via `vscode.env.openExternal`; modifier-click opens a Nimbus Ask tab pre-filled with context.
- `src/hitl-provider.ts` — subscribes to `consent.request`; default modal `window.showInformationMessage({modal:true})` for simple requests; falls back to WebviewPanel for rich structured previews (same JSON schema as Tauri HitlDialog; schema reuse, not React-component reuse). User configurable via `nimbus.hitlConfirmation` (`"modal" | "webview"`).
- Status bar HITL-pending badge: `⚠ 2 consent` when requests queued.
- `src/output-channel.ts` — `Nimbus` output channel for logs.
- Configuration keys: `nimbus.gatewaySocketPath`, `nimbus.askKeybinding`, `nimbus.hitlConfirmation`, `nimbus.telemetry.enabled` (mirror gateway; disabled by default).
- `.github/workflows/publish-vscode.yml` — trigger on `vscode-v*` tag; `ubuntu-22.04`; build `.vsix` via `vsce package`; publish via `vsce publish -p $VSCE_PAT` + `ovsx publish -p $OVSX_PAT`; uses `release` environment manual-approval gate; GitHub release with `.vsix` attached.
- `packages/vscode-extension/CHANGELOG.md` created (Marketplace requirement).
- `packages/vscode-extension/README.md` — Marketplace-facing product page.

**New files:** `src/commands/search.ts`, `src/hitl-provider.ts`, `src/hitl-webview.ts`, `src/output-channel.ts`, `.github/workflows/publish-vscode.yml`, `packages/vscode-extension/{README,CHANGELOG}.md`, co-located tests.

**Modified files:** `extension.ts` (wire new pieces), `package.json` (new commands / config / keybindings), `docs/architecture.md`, `docs/README.md`, `CLAUDE.md`, `docs/roadmap.md`.

**Acceptance criteria:**
- `Nimbus: Search` returns hits in < 200 ms against a 10k-item index.
- HITL modal appears when a Nimbus agent invocation from VS Code triggers consent; Approve runs action; Reject aborts; both write audit log entries.
- `publish-vscode.yml` dry-run against `release` environment publishes a pre-release version to both stores.
- Extension installs from Open VSX on VS Code 1.90+ and Cursor.
- Coverage ≥80% / ≥75%.

**Branch:** `dev/asafgolombek/phase4-s10-vscode-depth`.
**Effort:** 6–8 days.

---

### Section 11 — Release Hardening: Signing, Packaging, Updater, SBOM

**Objective:** Make `.github/workflows/release.yml` produce the exact artifacts shipped for `v0.1.0`, with every free signature in place, and prove the updater signature chain end-to-end.

**Scope:**

**Updater signing (production):**
- Verify `packages/gateway/src/updater/public-key.ts` holds production Ed25519 public key, not dev key.
- Retain `NIMBUS_DEV_UPDATER_PUBLIC_KEY` env override for tests.
- CI assertion: release build's embedded key is production (not dev).
- `release.yml` signs every binary via `openssl pkeyutl -sign` using `UPDATER_ED25519_PRIVATE_KEY` GHA secret.
- New helper: `packages/gateway/src/updater/sign-binary.ts` (CI use, not shipped).

**Updater manifest:**
- `release.yml` generates `update-manifest-<version>.json` (per-platform URLs, versions, SHA-256, Ed25519 sigs).
- Upload to GitHub Release as a release asset.
- **Auto-mirror to `registry.nimbus.dev/updates/latest.json` via a dedicated job in `release.yml`** that runs only after the `release` environment manual approval clears: the job clones the `nimbus-registry` repo, writes the new manifest into `updates/latest.json` (and an immutable archive copy at `updates/v<version>.json`), commits, pushes. Cloudflare Pages auto-deploys on the registry repo push. The same Ed25519 private key signs the manifest before commit; Cloudflare serves the resulting `.sig` alongside.
- Version tag regex enforced: `v\d+\.\d+\.\d+(-(rc|alpha|beta)\.\d+)?`. RC tags do **not** trigger the registry-mirror job (the `if:` guard in the job definition checks tag pattern); production tags only.

**Linux packaging + GPG:**
- Build `.deb` (existing `packages:installers:linux` script) + AppImage.
- `gpg --detach-sign --armor` each artifact using `GPG_SIGNING_SUBKEY` + `GPG_PASSPHRASE`.
- Emit `SHA256SUMS` + `SHA256SUMS.asc`.

**Windows packaging (unsigned):**
- Build `nimbus-cli.exe`, `nimbus-gateway.exe`, Tauri `.exe` installer.
- **Also build a `nimbus-windows-x64-portable.zip`** containing both binaries + a `README.txt` ("Run nimbus-gateway.exe to start; add this folder to PATH for the `nimbus` CLI"). Plain ZIPs typically attract fewer SmartScreen reputation flags than `.exe` installers, giving users a guaranteed path even if SmartScreen hard-blocks the installer. README links to both.
- **No signtool attempt.** Workflow logs explicit "UNSIGNED" banner.
- Emit SHA-256 for installer, binaries, and ZIP.

**macOS packaging (unsigned):**
- Build `nimbus-gateway`, `nimbus-cli`, Tauri `.app` on `macos-14` runner.
- Tauri config: skip codesigning (`--bundles app,dmg` no identity). `.app` inside `.dmg` (unsigned).
- No notarization. Release notes call out right-click-Open workaround.
- Emit SHA-256.

**SBOM:**
- Generate **CycloneDX JSON v1.5+** SBOM per artifact via `CycloneDX/gh-node-module-generatebom` (for npm dependency graph) plus `anchore/sbom-action` (for compiled binary's full transitive closure). Attach both to Release. Pinning to CycloneDX JSON 1.5+ ensures compatibility with modern security scanners (Snyk, Trivy, Grype, Dependency-Track) which prefer JSON over XML and have first-class 1.5 schema support.

**Minisign signatures:**
- Emit `SHA256SUMS.minisig` alongside `SHA256SUMS.asc`. ~20 lines of shell; uses the same Ed25519 key material in minisign envelope format for `minisign` CLI verification.

**Release environment gate:**
- `release.yml` publish jobs scoped to `release` environment (manual approval).

**New files:** `packages/gateway/src/updater/sign-binary.ts` + test, `packages/gateway/src/updater/public-key.test.ts` (production-key assertion).

**Modified files:** `release.yml`, `tauri.conf.json` (skip signing identity), `public-key.ts`.

**Acceptance criteria:**
- RC produces: Linux `.deb` + AppImage + GPG sigs, macOS `.dmg`, Windows `.exe` + installer, `SHA256SUMS` + `.asc` + `.minisig`, SBOM, signed `update-manifest-0.1.0-rc*.json`.
- `updater.test.ts` round-trip: production-key-signed binary verifies against embedded public key.
- `public-key.test.ts` asserts embedded key ≠ dev value.
- `gpg --verify SHA256SUMS.asc SHA256SUMS` passes using `docs/release/SIGNING-KEY.asc`.
- Release workflow halts for manual approval before publish.

**Docs:** `docs/release/SIGNING-KEY-ROTATION.md` (new). `docs/release/v0.1.0-prerequisites.md` final state. `docs/architecture.md` — updater signing chain.

**Branch:** `dev/asafgolombek/phase4-s11-release-hardening`.
**Effort:** 4–5 days.

---

### Section 12 — Docs Audit: Cross-Doc Consistency + v0.1.0 Narrative

**Objective:** One dedicated pass over every Markdown doc to make the repo narrate Phase 4 completion consistently. Purely cross-cutting — no new features.

**Scope:**

**Tier 1 — must update:**
- `docs/README.md` — v0.1.0 unsigned-preview banner at top (with per-OS workarounds); Phase 4 row → ✅ Complete; "What's new in v0.1.0" section; screenshots of Dashboard / HITL / Marketplace / Watchers / Workflows / TUI / VS Code (placeholders in S12, real captures in S14); install section with SHA-256 verify commands + VS Code / Open VSX links.
- `docs/architecture.md` — every Phase 4 subsystem has a real section; data flow diagram updated for new IPC methods; Security Model row for "Unsigned distribution — user acknowledgment via OS prompt; GPG + Ed25519 documented."
- `docs/roadmap.md` — Phase 4 checklist ticked; Phase 5 list scanned to remove inadvertently-delivered items; post-v0.1.0 backlog (code signing, mDNS, Cursor lane, future automation).
- `docs/phase-4-plan.md` — mark complete; link this spec as authoritative reference.
- `CLAUDE.md` — status line Phase 4 Complete; every new file in key-files table; commands section lists `nimbus tui`.
- `GEMINI.md` — mirror `CLAUDE.md` exactly.
- `CHANGELOG.md` — new `v0.1.0 — <date>` entry.
- `docs/cli-reference.md` — entries for `nimbus tui`, `nimbus update`, `nimbus lan *`, `nimbus data *`, `nimbus audit verify`.
- `packages/vscode-extension/README.md` — Marketplace narrative (created S10, finalized here).
- `packages/vscode-extension/CHANGELOG.md` — v0.1.0 entry.

**Tier 2 — verify / minor tweaks:**
- `docs/SECURITY.md` — unsigned-distribution note; Ed25519 / GPG fingerprints; link to `SIGNING-KEY-ROTATION.md`.
- `docs/mission.md`, `docs/CONTRIBUTING.md` — wording verification; VS Code build+test instructions added to CONTRIBUTING.
- `docs/CODE_OF_CONDUCT.md` — verify no change.
- `docs/templates/nimbus-extension-ci.yml` — verify current SDK expectations.
- `docs/manual-smoke-*.md` — consolidate WS5A/B/C per-WS checklists into `docs/manual-smoke-v0.1.0.md`; delete originals (git history preserves).
- `docs/release/v0.1.0-prerequisites.md` — mark steps complete; record final fingerprints.

**Tier 3 — programmatic version bumps:**
- Workspace `package.json` files → `version: "0.1.0"`.
- `packages/ui/src-tauri/tauri.conf.json` + `Cargo.toml`.
- `packages/gateway/package.json`.
- `packages/cli/package.json`.
- `packages/vscode-extension/package.json`.
- `packages/sdk/`, `packages/client/` — leave at own cadence unless explicitly bumping alongside core.
- New helper `scripts/version-bump.ts` for atomic bump+commit (reusable for future releases).

**Docs site** (`packages/docs/` Astro Starlight): propagates `docs/*.md` edits automatically; standalone pages swept for consistency in Tier 2.

**Acceptance criteria:**
- Every Tier 1 file touched.
- `rg -l 'Phase 4.*Active'` returns zero.
- `rg -l 'v0\.0\.' packages/` returns zero.
- `docs/manual-smoke-v0.1.0.md` contains every row of the revised release gate.
- `docs/README.md` renders on GitHub with no broken internal links.

**Branch:** `dev/asafgolombek/phase4-s12-docs-audit`.
**Effort:** 2–3 days.

---

### Section 13 — `v0.1.0-rc1` Release Candidate: Dry-Run

**Objective:** Exercise every line of `release.yml` end-to-end on a pre-release tag. Catch workflow bugs, artifact-naming issues, signature failures before a real release tag exists.

**Scope:**
- Tag `v0.1.0-rc1` from `main` after S12 merges.
- `release.yml` runs. Click Approve on `release` environment. Pipeline must produce full S11 artifact set.
- GitHub Release auto-created with `prerelease: true`.
- **No downstream publishes** — `publish-vscode.yml`, `publish-client.yml`, `publish-docs.yml` guarded by `on:` regex/`startsWith` so `rc` tags don't trigger Marketplace/Open VSX/npm/docs publishes. Verify guards before RC tag.
- Manual smoke on Windows dev machine (not full 3-OS yet):
  - SHA-256 verify all artifacts.
  - `gpg --verify SHA256SUMS.asc SHA256SUMS` with repo public key.
  - `openssl pkeyutl -verify` on `update-manifest-0.1.0-rc1.json.sig`.
  - Boot Windows `.exe` installer locally — confirm SmartScreen warning, `Run anyway` launches.
  - Extract `nimbus-windows-x64-portable.zip` and run `nimbus-gateway.exe` directly — confirm no SmartScreen, or note the warning behavior. ZIP path is the SmartScreen-mitigation fallback if the installer hard-blocks.
- Iteration: workflow failure → fix PR to `main` → re-tag `rc2`, `rc3`, etc. No hard cap on RC iterations but plan notes "three RCs without clean output → halt and reassess the pipeline" as a sanity check.
- Updater end-to-end: install `rc1` Gateway locally; seed updater config to mirror for `rc2`; confirm `updater.updateAvailable` notification, `updater.applyUpdate`, then deliberately tamper a binary (flip a byte) and confirm rollback event fires.

**Deliverables:**
- One or more `v0.1.0-rc*` GitHub Releases (pre-release).
- `docs/release/v0.1.0-rc-notes.md` log of issues + fixes.

**Risk flag:** SmartScreen hard-block. If Microsoft's very-low-reputation second-tier block fires (disables `Run anyway`), the **first fallback is the portable ZIP path** (typically less likely to attract a hard-block than installers). If ZIP also hard-blocks, project-level decision: (a) negotiate EV cert procurement after all, or (b) ship Windows as build-from-source only. Decision point lives in this section; surfaces in the risk register below.

**Acceptance criteria:**
- Final RC artifact set verifies via SHA-256, GPG, Ed25519, minisign.
- SmartScreen warning path works without hard-block (else decision above).
- Updater manifest signature verifies; tamper rollback works.
- No user-facing channel published during RC iteration.

**Branch:** N/A (tag-driven).
**Effort:** 2–4 days + buffer for iterations.

---

### Section 14 — Manual 3-OS Verification

**Objective:** Execute every row of the revised release-gate checklist on Windows, Linux (Hyper-V), and macOS (Scaleway M1) using the final accepted RC artifacts. Capture evidence for each cell. This is the gate for tagging `v0.1.0`.

**Preparation:**
- Confirm Section 13 ended with a clean RC. Use those RC artifacts — **do not install from a locally-built binary**.
- Version locked. Any verification failure forces a new `rc*`; Section 14 restarts from top.

**Execution:**

*Windows (native, ~half day):*
1. Fresh Windows user profile or VM snapshot.
2. Download RC artifacts from GitHub Release; SHA-256 verify.
3. Walk the 11 Windows rows; capture evidence into `docs/manual-smoke-v0.1.0.md`.

*Linux (Hyper-V Ubuntu 22.04, ~half day):*
1. Fresh VM snapshot. Install dependencies per README.
2. Install `.deb`; confirm systemd user unit + libsecret.
3. Walk 11 Linux rows. AppImage rows use separate user profile.
4. Capture screenshots / logs.

*macOS (Scaleway M1 rental, ~half day + ~$3–5):*
1. Provision instance. SSH + Screen Sharing via VNC-over-SSH.
2. Download artifacts; right-click-Open the `.app`; capture Gatekeeper prompt.
3. Walk 11 macOS rows.
4. Deprovision.

**Evidence:**
- Screenshots → `docs/screenshots/v0.1.0/<os>/<row-N>.png` (committed, compressed).
- Logs → `docs/release/v0.1.0-verification-logs/<os>/row-N.log` (committed).
- `docs/manual-smoke-v0.1.0.md` single table: ✅ + evidence path per row.

**Stringency rows** (beyond the 11-per-OS core matrix):
- Multi-agent: 3 parallel sub-agents cannot bypass HITL — dedicated fixture query.
- `enforce_air_gap = true` → zero outbound HTTP — verify via tcpdump/packet capture.
- LAN pairing: 5-minute window closes; 3-failed-attempts lockout.

**Failure handling:** any failing cell → GitHub issue tagged `v0.1.0-blocker` → fix lands on `main` via PR → **a new RC tag (S13 iteration `rc{N+1}`) MUST be cut and the full S13 verification re-run** → only then S14 restarts from row 1. No partial credit; verification must be on the new immutable artifact set, not on patched-locally builds.

**Acceptance criteria:**
- Every one of 30 cells + 3 stringency verifications has ✅ + evidence path.
- `docs/manual-smoke-v0.1.0.md` committed with all evidence.
- Screenshots in `docs/screenshots/v0.1.0/` referenced from README.

**Branch:** `dev/asafgolombek/phase4-s14-verification-evidence` (evidence only — no code).
**Effort:** 2–3 days focused + buffer.

---

### Section 15 — Tag `v0.1.0`: Ship

**Objective:** Cut the real release, publish every distribution channel in order, close Phase 4.

**Pre-flight (5 min):**
- Confirm all S14 checkboxes green.
- Confirm `main` has no commits since the verified RC. If so, cut new RC first.

**Tag sequence — strict order, manual steps:**

1. Push `v0.1.0` from `main`. `release.yml` runs. Click Approve on `release` environment. Artifacts build + upload as non-prerelease GitHub Release.
   - Release body: hand-curated feature summary (from CHANGELOG), per-OS install instructions, SHA-256 / GPG / Ed25519 fingerprints, signing-key download link, unsigned-preview note, upgrade path, known issues.
2. Verify GitHub Release SHA-256s match Section 14 evidence exactly. If not, something non-deterministic in build → full blocker, do not ship.
3. Push `vscode-v0.1.0`. `publish-vscode.yml` runs. Approve → publishes to VS Code Marketplace + Open VSX.
   - Verify both Marketplace pages show correct version + README.
4. Push `client-v0.1.0` if client version bumped in lockstep. `publish-client.yml` → npm.
   - Verify `npm view @nimbus-dev/client`.
5. SDK — Plugin API v1 frozen at v1.0.0; confirm no re-tag needed.
6. Docs site — `deploy-docs.yml` runs; verify Cloudflare Pages URL reflects v0.1.0.

**Post-ship housekeeping (same PR or `chore` PR):**
- `CLAUDE.md`: status → "Phase 4 ✅ Complete; Phase 5 Planned."
- `GEMINI.md` mirror.
- `docs/roadmap.md`: Phase 4 ✅; Phase 5 next.
- Close Phase 4 GitHub Project / Milestone.
- Open `v0.2.0` milestone with deferred items: Apple Developer enrollment, EV Authenticode procurement, mDNS host discovery, explicit Cursor verification lane.

**Announcement drafts (committed but not auto-posted):**
- `docs/release/hn-draft.md` — Show HN text.
- Social drafts (X / Mastodon / LinkedIn) in same file.
- Dev.to / blog post draft.
- User chooses posting timing.

**Acceptance criteria:**
- `https://github.com/<org>/nimbus/releases/tag/v0.1.0` exists, non-prerelease, all artifacts + signatures.
- `https://marketplace.visualstudio.com/items?itemName=nimbus-dev.nimbus` live.
- `https://open-vsx.org/extension/nimbus-dev/nimbus` live.
- `https://www.npmjs.com/package/@nimbus-dev/client` (if bumped) shows 0.1.0.
- `main` status reflects Phase 4 complete.
- `v0.2.0` milestone opened with carried-forward items.
- `docs/release/v0.1.0-ship-log.md` (optional) records environment approvals + publish sequence.

**Branch:** post-ship housekeeping on `dev/asafgolombek/phase4-s15-post-ship-housekeeping`.
**Effort:** 1–2 days.

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Windows SmartScreen hard-blocks very-low-reputation unsigned binary | Medium | High (can't ship on Windows) | S13 decision point: procure EV cert or ship Windows-from-source. Budget 1–2 weeks buffer. |
| Apple Gatekeeper message scares early adopters off | Medium | Medium (adoption drag, not block) | Clear README banner; optional QuickTime walkthrough video in announcement. |
| `registry.nimbus.dev` GPG sig verification rejects legit index after key rotation | Low | Medium (Marketplace breaks) | `SIGNING-KEY-ROTATION.md` documents dual-sign overlap procedure before key retirement. |
| Ed25519 private key leakage via GHA secret | Very Low | Critical (attacker could ship malicious update) | Key rotation playbook; dev-key-override path detects if embedded key regressed to dev value. |
| Open VSX or VS Code Marketplace policy rejection of publisher or extension | Low | Medium | Ship `.vsix` from GitHub Release as a fallback install path; document in README. |
| Scaleway M1 rental unavailable when needed | Low | Low (reschedule) | MacinCloud as secondary; budget for one full-day monthly rental as fallback. |
| RC iterations exceed ~3 — reveals deeper pipeline issue | Low | Medium | Plan embeds three-RC sanity check; escalate to pipeline-review block if hit. |
| A.2 expression language proves insufficient once users try it | Medium | Low (can extend later) | Strict subset chosen deliberately; post-v0.1.0 enhancement noted in v0.2.0 milestone. |
| Tauri build toolchain breaks on `macos-14` runner between RC and real release | Low | High | Pin `tauri-cli` + Rust toolchain versions in `release.yml`; smoke after every Tauri-CLI point upgrade. |
| `nimbus.dev` unavailable, premium-priced (>$100/yr), or hijacked on secondary market | Low | Medium (rename tech debt) | S0 first action is WHOIS check; pre-approved fallback domain choices documented in `docs/release/v0.1.0-prerequisites.md` (e.g., `getnimbus.dev`, `nimbus.tools`); rename burden bounded — `rg -l 'nimbus\.dev'` lists all references in advance. |
| Cursor's bundled VS Code API trails the engine pin in extension manifest | Medium | Medium (silent install failure on Cursor) | S9 explicit verification step pins `engines.vscode` to `min(current Cursor stable, 1.90)`; PR description records the verified version; CI-side `vsce ls --tree` smoke against a Cursor-equivalent older API surface. |

---

## 8. Post-v0.1.0 Backlog

Items explicitly deferred out of v0.1.0 and carried into the `v0.2.0` milestone:

- Apple Developer ID enrollment + notarization of macOS `.app` / `.pkg`.
- Windows EV Authenticode cert + signtool integration in `release.yml`.
- mDNS host discovery for LAN pairing.
- Dedicated Cursor verification lane (separate row per OS).
- Marketplace post-install "first auth" onboarding step.
- VS Code extension Ask response in webview panel (v0.1.0 uses editor tab).
- A.x further automation enhancements (function calls in expressions, richer condition operators).
- Homebrew + winget package distribution.
- Mobile companion app exploration (Phase 8 territory — noted here because users will ask).

---

## 9. Estimation Summary

| Section | Effort | Cumulative |
|---|---|---|
| S0 Procurement | 3–5 days wall-clock | 5 days |
| S1 WS5-C merge | 1–2 days | 7 days |
| S2 A.1 graph watchers | 3–4 days | 11 days |
| S3 A.2 workflow branching | 4–5 days | 16 days |
| S4 Marketplace UI | 5–6 days | 22 days |
| S5 Watchers UI | 6–7 days | 29 days |
| S6 Workflows UI | 8–10 days | 39 days |
| S7 TUI framework | 5–6 days | 45 days |
| S8 TUI HITL + history | 4–5 days | 50 days |
| S9 VS Code scaffold | 6–7 days | 57 days |
| S10 VS Code depth + publish | 6–8 days | 65 days |
| S11 Release hardening | 4–5 days | 70 days |
| S12 Docs audit | 2–3 days | 73 days |
| S13 RC iteration | 2–4 days | 77 days |
| S14 Manual verification | 2–3 days | 80 days |
| S15 Tag + publish | 1–2 days | 82 days |

**Total: ~62–82 working days** at serial fine-grained pace (low–high sum across all sections, including the S6 Mermaid uplift). Real-world calendar with reviews, rework, procurement latency, and occasional context switches: **~4–5 months**.

---

## 10. Next Step

On approval of this spec, invoke the `superpowers:writing-plans` skill to create the first per-section implementation plan (Section 0 — Procurement Kickoff, or Section 1 — WS5-C Merge, depending on which track you want to start first). Subsequent plans are written one section at a time as earlier sections close.
