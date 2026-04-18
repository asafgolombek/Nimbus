# Feedback: WS 3 — Data Sovereignty Implementation Plan

Overall, this is a very high-quality plan that correctly addresses the technical requirements for data portability and tamper-evident audit logging. The choice of envelope encryption with dual-wrap (Passphrase + BIP39 Seed) is industry-standard for local-first sovereignty.

Below are suggestions, open questions, and technical refinements to consider.

---

## 1. Database Hot-Swap during `import`
The current plan for `runDataImport` involves gunzipping and copying a database file into the active location.

- **Question:** How will we handle active SQLite connections in the Gateway process during this swap? Overwriting a database file that has an open `bun:sqlite` handle can lead to `SQLITE_IOERR` or inconsistent state until a restart.
- **Suggestion:**
    - The `data.import` IPC call should probably signal all other services (Sync, Engine, etc.) to close their DB handles before performing the filesystem swap.
    - Alternatively, implement the restore via `sqlite3_backup` API or a series of `DELETE` + `INSERT INTO ... SELECT * FROM remote.table` if we want to stay "live".
    - **Minimum:** The CLI should strongly recommend a `nimbus restart` after a successful import.

## 2. Audit Chain Serialization Stability
In Task 2, `computeAuditRowHash` uses a template string to combine fields:
`${input.prevHash}|${input.actionType}|${input.hitlStatus}|${input.actionJson}|${String(input.timestamp)}`

- **Improvement:** Ensure `actionJson` is **stable**. If different versions of the software (or different MCP connectors) produce JSON with different key orders, the hash will break even if the data is semantically identical.
- **Recommendation:** Use a canonical JSON stringify library or a simple helper that sorts keys before hashing `actionJson`.

## 3. GDPR Deletion Scope
Task 12 (`nimbus data delete`) covers `items`, `vec_items_384`, `items_fts`, and `sync_state`.

- **Question:** What about the **People Graph**?
    - If a user deletes "GitHub" data, should the `person_handles` for GitHub be removed?
    - Should `graph_relation` entries linking GitHub items to other entities be cleaned up?
- **Suggestion:** Explicitly state in the plan whether `data delete` is intended to be a "shallow" item deletion or a "deep" graph cleanup. A deep cleanup is safer for GDPR compliance.

## 4. Backfill Performance (V18 Migration)
Task 3 performs a synchronous backfill of the entire `audit_log` table.

- **Concern:** For power users with tens of thousands of audit rows, this migration might take several seconds or more, blocking Gateway startup.
- **Suggestion:** Add a log line using `console.time`/`timeEnd` or a simple progress count if the row count exceeds a certain threshold (e.g., 5,000 rows).

## 5. Passphrase Strength
- **Suggestion:** Add a simple entropy check in the `nimbus data export` CLI command. If a user provides a very weak passphrase (e.g., "password"), the "sovereignty" is compromised. At least a warning `[warn] your passphrase is weak` would be high value.

## 6. Extension Restore Logic
Task 10/11 mentions backing up `extensions.json`.

- **Question:** Does this backup the *code* of the extensions or just the *list* of installed extensions?
- **Clarification:** If it's just the list, the `import` command should probably trigger an automatic re-download/re-install of those extensions once the network is available, or warn the user that local path-based extensions were not included in the tarball.

## 7. Audit Verify "Incremental" Trust
Task 5 implements incremental verification using `audit_verified_through_id`.

- **Security Note:** If an attacker can modify the `_meta` table, they could mark a tampered range as "verified". 
- **Suggestion:** The `audit.verify --full` command should be the recommended path for "official" audits, while the incremental one is just for fast "health checks" on startup. Ensure the documentation reflects this distinction.

---

### Minor Typo/Logic Check:
- In Task 12, `vecRowsForService` query:
  `SELECT COUNT(*) AS c FROM vec_items_384 WHERE rowid IN (SELECT rowid FROM items WHERE service = ?)`
  This is correct, but ensure that `items` table `rowid` is used consistently as the link. (In Nimbus, `items` table uses a string `id` as PK, but standard SQLite `rowid` is used for `sqlite-vec` indexing). 
- In Task 10, the plan says `// seed is never included in the encrypted manifest`. This is excellent security practice.
