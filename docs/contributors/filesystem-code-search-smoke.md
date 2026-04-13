# Filesystem v2 code search — manual smoke

Use this to confirm **`nimbus search`** sees **exported symbols** from local roots with **docstrings / implementation text** indexed in `body_preview` (keyword + hybrid paths).

## Prerequisites

- Gateway running (`nimbus start`).
- Config lists at least one filesystem root with **`code_index = true`** (see `architecture.md` / `[[filesystem.roots]]` in your TOML).
- Optional: sqlite-vec loaded (default on supported builds) so `--semantic` uses hybrid RRF.

## Steps

1. Add or reuse a small TypeScript file under the indexed root, e.g.:

   ```ts
   /** Renews credentials using the OAuth refresh_token flow. */
   export function renewCredentials() {
     return {};
   }
   ```

2. Wait for the next filesystem sync (or trigger a connector sync if you wire one).

3. **Keyword smoke** (no vectors required):

   ```bash
   nimbus search "OAuth refresh" --no-semantic --service filesystem --type code_symbol
   ```

   Expect JSON hits whose `title` is like `renewCredentials (function)` while the match is driven by text in the indexed body preview.

4. **Hybrid smoke** (vectors + BM25):

   ```bash
   nimbus search "OAuth refresh token flow" --semantic --service filesystem --type code_symbol
   ```

   The target symbol should rank ahead of unrelated exports in the same tree when embeddings are backfilled for those items.

## Automated gates

- Connector unit test: `packages/gateway/src/connectors/filesystem-v2-sync.test.ts` (`code_symbol body_preview captures docstring…`).
- Hybrid integration test (skips without sqlite-vec): `packages/gateway/test/integration/filesystem-v2-semantic-search.integration.test.ts`.
