---
name: nimbus-roadmap-task
description: >-
  Turns docs/roadmap.md items into scoped implementation work: current phase
  only, acceptance criteria, subsystem pointers from docs/architecture.md, and
  explicit non-goals. Use when the user references the roadmap, phase themes,
  or asks to implement a roadmap item without expanding scope.
---

# Nimbus — roadmap-driven implementation

## Read first

1. **`docs/roadmap.md`** — phase themes, dependencies, acceptance criteria, and delivered sections (Phase 3 closure summary lives here; Phase 3.5+ for active work).
2. **`docs/architecture.md`** — subsystem boundaries, file locations, and contracts for the area being touched.

## Scope rules

- Implement **only** the current phase’s theme unless the user explicitly authorizes a later-phase item (as of repo state, prefer **Phase 3.5** items unless the user names another phase).
- Phases are thematic, not calendar-bound. A phase completes when its acceptance criteria pass, not at a date.
- Do **not** add Phase N+1 features while doing Phase N work (e.g. skip Phase 4 desktop marketplace polish if the task is Phase 3.5 observability).
- If a task implies engine or HITL changes, follow **`nimbus-engine-security-change`**. If it implies a new MCP connector, follow **`nimbus-mcp-connector`**.

## Task breakdown

For the chosen item:

1. Quote or paraphrase the **acceptance criteria** from the doc (so the user can confirm).
2. List **files/packages** likely involved using the subsystem table in `docs/architecture.md` and `.cursor/rules/nimbus.mdc`.
3. Call out **non-goals** (what this change deliberately does not do).
4. After implementation, run checks per **`nimbus-staged-verify`** based on touched paths.

## Docs and process

- Prefer updating **roadmap/plan checkboxes or status** only when the user asked for doc updates as part of the task; otherwise keep the diff focused on code.
