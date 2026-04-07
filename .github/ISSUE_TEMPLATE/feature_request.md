---
name: Feature Request
about: Propose a new capability or improvement
title: "feat: "
labels: ["enhancement", "needs-triage"]
assignees: []
---

## Summary

<!-- One sentence: what do you want Nimbus to be able to do? -->

## Problem / Motivation

<!-- What problem does this solve? Who is affected and how often? -->

## Proposed Solution

<!-- Describe the feature you have in mind. Be as specific as you can. -->

## Alternatives Considered

<!-- What other approaches did you think about? Why did you prefer this one? -->

## Non-Negotiables Check

<!-- Every feature must be consistent with the project's architectural constraints. -->

- [ ] **Local-first** — no user data or credentials leave the machine without an explicit user action
- [ ] **HITL is structural** — if this involves a destructive or outgoing action, it must go through the consent gate in `executor.ts`
- [ ] **No plaintext credentials** — any credential handling goes through the Vault only
- [ ] **MCP as connector standard** — if this requires a cloud API, it belongs in an MCP connector, not the Engine
- [ ] **Platform equality** — this works on Windows, macOS, and Linux
- [ ] **Roadmap alignment** — this fits the current quarter's scope (see [Roadmap](../../readme.md#1-year-roadmap))

## Roadmap Quarter

<!-- Which quarter does this belong to? Features outside the current quarter (Q1 2026) will be deferred. -->

- [ ] Q1 2026 — Foundation
- [ ] Q2 2026 — The Bridge
- [ ] Q3 2026 — Intelligence
- [ ] Q4 2026 — Presence

## Additional Context

<!-- Mockups, related issues, prior art in other tools, anything that helps. -->
