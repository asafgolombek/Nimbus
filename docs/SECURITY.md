# Security Policy

## Supported Versions

Nimbus is in active development (Phase 4 — Presence; Phase 3.5 Observability is complete). Only the latest commit on `main` receives security fixes. There are no stable release branches yet.

| Branch / Tag | Supported |
|---|---|
| `main` (HEAD) | ✅ Yes |
| Older commits | ❌ No |

Once versioned releases begin (target: Phase 4 — `v0.1.0`), this table will be updated with a supported version range.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately via one of these channels:

1. **GitHub private vulnerability reporting** — use "Report a vulnerability" on the [Security tab](../../../security/advisories/new) (preferred)
2. **Email** — contact the maintainers at the address listed in the repository profile

Include:

- A clear description of the vulnerability and its impact
- The affected component (Vault, HITL executor, IPC server, extension sandbox, etc.)
- Steps to reproduce or a partial proof-of-concept
- Your severity assessment (CVSS score if available)
- Whether you believe it is platform-specific

You will receive acknowledgement within **72 hours** and a status update within **7 days**.

---

## Security Model

Nimbus is built for engineers who run systems in production and security practitioners who need provable guarantees, not security theatre. The guarantees below are structural — enforced by code, not by policy or configuration. This section describes what Nimbus protects, what it does not, and why.

---

### Security Boundary

Nimbus owns and enforces security **within its process boundary**. What sits below that boundary — the operating system, the disk, the physical machine — is outside Nimbus's control.

**Nimbus's side of the boundary:**
- Credential storage (OS-native keystore only, zero plaintext)
- HITL enforcement (structural, executor-level)
- Extension sandboxing (child process isolation, manifest integrity)
- IPC access control (owner-only socket/pipe)
- Prompt injection defence (typed data blocks, never instructions)
- Audit logging (every action and HITL decision, before execution)

**Your side of the boundary:**
- Strong OS login or biometric authentication
- Screen locking when unattended
- Disk encryption — BitLocker (Windows), FileVault (macOS), LUKS (Linux)
- Active endpoint protection (Antivirus/EDR) — the OS-native keystores protect against stolen-disk attacks; they do not protect against malware running with user-level privileges on a live machine
- Network integrity (Firewall, VPN, and DNS security)
- Timely OS security updates

This boundary is the reason certain issue classes are listed as out of scope below — they describe vulnerabilities in your half of the model, not in Nimbus's.

---

### Credentials

OAuth tokens and all secrets are stored exclusively in the OS-native keystore:

| Platform | Backend |
|---|---|
| Windows | DPAPI (`CryptProtectData`) — key derived from user account; fails on other accounts and machines |
| macOS | Keychain Services — locked on screen lock; requires app entitlement |
| Linux | Secret Service API via `libsecret` — GNOME Keyring / KWallet integration |

There is no code path that writes credentials to disk in plaintext, includes them in log output, or returns them in IPC responses. The structured logger's `redact` configuration automatically censors any field matching `*.token`, `*.secret`, or `oauth.*` patterns.

---

### Human-in-the-Loop (HITL) Consent Gate

Every destructive, outgoing, or irreversible action — delete, send, move, merge, deploy, apply — is blocked at the executor by a **compile-time constant set** (`HITL_REQUIRED` in `packages/gateway/src/engine/executor.ts`). Key properties:

- **Not a prompt instruction.** The gate is a function call in the executor. A model that generates a plan to "skip confirmation" produces a plan that does not execute — there is no code path to bypass.
- **Not runtime-configurable.** The set is declared as a module-level constant and is not writable via configuration files, IPC calls, or extension APIs.
- **No timeout.** The executor awaits the consent channel unconditionally. There is no timer that auto-approves.
- **Audit-first.** The HITL decision (approved, rejected, or not required) is written to the audit log **before** the connector is called.

Every action Nimbus takes under a HITL approval is recorded with the action type, payload, decision, and timestamp. The audit log is append-only and locally stored in SQLite.

> **Current state of the HITL whitelist:** The set covers cloud storage, email, calendar, source control (merge, push, branch delete), CI/CD (trigger, cancel), infrastructure (apply, destroy, scale), Kubernetes, and monitoring/incident actions. See the constant in `executor.ts` for the full list. Extensions that declare `hitlRequired` in their manifest have their write tools added to the gate automatically.

---

### Extension Sandbox

Third-party extensions run as child processes. They:

- Receive only the credentials for their declared service, via environment variable injection at spawn time
- Cannot enumerate Vault keys
- Cannot connect to the Gateway's IPC socket
- Cannot read other connectors' credentials
- Have their manifest SHA-256 hash verified on every Gateway startup — a tampered manifest causes the extension to be disabled before it runs

> **Current sandbox depth:** The current isolation mechanism is scoped environment injection and process separation. Full syscall-level and network-level isolation (seccomp / sandbox profiles) was originally planned for Phase 3 hardening but was deferred; it is now tracked for Phase 5. The current model is honest and reasonable, but users who install third-party extensions from untrusted sources should treat them with the same caution as any arbitrary npm package — the sandbox does not prevent a malicious extension from making outbound network calls or reading files the OS user can access.

---

### IPC Surface

The Gateway listens only on a local domain socket (Unix) or named pipe (Windows), created with owner-only permissions (`chmod 0600` on Unix; DACL owner-only on Windows). There is no TCP listener. No Nimbus Gateway port is opened on any network interface.

---

### Prompt Injection

File content, email bodies, and external API responses are injected into the agent's context as typed `<tool_output>` data blocks. They are treated as untrusted data — not as instructions. The Engine's prompt builder enforces this structurally; it is not a prompt-level instruction to "ignore injected content."

---

### Audit Log

Every action the agent takes — including every HITL decision — is recorded in a local SQLite `audit_log` table before the action executes. You can reconstruct exactly what Nimbus did on your behalf at any time via `nimbus audit` or the desktop audit log viewer.

**Single source of truth:** The audit log lives exclusively in SQLite — there is no separate `audit.jsonl` file. This is a deliberate architectural decision: a split store would require two separate tamper-evident chains and create reconciliation risk before `v0.1.0`.

Phase 4 migration N+3 will add `row_hash` and `prev_hash` columns to `audit_log`, implementing a BLAKE3-chained tamper-evident log verifiable with `nimbus audit verify`.

---

### Standing Approvals (Phase 5 — Security Model Pre-Design)

Phase 5 will introduce standing approvals: pre-authorized patterns that allow recurring write actions to execute without an interactive HITL prompt. Because standing approvals are functionally a scoped HITL bypass, the security boundaries are defined here before implementation begins.

**Threat model:**

| Threat | Mitigation |
|---|---|
| Overly broad rule scope — user grants wider permissions than intended | Standing rules must specify an exact connector, action type, and target pattern. Wildcard targets require explicit opt-in at rule creation. |
| Malicious extension crafts tool calls to match a standing rule | Standing rules are matched against the tool's declared manifest name and connector id, not against the free-text action description. Extensions cannot self-declare as a built-in connector. |
| Privilege escalation via rule chaining | A standing approval covers exactly one tool call. The approval does not propagate to subsequent tool calls in the same session. |
| Audit trail gap | Standing-approved actions are written to `audit_log` with `hitl_status = 'standing_approved'` and the rule id before execution — the same audit-first guarantee as interactive HITL. |
| Rule revocation window | Revoked rules take effect immediately; any in-flight session that already passed the gate completes, but no new calls are approved. |

**Design constraints (enforced at implementation time):**
- Standing rules are stored in SQLite, not in config files — they are subject to the same integrity checks as the rest of the local index.
- No standing rule may cover `vault.*` or `db.*` tool calls.
- The rule editor in the UI must show a diff preview of the scope before saving.

---

## SecDevOps and Compliance Use

Nimbus is designed to support security-sensitive operational environments. The properties relevant to SecDevOps and compliance teams:

**Audit trail.** Every action the agent takes — including every HITL approval, rejection, and "not required" decision — is recorded in a local SQLite `action_log` table before the action executes. The log is append-only. Phase 4 adds BLAKE3 chain hashing (`row_hash`, `prev_hash`) verifiable with `nimbus audit verify`. Phase 9 adds shipping to SIEM targets (Splunk, Elastic, Datadog Logs, S3/GCS/Azure Blob) with local retention as fallback.

**No data exfiltration surface.** The local index stores metadata only — names, timestamps, URLs, body previews. Full document content never enters the index or embedding pipeline unless explicitly configured (`[indexing.depth] = "full"`). The index is protected by OS file permissions; it is never transmitted to a Nimbus server because there is no Nimbus server.

**Consent-gated remediation.** Incident response actions (rollback, restart, IaC apply, alert acknowledge) go through the same structural HITL gate as all other write actions. An agent under incident pressure cannot bypass the gate — there is no code path to do so.

**Credential isolation.** Connector credentials are injected at MCP server spawn time via environment variables scoped to that child process. They are never present in IPC messages, in the local index, in log output, or in the Engine's context. The `redact` configuration on the structured logger automatically censors any field matching `*.token`, `*.secret`, or `oauth.*`.

**Compliance tooling roadmap.** `nimbus compliance check` (Phase 9) will produce a machine-readable JSON report covering: credential storage status, audit log integrity, plaintext credential scan, connector scope minimization, and data residency posture. Structured for auditor consumption.

---

## Scope

**In scope:**

- Vault / credential exposure through any interface
- HITL gate bypass — any path by which a destructive action executes without user consent
- Extension sandbox escape
- IPC authentication bypass or privilege escalation
- Prompt injection leading to unintended actions
- Dependency vulnerabilities with direct exploitability in the Nimbus runtime

**Out of scope:**

- Vulnerabilities in the OS keystore implementation (DPAPI, Keychain, libsecret) — these are platform-level, not Nimbus's
- Attacks requiring physical access to an unlocked or unencrypted machine — physical and OS security are your side of the boundary
- Theoretical attacks with no practical exploit path against a correctly configured machine
- Rate limiting or DoS on the local IPC socket (already local-only and owner-gated)

---

## OpenSSF Scorecard (supply chain)

Some Scorecard findings are enforced in-repo (workflows, CodeQL, dependency scanning). Others depend on **repository or organization settings** or **external programs**:

| Finding | What fixes it |
|--------|----------------|
| **Security-Policy** | This file (`docs/SECURITY.md`) on the default branch. |
| **Branch-Protection** / **Code-Review** | Branch protection **rulesets** (or classic rules): required PRs, approvals, required status checks; optional **code owner** review using [`.github/CODEOWNERS`](../.github/CODEOWNERS). Step-by-step: [`.github/BRANCH_PROTECTION.md`](../.github/BRANCH_PROTECTION.md). |
| **Maintained** | Ongoing commits, releases, and issue/PR handling (project activity). |
| **Fuzzing** | Typically [OSS-Fuzz](https://google.github.io/oss-fuzz/) (or another continuous fuzzing program) integrated with the project; not covered by this file alone. |
| **CII-Best-Practices** | [OpenSSF Best Practices badge](https://www.bestpractices.dev/) — self-certification questionnaire for the repository. |

For workflow and token hygiene used in CI, see [`security-hardening.md`](./security-hardening.md).

---

## Dependency Scanning

Automated vulnerability scans run on every PR and nightly:

- **`bun audit`** — npm dependency advisory checks
- **`trivy`** — filesystem and container vulnerability scanning
- **`CodeQL`** — static analysis for JS/TS

HIGH and CRITICAL findings block merges when branch protection checks are required. Dependabot opens update PRs automatically for outdated dependencies.