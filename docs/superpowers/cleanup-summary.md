# Superpowers Cleanup & Deferred Item Strategy

**Date:** 2026-04-26
**Status:** Proposal — Pending Approval

## 📝 Overview
As Phase 4 reaches critical mass, the `docs/superpowers/` directory has accumulated many transient implementation plans and design specs. This document outlines the strategy for archiving completed work, identifying active tasks, and centralizing the management of deferred items to prevent roadmap rot.

---

## 📂 File Inventory & Recommended Actions

### 1. Active / In-Progress (KEEP)
These files represent work that is currently being executed or is next in queue.

| File | Status |
|---|---|
| `plans/2026-04-24-ws7-vscode-extension.md` | WS7 implementation (Active) |
| `specs/2026-04-24-ws7-vscode-extension-design.md` | WS7 design (Active) |
| `plans/2026-04-26-perf-audit-phase-1a.md` | B2 Phase 1A (Active) |
| `specs/2026-04-26-perf-audit-design.md` | B2 Overall design (Active) |

### 2. Completed / Implemented (ARCHIVE)
These should be moved to `docs/superpowers/plans/archive/` and `docs/superpowers/specs/archive/` respectively.

*   **WS5-D (Polish)**: `plans/2026-04-22-ws5d-polish.md` (+ review)
*   **WS6 (Rich TUI)**: `plans/2026-04-23-ws6-rich-tui.md`, `specs/2026-04-23-ws6-rich-tui-design.md` (+ reviews)
*   **WS4 (Signing/Updater)**: `plans/2026-04-23-signing-pipeline.md`, `specs/2026-04-23-signing-pipeline-design.md`
*   **Toolchain Refresh**: `plans/2026-04-24-toolchain-runner-os-refresh.md`, `specs/2026-04-24-toolchain-runner-os-refresh-design.md`
*   **B1 Security Audit**: `plans/2026-04-25-security-audit.md`, `specs/2026-04-25-security-audit-design.md`
*   **Security Fixes (B1 Follow-ups)**: `plans/2026-04-25-security-fixes-high-tier.md`, `plans/2026-04-26-security-fixes-medium-tier.md`, `plans/2026-04-26-security-fixes-low-tier.md` (+ design/notes)

### 3. Redundant / Transient (DELETE)
These files served a "turn-level" purpose and are no longer needed as the parent plans/specs are being archived.

*   All `*-review.md` files in `plans/` and `specs/` (the outcomes are merged into the main docs).
*   `plans/2026-04-26-security-fixes-low-tier-notes.md` (content should be summarized in the results doc or a deferred list).

---

## 🗺️ Roadmap & README Updates

### 1. `docs/roadmap.md`
- [ ] Mark **WS5-D** and **WS6** as ✅ complete in the Phase 4 status summary.
- [ ] Check off **B1 Security Fixes** (High/Medium/Low) in the Phase 4 deliverables.
- [ ] Update the "Security audit follow-ups (B1)" section to reflect remaining Phase 4 blockers (S4-F6, S4-F8, S6-F1).

### 2. `README.md`
- [ ] Currently accurate ("Phase 4 Active"). No changes needed unless a specific v0.1.0-rc1 milestone is hit.

---

## ⏳ Deferred Item Management

Currently, deferred items are scattered across Phase 2, Phase 3 (follow-ups), B1 audit follow-ups, and the upcoming B2 perf audit misses.

**Proposal: Create `docs/ROADMAP-DEFERRED.md`**

This new file will serve as the central ledger for all "Not for v0.1.0" items, categorized by subsystem. Each entry must carry:
1.  **Origin**: (e.g., Phase 2, B1 Audit, B2 Perf).
2.  **Rationale**: Why it was deferred (usually cost/impact ratio).
3.  **Target Phase**: Where it is tentatively re-slotted (e.g., Phase 5, Phase 7).

### Current Deferred Ledger (Seed List)
- **Phase 2**: Full doc content extraction (PDF/DOCX), SQLCipher opt-in (Phase 4 scope), Vault portability (Active in WS3).
- **Phase 3**: Full IaC drift, Extension syscall sandbox (Phase 5).
- **B1 Audit (Non-blockers)**: LAN forward secrecy (S3-F8), Structured tool result auditing (S8-F10).
- **B2 Perf (Upcoming)**: Misses 6–N (to be populated).

---

## 🚀 Execution Plan

1.  **Step 1**: Create `docs/superpowers/plans/archive/` and `docs/superpowers/specs/archive/`.
2.  **Step 2**: Move completed files. Delete review files.
3.  **Step 3**: Create `docs/ROADMAP-DEFERRED.md` and seed it with the lists above.
4.  **Step 4**: Update `docs/roadmap.md` checkmarks.
