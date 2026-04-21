# WS5-C UI — Plan 5: Data panel + WS5-C wrap-up (Design)

> **Status:** Proposed design
> **Parent spec:** [WS5-C Settings](./2026-04-19-ws5c-settings-design.md) — §2.1, §3.1–§3.3, §4.1, §4.2, §4.4, §5.2, §7 (commits 10 + 11).
> **Feature branch:** `dev/asafgolombek/ws5c-ui` (continues after Plan 4). Closes WS5-C UI; PR opens against `dev/asafgolombek/phase_4_ws5` on merge of the final commit.
> **Non-negotiables reminder:** No `any` (use `unknown`); strict TS; no `vault.*` / raw `db.*` writes from the frontend; `passphrase`/`recoverySeed`/`mnemonic`/`privateKey`/`encryptedVaultManifest` never enter Zustand.

---

## 1. Overview & goals

Plan 5 completes WS5-C by wiring `/settings/data`, the last panel still rendering `PanelComingSoon`. It delivers the three wizards described by the parent spec — Export, Import, GDPR Delete — plus the WS5-C wrap-up: manual smoke checklist, roadmap row update, and CLAUDE/GEMINI status bumps that close out WS5-A/B/C and unblock the single WS5-C UI PR.

### 1.1 Deliverables

1. `pages/settings/DataPanel.tsx` replaces the `/settings/data` `PanelComingSoon` placeholder with a three-card panel (Export, Import, Delete).
2. `components/settings/data/ExportWizard.tsx`, `ImportWizard.tsx`, `DeleteServiceDialog.tsx` — three modal-style wizards orchestrated by `DataPanel`.
3. `store/slices/data.ts` — one new transient slice holding the three in-flight flow state machines and a `lastExportPreflight` cache for offline StaleChip.
4. Five new typed IPC wrappers in `packages/ui/src/ipc/client.ts`: `dataGetExportPreflight`, `dataGetDeletePreflight`, `dataExport`, `dataImport`, `dataDelete`.
5. Matching Vitest suite for every new file plus one regression test extending `store/partialize.ts` coverage.
6. `docs/manual-smoke-ws5c.md` — WS5-C manual smoke checklist consolidating coverage for all seven panels.
7. Roadmap, CLAUDE.md, GEMINI.md status row updates marking WS5-C ✅.
8. The final commit includes explicit `gh pr create` instructions targeting `dev/asafgolombek/phase_4_ws5`; PR body draft lives in the commit message.

### 1.2 Non-goals (explicitly deferred)

- Resumable export / import (no operation handles exposed by Gateway; spec §1.2 accepts "start over" as v0.1.0 posture).
- Automated round-trip export → import E2E on three OSes (manual smoke only; spec §6.4).
- `data.export`/`import` progress *value* accuracy beyond what Gateway emits (Gateway's progress framing is "best effort").
- Wallet-style seed recovery flow outside the Export path (if the user truly loses their seed, no in-UI recovery action in v0.1.0).
- Vault panel, Voice panel, LAN panel, Advanced panel — all deferred to WS5-D per parent spec §1.2.

### 1.3 Success gates

- `/settings/data` reachable in ≤ 2 s; three cards render on all three OSes.
- Export on a populated index produces a verifiable `.tar.gz`; import on a scratch machine restores full state (manual smoke).
- Zero new methods added to `ALLOWED_METHODS` (stays at 38) and `NO_TIMEOUT_METHODS` (stays at 4).
- Zero new Tauri plugins or capabilities (FS + dialog + clipboard-manager all installed in Plan 1 / granted in Plan 4).
- `packages/ui` coverage ≥ 80 % lines / ≥ 75 % branches (unchanged gate).
- Zustand persist whitelist stays at exactly 5 keys — regression test.
- `parseError` redaction list stays at 5 forbidden keys — already covered.

### 1.4 Planned divergence from parent spec

Parent spec §4.1 describes the recovery-seed modal as an unconditional non-dismissable gate on every export. That text predates the shipped Gateway wire shape: `data.export` now returns `recoverySeedGenerated: boolean` — `true` only on the first-ever export, `false` when reusing the existing seed. To avoid re-exposing the mnemonic on every subsequent export, Plan 5 branches the Step-4 UX:

- `recoverySeedGenerated: true` → full non-dismissable modal with BIP39 mnemonic, copy-with-countdown, typed-checkbox gate, `Done` button gated on checkbox. Matches parent spec §4.1 exactly.
- `recoverySeedGenerated: false` → small dismissable reminder card "Recovery seed unchanged — keep your saved copy safe." Does **not** re-render the mnemonic. `Done` immediately available. No "Show" toggle.

Rationale: the seed is the crown jewel. Re-displaying it unconditionally creates needless secret-exposure surface (screen recording, shoulder-surfers), and the performative typed-checkbox on every re-export conditions users to click through. Skipping the modal entirely would lose the safety nudge, so a light reminder — without re-rendering the secret — threads the needle.

---

## 2. Architecture & files

Pure UI-layer wiring. Zero Rust, zero Gateway, zero new dependencies.

### 2.1 Files created

| Path | Purpose |
|---|---|
| `packages/ui/src/store/slices/data.ts` | Transient Zustand slice: three flow state machines + preflight cache |
| `packages/ui/src/pages/settings/DataPanel.tsx` | Three-card panel orchestrating the wizards |
| `packages/ui/src/components/settings/data/ExportWizard.tsx` | 4-step export state machine |
| `packages/ui/src/components/settings/data/ImportWizard.tsx` | 4-step import state machine |
| `packages/ui/src/components/settings/data/DeleteServiceDialog.tsx` | 3-step delete dialog |
| `packages/ui/test/pages/settings/DataPanel.test.tsx` | Panel behavior tests |
| `packages/ui/test/components/settings/data/ExportWizard.test.tsx` | Wizard tests |
| `packages/ui/test/components/settings/data/ImportWizard.test.tsx` | Wizard tests |
| `packages/ui/test/components/settings/data/DeleteServiceDialog.test.tsx` | Dialog tests |
| `packages/ui/test/store/slices/data-slice.test.ts` | Slice reducer tests |
| `docs/manual-smoke-ws5c.md` | WS5-C manual smoke checklist (all 7 panels) |

### 2.2 Files modified

| Path | Change |
|---|---|
| `packages/ui/src/ipc/types.ts` | Append 9 new types (see §3.1) |
| `packages/ui/src/ipc/client.ts` | Append 5 typed wrappers (see §3.2) |
| `packages/ui/src/ipc/__mocks__/client.ts` | Mirror 5 new wrappers as `vi.fn()` exports |
| `packages/ui/src/store/index.ts` | Register `DataSlice` alphabetically adjacent to `dashboard` |
| `packages/ui/src/App.tsx` | Replace `<PanelComingSoon title="Data" />` at `/settings/data` with `lazy(() => import("./pages/settings/DataPanel"))` |
| `packages/ui/test/store/partialize.test.ts` | Extend forbidden-keys assertion to include `exportFlow`, `importFlow`, `deleteFlow`, `lastExportPreflight`, `passphrase`, `recoverySeed`, `mnemonic`, `privateKey`, `encryptedVaultManifest` |
| `docs/roadmap.md` | WS5-C row marked ✅ |
| `CLAUDE.md`, `GEMINI.md` | Phase-4 status line updated (WS5-A/B/C ✅) |

### 2.3 Files explicitly NOT touched

- `packages/ui/src-tauri/src/gateway_bridge.rs` — `ALLOWED_METHODS` stays at 38 (all five `data.*` shipped in earlier plans); `NO_TIMEOUT_METHODS` stays at 4 (`data.export` + `data.import` already members).
- `packages/ui/src-tauri/capabilities/default.json` — `fs:allow-write-text-file` granted by Plan 4; dialog + clipboard-manager plugins already initialized.
- `packages/ui/src/store/partialize.ts` — no new persisted fields; persist whitelist stays at 5 keys exactly.
- `packages/gateway/src/**` — `data.*` surface complete; stage-and-swap via `mkdtempSync` verified in `data-export.ts` and `data-import.ts`; `-32010 version_incompatible` wired via `DataImportVersionError`.
- `packages/ui/src/ipc/client.ts` `parseError` redaction list — all five forbidden keys already redacted at line 80-84.

### 2.4 Slice design

```ts
interface ExportFlowState {
  status: "idle" | "running" | "error";
  progress?: { stage: string; bytesWritten: number; totalBytes?: number };
  error?: string;
}

interface ImportFlowState {
  status: "idle" | "running" | "error";
  progress?: { stage: string; bytesRead: number; totalBytes?: number };
  error?: string;
}

interface DeleteFlowState {
  status: "idle" | "running" | "error";
  service?: string;
  error?: string;
}

interface DataSlice {
  exportFlow: ExportFlowState;
  importFlow: ImportFlowState;
  deleteFlow: DeleteFlowState;
  lastExportPreflight?: ExportPreflightResult;
  // setters omitted
}
```

All fields transient — no persistence. `lastExportPreflight` is a memory-only cache used to keep the Export card populated with a `StaleChip` during reconnect. Reset on reconnect so staleness never lingers past session.

---

## 3. IPC contract

### 3.1 New types (appended to `packages/ui/src/ipc/types.ts`)

```ts
export interface ExportPreflightResult {
  readonly lastExportAt: number | null;
  readonly estimatedSizeBytes: number;
  readonly itemCount: number;
}

export interface DeletePreflightResult {
  readonly service: string;
  readonly itemCount: number;
  readonly embeddingCount: number;
  readonly vaultKeyCount: number;
}

export interface DataExportResult {
  readonly outputPath: string;
  readonly recoverySeed: string;
  readonly recoverySeedGenerated: boolean;
  readonly itemsExported: number;
}

export interface DataImportResult {
  readonly credentialsRestored: number;
  /**
   * Count of OAuth entries present in the archive that were flagged as stale
   * and require re-authorization after import. Gateway populates this; UI
   * surfaces it in the success toast so the user knows to revisit Connectors.
   */
  readonly oauthEntriesFlagged: number;
}

/** Mirrors the Gateway's `DataDeletePreflight` from `packages/gateway/src/commands/data-delete.ts`. */
export interface DataDeletePreflight {
  readonly service: string;
  readonly itemsToDelete: number;
  readonly vecRowsToDelete: number;
  readonly syncTokensToDelete: number;
  readonly vaultEntriesToDelete: number;
  readonly vaultKeys: readonly string[];
  readonly peopleUnlinked: number;
}

/**
 * `data.delete` wire shape. `deleted === true` when a real deletion ran; `false` only
 * when the caller passed `dryRun: true` (which the UI never does — it calls
 * `data.getDeletePreflight` for previews). No audit id is surfaced on the wire;
 * the Gateway writes the audit row internally and the Dashboard feed discovers it
 * on its own poll.
 */
export interface DataDeleteResult {
  readonly preflight: DataDeletePreflight;
  readonly deleted: boolean;
}

export interface DataExportProgressPayload {
  readonly stage: string;
  readonly bytesWritten: number;
  readonly totalBytes?: number;
}

export interface DataImportProgressPayload {
  readonly stage: string;
  readonly bytesRead: number;
  readonly totalBytes?: number;
}

export interface DataImportCompletedPayload {
  readonly credentialsRestored: number;
}

export type DataImportVersionIncompatibleData = {
  readonly kind: "version_incompatible";
  readonly archiveSchemaVersion: number;
  readonly currentSchemaVersion: number;
  readonly relation: "archive_newer" | "archive_older_unsupported";
};
```

### 3.2 New wrappers (appended to `packages/ui/src/ipc/client.ts`)

```ts
dataGetExportPreflight(): Promise<ExportPreflightResult>;
dataGetDeletePreflight(args: { service: string }): Promise<DeletePreflightResult>;
dataExport(args: { output: string; passphrase: string; includeIndex: boolean }): Promise<DataExportResult>;
dataImport(args: { bundlePath: string; passphrase?: string; recoverySeed?: string }): Promise<DataImportResult>;
dataDelete(args: { service: string; dryRun: false }): Promise<DataDeleteResult>;
```

Each wrapper forwards named params as JSON-RPC params, applies a lightweight runtime shape-guard on the non-primitive result, and routes errors through the existing `parseError`.

### 3.3 Notifications consumed (already emitted by Gateway)

| Event | Payload type | Consumer |
|---|---|---|
| `data.exportProgress` | `DataExportProgressPayload` | `ExportWizard` → `slice.exportFlow.progress` |
| `data.exportCompleted` | `{ path: string, itemsExported: number }` | Informational only (export completion carries the seed and comes back via RPC result, not this notification) |
| `data.importProgress` | `DataImportProgressPayload` | `ImportWizard` → `slice.importFlow.progress` |
| `data.importCompleted` | `DataImportCompletedPayload` | Informational only — the terminal toast + reload is driven by the `dataImport` RPC's resolution value (which includes `oauthEntriesFlagged`). The notification is subscribed for robustness (e.g., logging) but not load-bearing. |

All four flow through the existing `gateway://notification` window-scoped channel — **no** new topic classifier entries.

### 3.4 Rust bridge — no changes

- `ALLOWED_METHODS` (count=38): `data.delete`, `data.export`, `data.getDeletePreflight`, `data.getExportPreflight`, `data.import` all present at `gateway_bridge.rs:74-78`.
- `NO_TIMEOUT_METHODS` (count=4): `data.export` and `data.import` members at `gateway_bridge.rs:115-116`.
- Existing regression tests (`ALLOWED_METHODS.len() == 38`, alphabetization, `NO_TIMEOUT_METHODS.len() == 4`) continue to pass without modification.

---

## 4. Component design

### 4.1 `DataPanel.tsx`

Three stacked cards inside the standard `PanelHeader` + `PanelError` frame.

- **Export card.** Header: "Back up your data". Body: `lastExportAt` as humanized timestamp (`null` → "Never") + estimated size. Button: `Export backup…` → opens `ExportWizard`.
- **Import card.** Header: "Restore from backup". Body: static explanation. Button: `Restore backup…` → opens `ImportWizard`.
- **Delete card.** Header: "Delete service data" + subtle warning chip. Body: short explanation. Button: `Delete service…` → opens `DeleteServiceDialog`.

Panel-level concerns:

- Preflight fetched once on mount via `useIpcQuery({ method: "data.getExportPreflight", interval: 0 })` (single-shot). Wizards refetch on open for freshness.
- Offline: all three buttons disabled with "Gateway offline" tooltip. `StaleChip` rendered on Export card if `lastExportPreflight` is cached.
- **Concurrent-flow guard:** while any flow is `status === "running"`, the other two cards render disabled with tooltip "An export / import / delete is already in progress."

### 4.2 `ExportWizard.tsx`

4-step internal state: `"scope" | "passphrase" | "destination" | "exporting" | "seed" | "done" | "error"`.

- **Step 1 · Scope.** Single toggle: "Include search index (.db)" (default on). Cancel | Next.
- **Step 2 · Passphrase.** Two masked inputs (passphrase + confirm). Live `zxcvbn` strength bar. Gate: `length ≥ 12 && passphrase === confirm && zxcvbn.score ≥ 2`.
- **Step 3 · Destination.** Tauri `plugin-dialog.save({ filters: [{ name: "Nimbus backup", extensions: ["tar.gz"] }] })`. On return, run `plugin-fs.exists(path)` — if true, render an inline overwrite-warn sub-step ("Overwrite `<filename>`?") before submit.
- **Apply.** Dispatch `slice.exportFlow = { status: "running" }`. Subscribe to `data.exportProgress` → `setExportProgress`. Call `dataExport({ output, passphrase, includeIndex })`. Progress bar reads from slice.
- **Step 4 · Seed modal** — branches on `recoverySeedGenerated`:
  - `true`: non-dismissable modal; mnemonic on gray background; `Copy` button triggers `plugin-clipboard-manager.writeText` and starts a 30-s auto-clear countdown ring (cancellable on modal close or re-copy); "I have stored this seed somewhere safe" required checkbox; `Done` button gated on checkbox.
  - `false`: small dismissable reminder card ("Recovery seed unchanged — keep your saved copy safe"); no mnemonic; `Done` immediately available.
- **Unmount cleanup.** `useEffect` return scrubs local `passphrase`, `confirm`, `recoverySeed` React state. Nothing sensitive enters the store slice beyond terminal status.

### 4.3 `ImportWizard.tsx`

4-step internal state: `"file" | "auth" | "confirm" | "importing" | "done" | "error"`.

- **Step 1 · File picker.** Tauri `plugin-dialog.open({ filters: [{ name: "Nimbus backup", extensions: ["tar.gz"] }] })`. Display chosen path.
- **Step 2 · Auth method.** Radio: `passphrase | recovery seed`. Exactly one is passed to the wire call.
  - Passphrase: single masked input.
  - Seed: 12-cell BIP39 grid; each cell validates against the BIP39 wordlist on blur (red outline + inline "not a BIP39 word" on invalid). Submit disabled until all 12 valid.
- **Step 3 · Big-red confirmation.** "This replaces your current index and vault." Typed-confirmation input requires exactly `replace my data`.
- **Apply.** Dispatch `slice.importFlow = { status: "running" }`. Subscribe to `data.importProgress`. Call `dataImport({ bundlePath, passphrase | recoverySeed })`.
- **Completion.** When the `dataImport` RPC resolves with `{ credentialsRestored, oauthEntriesFlagged }`: show toast "Restore complete. Reloading in 3 seconds…" with a secondary line "`<oauthEntriesFlagged>` OAuth connector(s) need re-authorization." when `oauthEntriesFlagged > 0`. After 3 s, call `window.location.reload()`. The `data.importCompleted` notification is treated as informational only; we rely on the RPC resolution for the terminal state so we have the fuller shape.
- **Errors.**
  - `-32010 version_incompatible`: terminal dialog with copy branching on `relation` (see §5).
  - `-32002 decryption_failed` (wrong passphrase/seed): inline error on auth step, path retained, retry allowed.
  - `-32003 integrity_failed` (BLAKE3 mismatch): terminal dialog "Archive is corrupt or tampered. No changes made."
- **Unmount cleanup.** Local passphrase + seed-word array scrubbed on unmount.

### 4.4 `DeleteServiceDialog.tsx`

3-step internal state: `"pick" | "preview" | "confirming" | "deleting" | "done" | "error"`.

- **Step 1 · Pick service.** Dropdown fed from `connector.listStatus` (reused from the Connectors slice — already in store). Filter to services with `status !== "not_configured"`.
- **Step 2 · Preview.** Call `dataGetDeletePreflight({ service })` → preflight card: "Deletes N items, M embeddings, K vault keys."
- **Step 3 · Typed confirmation.** Input requires exact match to selected service string (e.g., user must type `github` — trailing space fails).
- **Apply.** `dataDelete({ service, dryRun: false })` (explicit `false` for log clarity).
- **Completion.** Toast: "Deleted `<itemsDeleted>` items from `<service>`." (Count sourced from `result.preflight.itemsToDelete`, which equals the deleted count when `deleted === true`.) `DataPanel` refetches `getExportPreflight` (itemCount changed). Dashboard audit feed refreshes on its own poll and surfaces the new `data.delete` row — no client-side audit id plumbing.

---

## 5. Error handling

### 5.1 Error category matrix

| Category | Trigger | UI treatment | Recovery |
|---|---|---|---|
| Validation | zxcvbn < 2; passphrase mismatch; BIP39 word not in wordlist; typed-confirm mismatch | Inline field error + Submit disabled | User fixes input |
| Destination clash | `plugin-fs.exists(path)` returns true | Inline overwrite sub-step inside step 3 | Confirm overwrite → submit; Cancel → back to save dialog |
| Destination write denied | `dataExport` RPC rejects mid-stream with IO error | Wizard enters `step="error"` with copy "Could not write to `<path>`. Check permissions and try again." | Retry returns to step 3 |
| Export mid-stream abort | RPC rejects after progress fires | Error step: "Export failed. A partial file may exist at `<path>` — delete it before retrying." | No auto-cleanup (never touch user-chosen paths) |
| Wrong passphrase/seed on import | `-32002 decryption_failed` | Inline error on auth step, retains path | User re-enters |
| Archive integrity fail | `-32003 integrity_failed` (BLAKE3 mismatch) | Terminal dialog: "Archive is corrupt or tampered. No changes made." | No retry — archive unusable |
| Version incompatible | `-32010 { kind: "version_incompatible", archiveSchemaVersion, currentSchemaVersion, relation }` | Terminal dialog; copy branches on `relation` | `archive_newer` → "Update Nimbus, then retry." with deep-link to `/settings/updates`. `archive_older_unsupported` → "Backup is from an older, unsupported Nimbus. No migration path in v0.1.0." No retry. |
| Import mid-stream abort | RPC rejects after progress fires | Wizard: "Import failed — your data was not changed." (Gateway stage-and-swap guarantee) | Retry; if persistent, surface "Report issue" link |
| Delete preflight fails | `dataGetDeletePreflight` rejects | Inline error on step 2; retry button; back to step 1 | Retry or pick different service |
| Delete RPC fails | `dataDelete` rejects | Error step: "Delete failed — data unchanged." | Retry |
| Gateway disconnect mid-flow | Connection → `disconnected` during `status === "running"` | Wizard freezes progress bar: "Gateway disconnected — operation may be incomplete. Check audit log after reconnect." Close enabled. | On reconnect, audit feed reveals completion state |
| Method not allowed (dev-only) | `parseError` returns `method_not_allowed` | Dev-only red banner (coding bug) | Code fix |

### 5.2 User-facing copy principles

- No raw RPC codes surfaced to the user — each error category has a hand-written copy mapping.
- Terminal vs. recoverable: terminal errors show only "Close"; recoverable keep wizard state and offer "Retry".
- No blame language — "Could not …", "Archive is …" rather than "You entered …".
- Action link when safe — `archive_newer` links to `/settings/updates`.

### 5.3 Concurrent-flow guard

Derived from slice in `DataPanel.tsx`: while any flow is `running`, the other two cards render disabled with tooltip. Prevents sending a second destructive call mid-flight (Gateway would likely reject it; UI should never try).

### 5.4 Security invariants

- Passphrase, recovery seed, and BIP39 word entries live **only** in React local state inside wizard components; never passed to Zustand; never logged; scrubbed on unmount via `useEffect` return.
- IPC errors funnel through `parseError` before display (five forbidden keys already redacted at `client.ts:80-84`).
- Import auth radio ensures exactly one of `passphrase` / `recoverySeed` is passed to the wire call.
- Delete `Submit` is structurally disabled until typed-name input `===` selected service string.
- `dataDelete` always passes `dryRun: false` explicitly — never relies on default.

---

## 6. Testing strategy

Unchanged gate: `packages/ui` Vitest ≥ 80 % lines / ≥ 75 % branches.

### 6.1 Vitest files to add

| Subject | Test file | Priority behaviors |
|---|---|---|
| `DataPanel.tsx` | `test/pages/settings/DataPanel.test.tsx` | three cards render; preflight populates Export card; offline disables all buttons; `StaleChip` shows with cached preflight; concurrent-flow guard disables siblings during one flow `running` |
| `ExportWizard.tsx` | `test/components/settings/data/ExportWizard.test.tsx` | scope toggle; zxcvbn gate; overwrite sub-step from `plugin-fs.exists`; progress bar wired to `exportProgress`; seed modal branching on `recoverySeedGenerated`; clipboard 30-s countdown; unmount scrubs passphrase |
| `ImportWizard.tsx` | `test/components/settings/data/ImportWizard.test.tsx` | auth radio toggles input mode; BIP39 cell validation; typed `"replace my data"` gate; `-32010` terminal dialog with copy branch by `relation`; `-32002` inline retry; successful RPC resolution triggers 3-s toast containing `oauthEntriesFlagged` count when `> 0` and `window.location.reload` (mocked) |
| `DeleteServiceDialog.tsx` | `test/components/settings/data/DeleteServiceDialog.test.tsx` | dropdown filtered by connector status; preflight renders counts; typed service-name gate (trailing space fails); `dataDelete` called with explicit `dryRun: false`; success toast reads `"Deleted <itemsDeleted> items from <service>"` from `result.preflight.itemsToDelete`; handles `deleted: false` defensively (should not happen when we pass `dryRun: false`) |
| `store/slices/data.ts` | `test/store/slices/data-slice.test.ts` | state transitions monotonic; progress upserts; terminal states reset cleanly |
| `store/partialize.ts` | *extend existing test* | Assert `exportFlow`, `importFlow`, `deleteFlow`, `lastExportPreflight` absent; existing five-forbidden-keys assertion preserved |

### 6.2 Mock strategy

- Extend `packages/ui/src/ipc/__mocks__/client.ts` with five new `vi.fn()` entries — one per wrapper.
- Tauri plugins mocked via `vi.mock("@tauri-apps/plugin-dialog"|"-fs"|"-clipboard-manager")`. `plugin-fs.exists` defaults to `false`; override per test.
- Notifications faked via the existing `emitIpcNotification` helper used by Plan 4's tests.
- `window.location.reload` mocked via `vi.stubGlobal("location", { ...window.location, reload: vi.fn() })`.

### 6.3 Explicitly NOT tested

- Real export → import round-trip (manual smoke only; WS5-D territory).
- Actual disk-write behavior (stubbed at the Tauri FS boundary).
- Gateway `-32010` throwing path (covered in `packages/gateway/src/ipc/data-rpc.test.ts`).
- BIP39 wordlist correctness (library-level).
- `window.location.reload()` actually reloading — we assert the call, not the reload.

### 6.4 Rust bridge tests

**None to add.** All five `data.*` methods verified present in `ALLOWED_METHODS`; `data.export` + `data.import` verified present in `NO_TIMEOUT_METHODS`. Existing length/alphabetization regression tests cover these.

### 6.5 Manual smoke additions (`docs/manual-smoke-ws5c.md`)

Plan 5 creates this file — consolidating WS5-A + WS5-B + all seven WS5-C panels. Data-panel-specific steps:

1. Export with passphrase → seed modal (first-time): write down seed, confirm checkbox, "Done". Verify `.tar.gz` at chosen path.
2. Re-export → reminder card (no mnemonic redisplay). "Done" exits immediately.
3. Import on a scratch machine with passphrase → 3-s toast → reload. Verify audit feed populated.
4. Import with recovery seed (no passphrase) on a different scratch machine.
5. Import archive from deliberately-mismatched schemaVersion → terminal dialog, no data change.
6. Delete service (e.g., `filesystem`) → preflight → typed match → delete → Dashboard audit feed shows a new `data.delete` row within its next poll.
7. Concurrent-flow guard: start export, verify Import + Delete disabled mid-flight.
8. Offline regression: kill Gateway mid-flow, verify wizard freezes with correct message; on reconnect audit feed reconciles.
9. Clipboard 30-s countdown: copy seed, watch ring drain, verify clipboard cleared (paste in external editor after 31 s).

---

## 7. Delivery breakdown

Three commits on `dev/asafgolombek/ws5c-ui`:

1. **`feat(ui-ipc+store): data.* plumbing for Data panel`** — types (9 additions), wrappers (5), `__mocks__` additions (5), `store/slices/data.ts`, store registration, slice + partialize tests.
2. **`feat(ui): Data panel (Export + Import + Delete wizards)`** — `DataPanel.tsx`, three wizard components, `App.tsx` route swap, full Vitest suite (four component test files).
3. **`docs: WS5-C wrap-up — manual smoke + roadmap + status`** — `docs/manual-smoke-ws5c.md`, `docs/roadmap.md` (WS5-C ✅), `CLAUDE.md` + `GEMINI.md` status rows, and the PR-body draft in the commit message (ready for `gh pr create`).

After commit 3, the single WS5-C UI PR opens against `dev/asafgolombek/phase_4_ws5`. PR gates: all Vitest suites green; `packages/ui` coverage ≥ 80 %/75 %; manual smoke checklist complete across Windows/macOS/Linux.
