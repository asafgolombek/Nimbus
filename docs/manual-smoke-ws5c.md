# WS5-C Manual Smoke Checklist

Run on Windows, macOS, and Linux before merging WS5-C to main.

## Preconditions

- Nimbus Gateway running (`nimbus start`).
- At least two connectors configured (e.g., filesystem + GitHub).
- Tauri UI in dev mode: `cd packages/ui && bunx tauri dev`.
- A valid Nimbus backup archive (`.tar.gz`) available for import testing.

## Settings — Profiles panel

- [ ] Profiles panel lists all profiles; active profile is highlighted.
- [ ] Create a new profile → appears in list immediately.
- [ ] Switch to new profile → UI reflects the switch; sidebar shows new active profile.
- [ ] Typed-name confirmation required before deleting a profile.
- [ ] Delete profile → removed from list; active profile unchanged if different.

## Settings — Telemetry panel

- [ ] Telemetry panel shows current status (enabled / disabled).
- [ ] Toggle telemetry off → status reflects change; no further data sent.
- [ ] Toggle back on → counter cards and payload sample appear.
- [ ] Expanding the payload sample shows redacted-safe keys only.

## Settings — Connectors panel

- [ ] Connectors panel loads and lists all configured connectors.
- [ ] Edit sync interval → validation rejects values below 60 s; valid values save.
- [ ] Toggle depth selector → change saves; reflected after re-open.
- [ ] Toggle enable/disable → connector pauses or resumes syncing.
- [ ] `connector.configChanged` notification updates the row without page reload.
- [ ] "Go to Dashboard" deep-link highlights the matching connector tile.

## Settings — Model panel

- [ ] Model panel shows router decisions for each task type.
- [ ] Per-task default picker updates the router decision.
- [ ] Installed models list renders with correct provider badges.
- [ ] Pull dialog opens; provider radio is filtered by `llm.getStatus`.
- [ ] Cancel pull aborts cleanly; no stale progress bar remains.
- [ ] Re-opening the Model panel while a pull is in flight re-attaches to the progress bar.

## Settings — Audit panel

- [ ] Audit panel loads summary (counts by outcome and by service).
- [ ] "Verify chain" runs and reports success on an unmodified audit log.
- [ ] "Export CSV" opens a save dialog; resulting file has the 6-column header.
- [ ] "Export JSON" produces valid JSON with `rowHash` and `prevHash` fields.

## Settings — Updates panel

- [ ] Updates panel shows current version and last-check time.
- [ ] "Check now" runs; either shows "Up to date" or an update available banner.
- [ ] Rollback button is visible only after a rolled-back or failed update.
- [ ] While an update is downloading, progress bar animates; "Cancel" stops it.
- [ ] After applying an update, the restart overlay appears and the app relaunches.

## Settings — Data panel

### Export

- [ ] "Data" panel renders three cards: Back up, Restore, Delete.
- [ ] While Gateway is offline, all three buttons are disabled with a stale chip.
- [ ] "Last export" shows "Never" on a fresh install, or a formatted timestamp after export.
- [ ] Index size and item count are populated from preflight.
- [ ] "Export backup…" opens the ExportWizard.
- [ ] Passphrase gate: short / weak passwords keep "Next" disabled; "reasonably-strong-example-phrase!" enables it.
- [ ] Mismatched passphrase confirm keeps "Next" disabled.
- [ ] Save dialog defaults to `nimbus-backup-YYYY-MM-DD.tar.gz`.
- [ ] Choosing an existing file shows the overwrite sub-step; clicking "Cancel" returns to destination.
- [ ] Clicking "Overwrite" proceeds; export progress bar animates.
- [ ] On first export: seed step shows mnemonic + warning; "Done" is gated on the checkbox.
- [ ] "Copy" copies the seed to clipboard; a 30 s countdown appears; seed is cleared from clipboard after 30 s.
- [ ] Closing the wizard mid-countdown clears the clipboard immediately.
- [ ] On re-export: seed step shows reminder card only, no mnemonic, "Done" enabled immediately.
- [ ] After export completes, "Last export" timestamp updates on the card.

### Import

- [ ] "Restore backup…" opens the ImportWizard.
- [ ] "Choose file" opens an open-file dialog filtered to `.tar.gz`.
- [ ] Passphrase auth method: valid passphrase enables "Next".
- [ ] Recovery seed auth method: filling all 12 words enables "Next".
- [ ] Typed confirmation "replace my data" gates the "Replace my data" button.
- [ ] Wrong confirmation text keeps "Replace my data" disabled.
- [ ] Successful import shows "Restore complete" and a reload countdown.
- [ ] After 3 s, the window reloads automatically.
- [ ] If `oauthEntriesFlagged > 0`, the count is shown with re-auth instructions.
- [ ] `-32002` (decryption failed) shows passphrase-specific error + "Retry" button.
- [ ] `-32002` with recovery seed shows seed-specific error copy.
- [ ] `-32010` archive_newer shows "newer Nimbus" copy + "Go to Updates" deep link.
- [ ] `-32010` archive_older_unsupported shows "older, unsupported" copy; no "Go to Updates".

### Delete service data

- [ ] "Delete service…" opens the DeleteServiceDialog.
- [ ] Service dropdown lists all configured connectors.
- [ ] Selecting a service fetches preflight counts (items, embeddings, vault keys).
- [ ] Typed service-name confirmation gates the "Delete" button (case-sensitive).
- [ ] Wrong name keeps "Delete" disabled.
- [ ] Clicking "Delete" sends `data.delete` with `dryRun: false`.
- [ ] Success step shows the deleted item count and a "Close" button.
- [ ] After closing, the preflight data on the Export card refreshes.

### Concurrency guard

- [ ] While Export is running, Import and Delete buttons are disabled.
- [ ] While Import is running, Export and Delete buttons are disabled.
- [ ] Dropping the Gateway connection while a flow is running triggers `markDisconnected`.

## Regression — previously shipped panels

- [ ] Dashboard still loads correctly; metrics and connector tiles render.
- [ ] HITL popup still surfaces consent requests.
- [ ] Quick Query still opens and returns results.
