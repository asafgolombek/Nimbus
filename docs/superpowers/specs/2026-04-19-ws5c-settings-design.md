# WS5 Sub-project C — Settings (Design)

> **Status:** Approved design · Gateway IPC plumbing ✅ complete · UI implementation pending
> **Parent specs:** [WS5-A app-shell foundation](./2026-04-19-ws5a-app-shell-foundation-design.md) · [WS5-B Dashboard & HITL](./2026-04-19-ws5b-dashboard-hitl-design.md)
> **Related plan:** [WS5-C Gateway IPC plumbing](../plans/2026-04-19-ws5c-gateway-ipc-plumbing.md) — delivered the entire §3 method surface.
> **Feature branch:** `dev/asafgolombek/phase_4_ws5` (umbrella). The single WS5-C UI PR targets this branch; it merges to `main` once WS5 (A–D) is complete.
> **Non-negotiables reminder:** No `any` types (use `unknown`), Windows/macOS/Linux parity, AGPL-3.0 for `packages/ui`, HITL is structural, no `vault.*` / raw `db.*` writes from the frontend.
>
> **2026-04-20 refinement:** IPC plumbing shipped; this spec was patched to reflect shipped method/notification shapes, add two small Gateway additions required for the Connectors panel (§2.4), and collapse the delivery breakdown to a single PR (§7). The previous §7 plan-writing checklist was removed — every item resolved.

---

## 1. Overview & goals

Phase 4 Workstream 5 delivers the Tauri desktop application in sub-projects. WS5-A shipped the app shell, system tray, Quick Query popup, onboarding wizard, and IPC bridge (6-method allowlist). WS5-B added the Dashboard, HITL popup, tray health aggregation, and grew the allowlist to 10. WS5-C delivers the Settings surface — seven panels covering every Phase 4 subsystem that has user-tunable state.

### 1.1 Deliverables

1. **Sidebar "Settings" entry** → `/settings` → auto-redirects to `/settings/model`.
2. **Seven nested panels**, each its own `lazy()`-loaded route component:
   - **Model** — installed LLMs, default picker per task type, router status, "Pull new model…" dialog with streamed progress.
   - **Connectors** — per-connector sync interval, depth (`metadata_only` / `summary` / `full`), enable toggle.
   - **Profiles** — active chip, create / switch / delete named profiles.
   - **Audit** — virtualized list with filters, "Verify chain" (non-blocking, toast result), export to JSON.
   - **Data** — export (passphrase + BIP39 seed modal), import (passphrase or seed), GDPR delete with preflight.
   - **Telemetry** — toggle, counter cards, payload sample expander.
   - **Updates** — check / download / apply with reconnect overlay; rollback surface when applicable.
3. **Nav chrome** — `SettingsSidebar` component (vertical left column) rendering `<Outlet />`.
4. **ALLOWED_METHODS additions** — 12 read + 15 write methods (net +27 → 37 total).
5. **Deep-link entry points** — Dashboard's degraded connector tile links to `/settings/connectors?highlight=<service>`; WS5-A offline banner deep-links to `/settings/updates` when an update is the proximate cause.
6. **Gateway-offline handling** — every panel renders cached data with a `StaleChip`; write controls disabled.

### 1.2 Non-goals (explicitly deferred)

- **Vault panel** — listing keys without values is a convenience; not a v0.1.0 gate. Deferred to WS5-D.
- **Voice panel** — WS2 is complete server-side but UI is low-priority until TUI / VS Code paths land.
- **LAN panel** — pairing UX (QR codes, peer management) benefits from a dedicated sub-project.
- **Advanced panel** — config-file-editable keys (`enforce_air_gap`, loop caps) stay CLI/YAML for v0.1.0.
- **Multi-selection bulk ops** in any list (audit, connectors).
- **Real-time collaboration / sync** across panels.
- **Agent surfaces** — sub-task plan viewer, multi-agent decomposition inspector (WS5-D).
- **Operation-handle-based resumable exports / imports** — if Gateway `data.*` methods run-to-completion in a single RPC, a gateway kill mid-export means the user starts over. Adding operation handles is deferred.
- **Automated three-OS E2E for data export → import round-trip** — lives in the manual smoke checklist; automating it requires ephemeral Vault fixtures per OS (WS5-D territory).

### 1.3 Success gates

- Each of the seven panels reachable via deep link within 2 s of route entry on all three OSes.
- No `vault.*` / `db.*`-write method enters `ALLOWED_METHODS`.
- `packages/ui` coverage ≥ 80 % lines / ≥ 75 % branches (unchanged from WS5-B).
- Updater flow: check → download → apply → socket reconnect → version verification → success toast.
- Data export on a populated index produces a verifiable `.tar.gz`; import on a clean machine restores full state.
- WS5-A and WS5-B smoke checklists (Quick Query, onboarding, offline banner, macOS accessory mode, Dashboard, HITL popup, tray) continue to pass unchanged.

---

## 2. Architecture & files

Additive over WS5-A/B. Three-layer split matches prior sub-projects: TypeScript/React, Rust bridge allowlist, shared IPC contract. No files deleted.

### 2.1 TypeScript / React — `packages/ui/src/`

**New route + layout:**

- `pages/Settings.tsx` — shell with `<SettingsSidebar />` + `<Outlet />`; sub-nav state reads `useLocation()`.
- `components/settings/SettingsSidebar.tsx` — vertical nav (7 entries + future-reserved items shown as disabled with a "coming soon" chip).
- `components/settings/PanelHeader.tsx` — shared title + description + optional live-status pill.
- `components/settings/PanelError.tsx` — retry state when a panel's query fails.
- `components/settings/StaleChip.tsx` — "Stale · gateway offline" tag, patterned on Dashboard.

**Panel pages** (each `lazy()`-loaded):

- `pages/settings/ModelPanel.tsx` — installed list, default picker (per task type), router status card, "Pull new model…" button.
- `components/settings/model/PullDialog.tsx` — searchable list, streamed progress bars, cancel, provider filter (Ollama vs llama.cpp).
- `components/settings/model/RouterStatus.tsx` — four task-type badges (`classification`, `embedding`, `reasoning`, `generation`) with resolved model + reason.
- `pages/settings/ConnectorsPanel.tsx` — per-connector row: name, health dot, sync-interval editor (number + unit select), depth selector, enable/disable toggle.
- `pages/settings/ProfilesPanel.tsx` — list, active-profile chip, "Create…" dialog (name only), row actions (Switch, Delete); typed-name confirmation for delete.
- `pages/settings/AuditPanel.tsx` — virtualized list (react-window), filter controls (service, outcome, date range), "Verify chain" button, "Export…" button (native save dialog).
- `pages/settings/DataPanel.tsx` — three cards: Export, Import, GDPR delete.
- `components/settings/data/ExportWizard.tsx` — passphrase entry → path save dialog → progress bar → recovery-seed modal ("write this down" + copy + typed confirmation).
- `components/settings/data/ImportWizard.tsx` — path open dialog → passphrase-or-seed entry → progress bar → result summary.
- `components/settings/data/DeleteServiceDialog.tsx` — service dropdown → preflight counts → typed-service-name confirmation.
- `pages/settings/TelemetryPanel.tsx` — toggle, counter cards (events sent, bytes, last flush), "View payload sample" expander.
- `pages/settings/UpdatesPanel.tsx` — current version, channel, "Check now" button, available-update card (release notes + "Download" → "Apply"), "Restarting Nimbus…" overlay, rollback button when previous install failed.

**Store slices** (added to `store/slices/`):

- `settings.ts` — active panel route, last-visited timestamp per panel, transient dialog open state.
- `model.ts` — installed models, pull progress map keyed by `modelId`, router status snapshot.
- `updater.ts` — current version, manifest status, download progress, apply state (`idle` / `downloading` / `verifying` / `applying` / `reconnecting` / `rolled-back`).

**Hooks:**

- Reuse `useIpcQuery` + `useIpcSubscription` from WS5-B.
- New `useConfirm` — typed-confirmation modal primitive shared by delete flows.

**Routing** — `App.tsx` gets a nested route block:

```
/settings                   → redirect → /settings/model
/settings/model
/settings/connectors
/settings/profiles
/settings/audit
/settings/data
/settings/telemetry
/settings/updates
```

### 2.2 Rust — `packages/ui/src-tauri/src/`

- `gateway_bridge.rs` — extend `ALLOWED_METHODS` with the new read/write methods (enumerated in §3).
- `updater.rs` *(new)* — listens for `ipc://disconnected` during the `applyUpdate` window and emits `updater://restart-started` / `updater://restart-complete` / `updater://restart-timeout` events for the UI overlay.
- No new Tauri windows, no tray additions.

### 2.3 Shared IPC contract — `packages/ui/src/ipc/`

- `types.ts` — add `LlmModelInfo`, `PullProgress`, `RouterStatus`, `ConnectorConfig`, `ProfileSummary`, `AuditQueryFilter`, `AuditExportFormat`, `ExportProgress`, `ImportProgress`, `UpdaterStatus`, `UpdateManifest`, `UpdaterState`.
- `client.ts` — add typed wrappers for each new method (one function per IPC method, same pattern as WS5-B).

### 2.4 Gateway — `packages/gateway/src/`

The WS5-C Gateway IPC plumbing plan (merged on `dev/asafgolombek/phase_4_ws5`) shipped every §3 method. Two small additions remain — required by the ConnectorsPanel — and land as the **first commit** of the single WS5-C UI PR:

1. **`connector.setConfig` accepts optional `depth`** — extend the handler in `packages/gateway/src/ipc/connector-rpc-handlers.ts` to pass `depth: "metadata_only" | "summary" | "full"` through to the existing connector manager (depth is already a connector-config field; only the IPC surface lacks it). Param becomes `{ service, intervalMs?, depth?, enabled? }` — partial update, all writable fields optional.

2. **`connector.configChanged` notification emitted** — after any successful `setConfig` / `pause` / `resume` / `setInterval`, the Gateway broadcasts `connector.configChanged { service, intervalMs, depth, enabled }`. Enables the Connectors panel to reconcile state when another client (CLI, second UI window) changes config. Unit-tested at the dispatcher level alongside `setConfig`.

No other Gateway code is touched by WS5-C.

---

## 3. IPC contract & `ALLOWED_METHODS` additions

WS5-B's allowlist holds 10 methods. WS5-C adds 12 read + 15 write methods → allowlist grows to **37**. All methods shipped on the `dev/asafgolombek/ws5c-gateway-ipc` branch and are verified against `packages/gateway/src/ipc/` as of 2026-04-20.

### 3.1 Read methods (12)

| Method | Panel | Purpose |
|---|---|---|
| `llm.listModels` | Model | installed models + task-type defaults |
| `llm.getRouterStatus` | Model | current routing decisions per task type |
| `connector.listStatus` | Connectors | reused from WS5-B — returns `SyncStatus[]` including interval, depth, enabled |
| `profile.list` | Profiles | profile summaries + active |
| `audit.getSummary` | Audit | counts by outcome/service for filter chips |
| `telemetry.getStatus` | Telemetry | enabled state + counters |
| `updater.getStatus` | Updates | current version, channel, last check |
| `updater.checkNow` | Updates | manifest fetch (user-triggered) |
| `data.getExportPreflight` | Data | last-export timestamp, estimated size |
| `data.getDeletePreflight` | Data | per-service row / secret counts |
| `audit.verify` | Audit | fires the verify walk (result delivered as toast) |
| `diag.getVersion` | Updates | post-reconnect version check after `applyUpdate` |

(`audit.list` is already in the WS5-B allowlist and is reused here unchanged.)

### 3.2 Write methods (15)

| Method | Panel | Gate |
|---|---|---|
| `llm.pullModel` | Model | confirmation dialog + progress stream |
| `llm.loadModel` | Model | none (reversible) |
| `llm.unloadModel` | Model | none |
| `llm.setDefault` | Model | none |
| `connector.setConfig` | Connectors | inline save with toast · param: `{ service, intervalMs?, depth?, enabled? }` (partial update) |
| `profile.create` | Profiles | dialog |
| `profile.switch` | Profiles | confirmation ("reloads UI") |
| `profile.delete` | Profiles | typed-name confirmation |
| `telemetry.setEnabled` | Telemetry | inline toggle |
| `data.export` | Data | passphrase modal + "I saved the seed" modal |
| `data.import` | Data | passphrase/seed modal + "replaces current data" confirmation |
| `data.delete` | Data | preflight + typed-service-name confirmation |
| `updater.applyUpdate` | Updates | "Nimbus will restart" confirmation |
| `updater.rollback` | Updates | confirmation |
| `audit.export` | Audit | native save dialog |

### 3.3 Notification streams consumed

| Event | Panel | Handler |
|---|---|---|
| `llm.pullProgress` | Model | update `pullProgress[pullId]` in store — payload: `{ pullId, provider, modelName, status, completedBytes?, totalBytes? }` |
| `llm.pullCompleted` | Model | clear `pullProgress[pullId]`, refetch `llm.listModels`, success toast |
| `llm.pullFailed` | Model | clear `pullProgress[pullId]`, error toast carrying `error` field |
| `llm.modelLoaded` / `llm.modelUnloaded` | Model | patch `isLoaded` on the matching row in store |
| `data.exportProgress` | Data | update export progress bar — payload: `{ stage, bytesWritten, totalBytes }` |
| `data.exportCompleted` | Data | drive wizard's final step (seed modal) instead of waiting on RPC response |
| `data.importProgress` | Data | update import progress bar — payload: `{ stage, bytesRead, totalBytes }` |
| `data.importCompleted` | Data | drive wizard success toast + auto-trigger restart sequence (§4.2) |
| `updater.updateAvailable` | Updates | surface banner on app start (app-wide via store) |
| `updater.downloadProgress` | Updates | download progress bar — payload: `{ bytes, total }` |
| `updater.restarting` | Updates | **explicit** transition to reconnect overlay — see §4.3 |
| `updater.rolledBack` | Updates | surface rollback toast — payload: `{ reason: "download_failed" \| "hash_mismatch" \| "signature_invalid" \| "installer_failed" }` |
| `connector.configChanged` | Connectors | optimistic-update reconciliation (Gateway emit added per §2.4) |
| `profile.switched` | Profiles | trigger UI reload — replaces the optimistic reload timer referenced in §5.2 |

### 3.4 Hard forbiddens (unchanged)

- **No `vault.*` method of any kind.** Vault-key listing (read-only convenience) is deferred with the Vault panel to WS5-D.
- **No raw `db.*` write method.** `data.delete` is the GDPR-scoped delete; it's a domain-level operation.
- **No `shell.execute` calls.** Updater restart is handled by the Gateway itself; Tauri reconnects when the socket returns.

---

## 4. Security-sensitive data flows

The Data panel and the Updater are the two flows that warrant explicit state-machine treatment.

### 4.1 Export flow

```
[Export card: "Last export: never | <timestamp>"]
   │
   ▼ click "Export backup…"
[Step 1: Scope dialog]  ─── include index? yes/no  ── cancel ──▶ abort
   │ continue
   ▼
[Step 2: Passphrase dialog]  ── 2× masked inputs, min 12 chars, zxcvbn strength meter
   │ confirm
   ▼
[Step 3: Destination]  ── Tauri native save dialog (.tar.gz filter)
   │
   ▼
[IPC: data.export { path, passphrase, includeIndex }]  ←── passphrase transits IPC in-memory only
   │
   ├─── notification: data.exportProgress { bytesWritten, totalBytes, stage }
   ▼
[Step 4: Recovery seed modal]
   - 12-word BIP39 seed displayed on gray background
   - "Copy" button (writes to clipboard, auto-clears after 30 s via Tauri clipboard plugin)
   - Checkbox: "I have stored this seed somewhere safe"
   - "Done" button disabled until checkbox ticked
   - Modal is non-dismissable (no X, no backdrop-close); only "Done" closes it
   │
   ▼
[Toast: "Backup saved to <path>"]
```

**Passphrase handling:**

- Stored in React state only, never logged.
- Cleared on dialog unmount via `useEffect` return.
- Never written to Zustand (avoids persistence-middleware exposure).
- IPC wrapper redacts `passphrase` field in any error thrown (extend `parseError`).

### 4.2 Import flow

```
[Import card]
   │ click "Restore backup…"
   ▼
[Step 1: File picker]
   │
   ▼
[Step 2: Auth method radio]  ── passphrase | recovery seed
   │
   ▼
[Step 3: Auth entry]
   │ passphrase: 1× masked input
   │ seed: 12-word BIP39 entry grid (each word validated against wordlist on blur)
   │
   ▼
[Step 4: Big red confirmation]
   "This will replace your current index and vault. Continue?"
   typed confirmation: "replace my data"
   │
   ▼
[IPC: data.import]  ─── notification: data.importProgress
   │
   ▼ on success
[Toast: "Restore complete. Nimbus will restart to finalize."]
   → auto-triggers gateway restart sequence (same overlay as §4.3)
```

### 4.3 Updater apply flow

```
idle ──check──▶ checking ──manifest──▶ up-to-date
                              │
                              ▼ update available
                            available ──download──▶ downloading
                                                        │
                                                        ▼
                                                   verifying (Ed25519)
                                                        │ ok
                                                        ▼
                                                    verified ──apply──▶ applying
                                                                            │
                                                                            ▼ notification: updater.restarting { fromVersion, toVersion }
                                                                            │
                                                                            ▼ UI overlay:
                                                                         "Restarting Nimbus — up to 30 seconds"
                                                                            │
                                                                            ▼ [socket disconnects, then reconnects]
                                                                            │
                                                                            ▼ diag.getVersion → matches toVersion?
                                                                            │  no
                                                                            ├──▶ rolled-back + rollback toast
                                                                            │  yes
                                                                            ▼
                                                                         success toast
```

Reconnect logic already exists in `gateway_bridge.rs` for generic disconnect. WS5-C adds:

- The overlay is triggered by the **`updater.restarting`** notification, not by raw socket disconnect — this fires before the socket closes, avoiding the 1–2 s gap where the UI would otherwise look frozen.
- A post-reconnect **version check** (`diag.getVersion`) on the next connect after state `applying`; the expected version is `toVersion` from the `updater.restarting` payload.
- A **2-minute timeout** on `applying` → `reconnecting`: if socket never returns, surface "Gateway failed to restart — try `nimbus start` in terminal".

### 4.4 GDPR delete flow

```
[Delete service data]
   │
   ▼ pick service (dropdown of configured connectors)
[IPC: data.getDeletePreflight { service }]
   │
   ▼
[Preflight card: "Deletes 1,247 items, 3 vault keys, 89 embeddings"]
   │
   ▼ typed confirmation: exact service name, e.g., "github"
[IPC: data.delete { service, confirm: true }]
   │
   ▼
[Toast: "Deleted. Audit entry: data.delete#<id>"]
   → audit feed refreshes, showing the delete row
```

---

## 5. Error handling & offline behavior

### 5.1 Error categories

| Category | UI treatment | Examples |
|---|---|---|
| Gateway disconnected | `StaleChip` on data; write buttons disabled; WS5-A amber banner visible | any panel during gateway kill |
| Read failure | `PanelError` with retry; last-known data shown below if cached | `llm.listModels` rejects |
| Write failure | Inline error on triggering control + toast with IPC error code | `data.export` rejects mid-stream |
| Validation failure | Inline field error; submit disabled | passphrase too short, mnemonic word invalid |
| Destructive confirmation miss | Dialog stays open; typed-input shows "doesn't match" | typed `github ` instead of `github` |
| Method-not-allowed | Dev-only red banner (indicates coding bug — shouldn't reach prod) | frontend calls a method missing from `ALLOWED_METHODS` |

### 5.2 Panel-specific failure modes

- **Model pull fails mid-stream** — partial download cleanup is the Gateway's job; UI shows error toast with `modelId` and clears the `pullProgress` entry. Re-pull is idempotent.
- **Model load fails** — router falls back; panel shows last successful load state with a warning pill ("Using fallback: <name>").
- **Export aborted** — partial `.tar.gz` left at destination; UI warns "Partial file at <path> — delete it before retrying". No auto-cleanup (Tauri shouldn't touch user-chosen paths).
- **Import archive tampered (BLAKE3 mismatch)** — import dialog shows a red "Archive failed integrity check" state; no destructive action taken; no retry prompt (archive is unusable).
- **Updater signature verify fails** — "Update rejected: signature invalid. Your Nimbus is safe." + "Report issue" link; no retry button.
- **Updater socket never returns** — after 2 min in `applying`, overlay transitions to error state: "Gateway failed to restart. Run `nimbus start` in terminal, then reload this window." `cmd+R` / `ctrl+R` reloads the UI.
- **Data.delete fails after partial delete** — atomicity is the Gateway's responsibility (transaction). If `data.delete` returns error, no audit row appears and UI shows "Delete failed — data unchanged".
- **Profile.switch in-flight** — disable other profile actions until response returns; on success the whole UI reloads (profile switch changes the Vault key prefix, invalidating cached state).

### 5.3 Offline behavior

Every panel handles `ConnectionState.disconnected`:

- Cached read data stays visible with `StaleChip`.
- All write controls disabled with a tooltip "Gateway offline".
- In-flight write call cancelled via `AbortController` when possible; otherwise the error toast surfaces on reconnect if the Gateway never acknowledged.
- Pull / export / import / apply in progress: the client-side progress bar freezes; on reconnect the status is re-queried. If `data.export` / `data.import` do not return operation handles, a gateway kill mid-export means "start over" — this is accepted for v0.1.0 and documented as a non-goal (§1.2).

### 5.4 Security-failure user messaging

Goal: never leak internal detail into user-facing error text. IPC `parseError` helper already redacts `passphrase`, `seed`, `accessToken`, `refreshToken`; WS5-C extends with `privateKey`, `mnemonic`, and `encryptedVaultManifest`. Unit test asserts each redaction.

---

## 6. Testing strategy

WS5-B's coverage baseline (Vitest ≥ 80 % lines / ≥ 75 % branches) carries forward. No new test tool added.

### 6.1 Unit tests (Vitest) — must-have

| File under test | Test file | Priority behaviours |
|---|---|---|
| `ModelPanel.tsx` | `model-panel.test.tsx` | renders installed list; default picker fires `setDefault`; "Pull…" opens dialog |
| `PullDialog.tsx` | `pull-dialog.test.tsx` | progress bar reacts to streamed `pullProgress`; cancel fires `llm.cancelPull`; error state on failure; provider filter honors `llm.getStatus` availability map |
| `ConnectorsPanel.tsx` | `connectors-panel.test.tsx` | interval edit debounces + persists via `setConfig`; offline disables controls |
| `ProfilesPanel.tsx` | `profiles-panel.test.tsx` | create dialog validates name uniqueness; delete requires typed confirmation |
| `AuditPanel.tsx` | `audit-panel.test.tsx` | filter chips narrow list; verify toast fires on success and failure; export triggers save dialog |
| `DataPanel.tsx` | `data-panel.test.tsx` | three cards render; export preflight surfaces last-export timestamp |
| `ExportWizard.tsx` | `export-wizard.test.tsx` | passphrase strength meter; seed modal non-dismissable; "I saved it" checkbox required |
| `ImportWizard.tsx` | `import-wizard.test.tsx` | BIP39 word validation per cell; typed-replace confirmation required |
| `DeleteServiceDialog.tsx` | `delete-service-dialog.test.tsx` | preflight loads; typed service name required |
| `TelemetryPanel.tsx` | `telemetry-panel.test.tsx` | toggle flips state; counters render |
| `UpdatesPanel.tsx` | `updates-panel.test.tsx` | each state in the machine renders the right card; reconnect-timeout triggers error state |
| `useConfirm.ts` | `use-confirm.test.tsx` | resolves on confirm, rejects on cancel |
| `store/slices/model.ts` | `model-slice.test.ts` | pullProgress map upserts by modelId; router status replaces atomically |
| `store/slices/updater.ts` | `updater-slice.test.ts` | state machine transitions; invalid transitions ignored |
| `ipc/parseError.ts` | `parse-error-redaction.test.ts` | passphrase / seed / mnemonic / privateKey fields redacted |
| `gateway_bridge::ALLOWED_METHODS` | regression test asserting count + alphabetical order |

### 6.2 Bridge tests (Rust `#[test]`)

| Unit | Test |
|---|---|
| `gateway_bridge::ALLOWED_METHODS` | 27 new methods present; list is alphabetized |
| `updater.rs` | reconnect helper emits `restart-started` on disconnect during `applying`; emits `restart-complete` on reconnect within 2 min; emits `restart-timeout` after 2 min |

### 6.3 Manual smoke — `docs/manual-smoke-ws5c.md`

Follows the WS5-B template.

- Navigate Settings sidebar → each panel renders within 2 s of click.
- **Model**: pull a small model (`gemma:2b`) end-to-end, watch progress, cancel; load/unload; setDefault per task type; provider filter in Pull dialog honors `llm.getStatus` availability map (llama.cpp row hidden when provider unavailable).
- **Connectors**: edit sync interval, confirm next poll reflects new value.
- **Profiles**: create → switch → delete round-trip; UI reloads on switch.
- **Audit**: filter by outcome, verify chain, export to `.json`, re-open in a text editor.
- **Data**: export with passphrase, copy seed, import on a scratch directory; import with seed (no passphrase).
- **Telemetry**: toggle off; confirm `telemetry.events` counter freezes.
- **Updates**: force a fake manifest (env-var override) → check → apply → overlay → reconnect → success; force-fail reconnect → 2-min timeout error.
- **GDPR**: `data.delete --service filesystem` preflight, confirm, audit row appears.
- **Gateway-offline regression**: kill Gateway mid-panel, verify no panel crashes; on reconnect, panels refetch.

### 6.4 Explicitly not tested

- Real `codesign` / `notarytool` / `signtool` invocations (WS4 responsibility).
- Real Ollama pull bytes (we mock `llm.pullProgress` notifications).
- Rust Tauri windowing across OS (covered by WS5-A/B tray/window tests).
- Full automated export → import restore on three OS in CI (manual smoke; automating requires ephemeral Vault fixtures per OS — WS5-D territory).

### 6.5 Coverage gate

`packages/ui` Vitest ≥ 80 % lines / ≥ 75 % branches (unchanged from WS5-B). The two §2.4 Gateway additions ship with dispatcher-level unit tests and fold into the existing engine/config/connector coverage gates; no new `packages/gateway` threshold is added.

---

## 7. Delivery breakdown (PR shape)

**Single PR:** `dev/ws5c-ui` off `dev/asafgolombek/phase_4_ws5`. Commits are grouped by panel in increasing sensitivity order so review can proceed commit-by-commit even though the PR lands atomically:

1. **Gateway prerequisite** — `connector.setConfig` accepts `depth`; `connector.configChanged` emitted on mutations (§2.4). Unit tests added at the dispatcher level.
2. **Shell** — Settings route + `SettingsSidebar` + nested-route redirect + `settings.ts` store slice + IPC type additions in `packages/ui/src/ipc/types.ts` + `ALLOWED_METHODS` growth in `gateway_bridge.rs`.
3. **Profiles panel** — fully wired (list / create / switch / delete); consumes `profile.switched` for reload.
4. **Telemetry panel** — toggle + counters + payload sample expander.
5. **Connectors panel** — interval editor + depth selector + enable toggle; consumes `connector.configChanged`.
6. **Model panel** — installed list + default picker + router status + `PullDialog` with `llm.getStatus` provider filter and `cancelPull` button.
7. **Audit panel** — virtualized list + filter chips + `verify` toast + `export` save dialog.
8. **Updates panel** — state machine + `updater.restarting` overlay + reconnect + `diag.getVersion` check + rollback.
9. **Data panel** — ExportWizard + ImportWizard + DeleteServiceDialog (last because most security-sensitive; benefits from other panels' patterns being settled).
10. **Docs + smoke** — add `docs/manual-smoke-ws5c.md`; update `roadmap.md` WS5-C rows; update `packages/ui` coverage report if needed.

Vitest coverage stays ≥ 80 % lines / ≥ 75 % branches throughout; CI fails the PR if any commit regresses the gate.
