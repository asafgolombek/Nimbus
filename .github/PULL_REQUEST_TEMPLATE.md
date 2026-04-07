## Summary

<!-- What does this PR do? One paragraph or a short bullet list. -->

## Related Issue

<!-- Link the issue this PR addresses: "Closes #123" or "Relates to #456" -->

Closes #

## Type of Change

<!-- Check all that apply -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behaviour)
- [ ] Refactor (no behaviour change)
- [ ] Test improvement
- [ ] Documentation only
- [ ] CI / tooling

## Non-Negotiables Checklist

<!-- Every PR must satisfy these. A failed item blocks merge. -->

- [ ] `bun run typecheck` passes with zero errors
- [ ] `bun run lint` passes (Biome — format + lint)
- [ ] All existing tests pass (`bun test`)
- [ ] New behaviour is covered by tests
- [ ] No `any` types introduced — `unknown` is used for external data
- [ ] No credentials, tokens, or secret values appear in logs, IPC messages, config, or test fixtures
- [ ] Platform-specific code is behind the `PlatformServices` abstraction (no OS checks in business logic)
- [ ] The HITL consent gate has not been weakened, bypassed, or made configurable

## Coverage (if engine/ or vault/ was changed)

<!-- CI enforces: Engine ≥85%, Vault ≥90%. Paste coverage output or confirm it passes. -->

- [ ] `bun run test:coverage:engine` passes (Engine ≥85%) — if `engine/` was modified
- [ ] `bun run test:coverage:vault` passes (Vault ≥90%) — if `vault/` was modified

## Testing

<!-- Describe what you tested and how. Include platform(s) tested if relevant. -->

## Screenshots / Output

<!-- Optional — include terminal output, logs, or screenshots if helpful for review. -->

## Notes for Reviewers

<!-- Anything the reviewer should know: tricky areas, intentional trade-offs, follow-up issues. -->
