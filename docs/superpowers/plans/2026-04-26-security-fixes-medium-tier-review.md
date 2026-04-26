# Review: Security Fixes — Medium-tier (PR 2 of 3)

## Suggestions for Improvement

### 1. Hardened Redaction Logic (G1)
**Suggestion:** Enhance the redaction logic in `packages/gateway/src/audit/format-audit-payload.ts` to check both keys and values.
**Reasoning:** The current implementation only redacts based on key names (e.g., `apiToken`). If a sensitive value is stored under a generic key (e.g., `message: "ghp_secure_token"`), it will leak into the audit log. Adding a regex for common secret patterns (e.g., `ghp_`, `sk-`, `eyJ...`) would provide a second layer of defense.

### 2. Recovery Seed Access (G2)
**Suggestion:** Consider adding a dedicated, HITL-gated command to "show recovery seed" (e.g., `nimbus vault show-seed`).
**Reasoning:** The plan correctly stops re-disclosing the recovery seed in `data.export` to prevent silent extraction. However, if a user legitimately loses their seed, they currently have no way to retrieve it. A dedicated command would preserve security while maintaining usability.

### 3. Tar Safety Flags (G7)
**Suggestion:** Ensure `tar` extraction uses `--no-same-owner` and `--no-same-permissions` on all POSIX platforms.
**Reasoning:** While the plan mentions these for GNU tar, they are critical for preventing archives from attempting to set restrictive or elevated permissions/ownership on the extracted files, which could be used for local privilege escalation or to hide malicious files.

### 4. Extension Re-verification (G7)
**Suggestion:** In `LazyConnectorMesh.listTools`, cache the result of `verifyOneExtensionStrict` per session or until the file system watcher detects a change.
**Reasoning:** Re-hashing the entry file on every `listTools` call (which can happen frequently during agent loops) may introduce noticeable latency for large extensions. A watcher-based cache would maintain security without the performance hit.

## Open Questions

### 1. SQL Worker Termination (G4)
**Question:** Has it been verified that `worker.terminate()` reliably halts an active `bun:sqlite` query that is stuck in a deep recursion or large join?
**Context:** Some SQLite operations can be blocking at a level that signals may not immediately interrupt. If the worker remains alive, it may continue to consume resources even if the parent has "timed out."

### 2. Updater Scheme Guard (G6)
**Question:** Is the `http://127.0.0.1` escape hatch for the updater manifest strictly necessary for production builds?
**Context:** While useful for tests, it could theoretically allow a local malicious process to serve a signed (but perhaps older/vulnerable) manifest. If it's only for tests, it should ideally be guarded by an environment variable like `NIMBUS_DEV_UPDATER`.

### 3. MCP Envelope Integration (G9)
**Question:** How will the `{ envelope, result }` shape be handled by the Mastra `Agent`? 
**Context:** Mastra tools usually expect a specific return type that matches their schema. If we return the envelope as a string, we need to ensure the `Agent` treats it as the primary response for its context, while other parts of the system (like the HITL gate) still receive the structured `result`.

### 4. Sandbox Roadmap (G7)
**Question:** Is there a specific architectural blocker preventing a basic `seccomp` (Linux) or `AppContainer` (Windows) sandbox for extensions in Phase 4?
**Context:** Given that extensions run with full user privileges, even a basic "no-network" or "limited-filesystem" sandbox would significantly reduce the impact of a compromised extension.
