# Security Policy

## Supported Versions

Nimbus is currently in **active development (Phase 3 — Intelligence)**. Only the latest commit on `main` receives security fixes. There are no stable release branches yet.

| Branch / Tag | Supported |
|---|---|
| `main` (HEAD) | Yes |
| Older commits | No |

Once versioned releases begin (target: Phase 4 — `v0.1.0`), this table will be updated with a supported version range.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately via one of these channels:

1. **GitHub private vulnerability reporting** — use the "Report a vulnerability" button on the [Security tab](../../../security/advisories/new) of this repository (preferred)
2. **Email** — contact the maintainers directly at the address listed in the repository profile

Include as much of the following as possible:

- A clear description of the vulnerability and its impact
- The affected component(s) — e.g., Vault, HITL executor, IPC server, extension sandbox
- Steps to reproduce or a proof-of-concept (even partial)
- Your assessment of severity (CVSS score if available)
- Whether you believe it is platform-specific

You will receive an acknowledgement within **72 hours** and a status update within **7 days**.

---

## Security Model

Nimbus's security is structural — the guarantees below are enforced by the code, not by policy or configuration.

### Security Boundary

Nimbus owns and enforces security within its process boundary. What sits below that boundary — the operating system, the disk, the physical machine — is the user's responsibility.

**Nimbus's side:** credential storage, HITL enforcement, extension sandboxing, IPC access control, prompt injection defence, audit logging.

**User's side:** strong OS login or biometric authentication, screen locking when unattended, physical machine security, disk encryption (BitLocker / FileVault / LUKS), active endpoint protection, and timely OS security updates. The OS-native keystores (DPAPI, Keychain, libsecret) protect against offline attacks such as a stolen disk. They do not protect against malware running live on the machine with user-level privileges.

This boundary is why certain issue classes are listed as out of scope below — they describe vulnerabilities in the user's half of the model, not in Nimbus's.

### Credentials

OAuth tokens and all secrets are stored exclusively in the OS-native keystore:

| Platform | Backend |
|---|---|
| Windows | DPAPI (`CryptProtectData`) |
| macOS | Keychain Services |
| Linux | Secret Service API via `libsecret` |

There is no code path that writes credentials to disk in plaintext, includes them in log output, or returns them in IPC responses. The structured logger's `redact` configuration automatically censors any field matching token or secret patterns.

### Human-in-the-Loop (HITL) Consent Gate

Every destructive, outgoing, or irreversible action — delete, send, move — is blocked at the executor by a **frozen whitelist** (`HITL_REQUIRED` set in `packages/gateway/src/engine/executor.ts`). The agent cannot reason around it, configure around it, or inherit an extension that bypasses it. HITL is not a prompt instruction; it is a function call gate.

Approved and rejected decisions are written to the local audit log before any action is taken.

When a user approves a proposed action, responsibility for the outcome transfers to the user. Nimbus's obligation is to describe every proposed action accurately and completely before requesting consent. A user approving an action based on a misleading description is a Nimbus defect; a user approving an action they understood and intended is their own decision.

### Extension Sandbox

Third-party extensions run as child processes. They:

- Receive only the credentials for their declared service, via environment variable injection
- Cannot enumerate Vault keys
- Cannot connect to the IPC socket
- Cannot read other connectors' credentials
- Have their manifest SHA-256 hash verified on every Gateway startup — a tampered extension is disabled before it can run

### IPC Surface

The Gateway listens only on a local domain socket (Unix) or named pipe (Windows). There is no TCP listener. The IPC socket is created with permissions that restrict access to the current user.

### Prompt Injection

File content, email bodies, and external API responses are injected into the agent's context as typed `<tool_output>` data blocks and treated as untrusted data — not as instructions.

---

## Scope

The following are in scope for vulnerability reports:

- Vault / credential exposure through any interface
- HITL gate bypass — any path by which a destructive action executes without user consent
- Extension sandbox escape
- IPC authentication bypass or privilege escalation
- Prompt injection leading to unintended actions
- Dependency vulnerabilities with direct exploitability in the Nimbus runtime

The following are **out of scope**:

- Vulnerabilities in the user's OS keystore implementation (DPAPI, Keychain, libsecret) — these are the user's platform responsibility, not Nimbus's
- Issues requiring physical access to an unlocked or unencrypted machine — physical and OS security are the user's side of the shared responsibility boundary
- Theoretical attacks with no practical exploit path
- Rate limiting or DoS on the local IPC socket (the socket is already local-only)

---

## Dependency Scanning

Nimbus runs automated dependency vulnerability scans on every PR and on a nightly schedule:

- `bun audit` — checks npm dependencies against the advisory database
- `trivy` — container and filesystem vulnerability scanning
- `CodeQL` — static analysis for JS/TS

HIGH and CRITICAL findings from these tools block merges when branch protection checks are required. Dependabot opens update PRs automatically for outdated dependencies.
