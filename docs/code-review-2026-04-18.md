# Nimbus Codebase Review — 2026-04-18

Covers the full gateway and CLI source. Security audit + quality sweep run in parallel.

---

## Part 1 — Security Audit

**Result: No HIGH-confidence vulnerabilities.** The codebase has strong security hygiene:

- ✅ IPC input validation — all params type-checked; vault keys validated via `validateVaultKeyOrThrow()`
- ✅ HITL gate — consent cannot be bypassed; client ID binding enforced; disconnection properly rejects pending consent
- ✅ Vault/credentials — no values leak through IPC responses; tokens never logged
- ✅ DB writes — all queries parameterized throughout
- ✅ Connector sync — Google Drive query params URL-encoded via `searchParams.set()`; no command injection

**Filtered finding:** `db/repair.ts` interpolates table names from `PRAGMA foreign_key_check` into a DELETE query without identifier escaping. Confidence 6.5/10 — filtered because table names come from the trusted DB schema (not user input) and only trigger on `nimbus db repair --yes`. Tracked as item 4 below.

---

## Part 2 — Quality Sweep

### 🔴 Bugs

#### 1. Silent promise rejection in `ClientSession.push()` / `endInput()`
**File:** `packages/gateway/src/ipc/server.ts:160, 174`

`void this.dispatchLines(lines)` is called with no `.catch()`. If `dispatchLines` rejects mid-loop the error is silently swallowed and the session is left in an undefined state.

```typescript
// Current
void this.dispatchLines(lines);

// Fix
void this.dispatchLines(lines).catch((e: unknown) => {
  const m = e instanceof Error ? e.message : "dispatch error";
  this.write(encodeLine(errorResponse(null, -32603, m)));
  this.dispose();
});
```

---

#### 2. `backfill_done` sent even when backfill failed
**File:** `packages/gateway/src/embedding/embedding-worker.ts:92-101`

The backfill silently catches all errors but still sends `backfill_done`. The main thread cannot distinguish success from failure.

```typescript
// Current
void (async () => {
  try {
    await pl.backfillAll(...);
  } catch {
    /* best-effort */
  }
  sendToMain({ type: "backfill_done" }); // always fires regardless of outcome
})();

// Fix: communicate success/failure
let success = false;
try {
  await pl.backfillAll(...);
  success = true;
} catch { /* best-effort */ }
sendToMain({ type: "backfill_done", success });
```

---

#### 3. Google Drive delta loop has no max-iteration guard
**File:** `packages/gateway/src/connectors/google-drive-sync.ts:~484`

The delta-phase loop relies on the API eventually returning `hasMore: false`. A malformed or stuck API response could loop indefinitely. The list-phase already has a page-count guard — the delta phase needs the same.

```typescript
// Fix: add a page counter analogous to the list-phase guard
let deltaPage = 0;
const DELTA_PAGE_LIMIT = 10_000;
while (hasMore) {
  if (++deltaPage > DELTA_PAGE_LIMIT) {
    throw new Error("Google Drive delta sync exceeded page limit — aborting to prevent infinite loop");
  }
  // ... existing loop body
}
```

---

### 🟡 Code Quality

#### 4. Unescaped SQL identifier interpolation in DB repair
**File:** `packages/gateway/src/db/repair.ts:154-156`

```typescript
`DELETE FROM "${table}" WHERE rowid IN (${placeholders})`
```

Table names from `PRAGMA foreign_key_check` are trusted but not double-quote-escaped. A schema table named `foo"bar` produces broken SQL.

```typescript
// Fix
function escapeIdentifier(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}
// Usage:
`DELETE FROM ${escapeIdentifier(table)} WHERE rowid IN (${placeholders})`
```

---

#### 5. Duplicate Google HTTP error formatters
**Files:**
- `packages/gateway/src/connectors/google-drive-sync.ts:69-98` — `formatGoogleDriveHttpError()`
- `packages/gateway/src/connectors/google-photos-sync.ts:58-87` — `formatGooglePhotosHttpError()`

Structurally identical — same logic, different service name string. Extract to a shared module:

```typescript
// connectors/google-sync-shared.ts
export function formatGoogleHttpError(status: number, body: string, service: string): string {
  // ... shared implementation
}
```

---

#### 6. Duplicated `fetchJson` wrappers across connectors

Each connector independently implements the same pattern: rate-limit acquire → fetch with auth header → status check → JSON parse → return `{ json, bytes }`. Found in at least:

| File | Function |
|------|----------|
| `google-drive-sync.ts` | `driveFetchJson()` |
| `google-photos-sync.ts` | `photosSearch()` |
| `gmail-sync.ts` | `gmailFetchJson()` |
| `notion-sync.ts` | `notionFetchSearchBatch()` |
| `jira-sync.ts` | `jiraFetchSearchPage()` |

**Recommendation:** Create `sync/fetch-helpers.ts` with a shared `fetchJsonWithRateLimit(ctx, url, init)` utility.

---

#### 7. Cursor decode boilerplate repeated
**Files:** `gmail-sync.ts`, `jira-sync.ts`, `slack-sync.ts`

Each defines its own `decodeCursor()` with the same `JSON.parse` + type guard pattern. `outlook-sync.ts` and `notion-sync.ts` already use a shared helper — the others should follow that pattern.

---

#### 8. Health gate check duplicated in scheduler
**File:** `packages/gateway/src/sync/scheduler.ts:348-381, 414, 448`

The same health-gate skip logic appears in at least three locations. If the condition ever changes (e.g. a new health state is added), it must be updated everywhere. Extract to:

```typescript
function shouldSkipForHealth(state: ConnectorHealthState): boolean { ... }
```

---

#### 9. Telemetry flush — fire-and-forget with no failure signal
**File:** `packages/gateway/src/telemetry/flush-scheduler.ts:138-159`

The `fetch()` for telemetry is not awaited and not stored. `tick()` can return before the network call completes. If telemetry fails repeatedly there is no backpressure or circuit-breaker. Low severity (telemetry is opt-in) but worth a `void fetch(...).catch(...)` at minimum.

---

### 🔵 Refactor Opportunities

#### 10. `server.ts` is 898 lines — too many responsibilities
**File:** `packages/gateway/src/ipc/server.ts`

Current responsibilities in one file:
- `ClientSession` class — connection lifecycle
- `dispatchVaultIfPresent` — vault operations
- Five `tryDispatch*Rpc` namespaces (connector, session, automation, diagnostics, people)
- `dispatchAgentInvoke` + `dispatchWorkflowRunRpc` — engine methods
- Platform listener setup (Bun unix + Win32 named pipe)

The dispatcher extraction pattern is already established (`connector-rpc.ts`, `automation-rpc.ts`, etc.). Finish the job:
- Move `ClientSession` → `ipc/session.ts`
- Move platform listener logic → `ipc/listeners.ts`

---

#### 11. `scheduler.ts` is 710 lines — too many responsibilities
**File:** `packages/gateway/src/sync/scheduler.ts`

Combines: job queue + pump logic, health gate evaluation, connectivity probing, backoff calculation, and force-sync coordination. Connectivity management is already partially isolated in `sync/connectivity.ts` — the health gate and backoff logic could be similarly extracted to keep the scheduler focused on job dispatch.

---

#### 12. Payload redaction regex is too narrow
**File:** `packages/gateway/src/engine/executor.ts` — `redactPayloadForConsentDisplay()`

The current regex `/token|key|secret|password/i` misses common credential field names. Expand:

```typescript
// Current
/token|key|secret|password/i

// Recommended
/token|key|secret|password|credential|bearer|auth/i
```

---

## Summary

| # | File | Severity | Category |
|---|------|----------|----------|
| 1 | `ipc/server.ts:160,174` | 🔴 Bug | Silent async rejection |
| 2 | `embedding/embedding-worker.ts:92` | 🔴 Bug | Backfill success indistinguishable from failure |
| 3 | `connectors/google-drive-sync.ts:~484` | 🔴 Bug | Unbounded delta sync loop |
| 4 | `db/repair.ts:154` | 🟡 Quality | Unescaped SQL identifier |
| 5 | `google-drive-sync.ts` + `google-photos-sync.ts` | 🟡 Duplication | Identical HTTP error formatters |
| 6 | Multiple connector files | 🟡 Duplication | Repeated `fetchJson` wrappers |
| 7 | Multiple connector files | 🟡 Duplication | Cursor decode boilerplate |
| 8 | `sync/scheduler.ts:348,414,448` | 🟡 Quality | Health gate logic repeated 3× |
| 9 | `telemetry/flush-scheduler.ts` | 🟡 Quality | Unhandled telemetry failures |
| 10 | `ipc/server.ts` (898 lines) | 🔵 Refactor | God file — too many responsibilities |
| 11 | `sync/scheduler.ts` (710 lines) | 🔵 Refactor | Too many responsibilities |
| 12 | `engine/executor.ts` | 🔵 Refactor | Narrow redaction regex |

**Recommended priority:** Fix bugs 1–3 now (simple, high-signal). Batch items 5–7 into a single connector cleanup PR. Address 10–11 incrementally as those files are touched.
