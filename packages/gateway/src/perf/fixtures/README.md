# Perf bench fixtures

Synthetic HTTP-trace generators + MSW v2 handlers used by the S6
sync-throughput drivers. See `docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md` §13 for the verification rationale.

## Connector HTTP-layer verification (PR-B-2b-1, Task 2)

| Connector | HTTP layer                                      | MSW intercepts | Verdict |
|-----------|-------------------------------------------------|----------------|---------|
| Drive     | direct `fetch(googleapis.com/drive/v3/...)`     | yes            | pass    |
| Gmail     | direct `fetch(gmail.googleapis.com/...)` via shared `fetchBearerAuthorizedJson` | yes            | pass    |
| GitHub    | direct `fetch(api.github.com/...)` via shared `fetchBearerAuthorizedJson` (no Octokit dep) | yes            | pass    |

Verified 2026-04-28 by AsafGolombek. Re-run the verification grep set
(see plan Task 2) any time a connector adds a new HTTP path or swaps
its HTTP layer (e.g., adopts an SDK that bypasses fetch).

## Generators

- `synthetic-drive-trace.ts` — `files.list` pages at 100 items/page, deterministic LCG.
- `synthetic-gmail-trace.ts` — `messages.list` (id+threadId) + `messages.get` (full payload).
- `synthetic-github-trace.ts` — `pulls` REST pages with RFC 5988 Link headers.

## MSW handler factories

- `msw-handlers.ts` — `driveHandlers(tier)`, `gmailHandlers(tier)`, `githubHandlers(tier)`.

Tests register `setupServer` with `onUnhandledRequest: "error"`
(sentinel against connector drift). Driver runtime uses `"warn"`
because the spawned gateway emits unrelated outbound HTTP
(telemetry, update-manifest probe, etc.).
