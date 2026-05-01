# SonarQube rule tuning — B3 audit

This file is empty by design. It is populated **only if** Phase 2's first
SonarQube analysis run produces unacceptable signal-to-noise on the default
Sonar Way profile, requiring explicit rule disables.

If you disable a rule, record:

- Rule key (e.g., `typescript:S1135`)
- Reason (one sentence; tie to a non-negotiable, an existing test, or a stylistic
  decision documented in `CLAUDE.md` / `docs/architecture.md`)
- Date
- Disabled in: `.sonarcloud.properties` / SonarQube web UI / etc.

Format:

| Rule | Reason | Date | Where |
|---|---|---|---|
| `typescript:Sxxxx` | … | YYYY-MM-DD | … |

If Phase 2 does not need to disable any rule, this file remains empty and is
removed at B3 close.

Spec reference: `docs/superpowers/specs/2026-04-30-structure-audit-design.md` § 4.1
