---
name: nimbus-roadmap-task
description: >-
  Turns docs/roadmap.md and docs/q2-2026-plan.md items into scoped
  implementation work: current-quarter only, acceptance criteria, subsystem
  pointers from architecture.md, and explicit non-goals. Use when the user
  references the roadmap, Q2 plan, quarterly themes, or asks to implement a
  numbered plan item without expanding scope.
---

# Nimbus — roadmap-driven implementation

## Read first

1. **`docs/roadmap.md`** — quarter themes, dependencies, acceptance criteria at a high level.
2. **`docs/q2-2026-plan.md`** — concrete tasks and sequencing for the active quarter (adjust if the active quarter doc name changes).
3. **`architecture.md`** — subsystem boundaries, file locations, and contracts for the area being touched.

## Scope rules

- Implement **only** the current quarter’s theme unless the user explicitly authorizes a later-quarter item.
- Do **not** add Q(n+1) features while doing Q(n) work (e.g. skip extension marketplace polish if the task is Q2 bridge/connector work).
- If a task implies engine or HITL changes, follow **`nimbus-engine-security-change`**. If it implies a new MCP connector, follow **`nimbus-mcp-connector`**.

## Task breakdown

For the chosen item:

1. Quote or paraphrase the **acceptance criteria** from the doc (so the user can confirm).
2. List **files/packages** likely involved using the subsystem table in `architecture.md` and `.cursor/rules/nimbus.mdc`.
3. Call out **non-goals** (what this change deliberately does not do).
4. After implementation, run checks per **`nimbus-staged-verify`** based on touched paths.

## Docs and process

- Prefer updating **roadmap/plan checkboxes or status** only when the user asked for doc updates as part of the task; otherwise keep the diff focused on code.
