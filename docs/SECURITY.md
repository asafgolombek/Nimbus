# Security Policy

## Supported Versions

Nimbus is in active development (Phase 4 — Presence; Phase 3.5 Observability is complete). Only the latest commit on `main` receives security fixes. There are no stable release branches yet.

| Branch / Tag | Supported |
|---|---|
| `main` (HEAD) | ✅ Yes |
| Older commits | ❌ No |

Once versioned releases begin (target: Phase 4 — `v0.1.0`), this table will be updated with a supported version range.

### Linux runtime support — glibc floor

Starting with releases built on or after 2026-04-24, Nimbus Linux binaries are compiled on Ubuntu 24.04 runners and require **glibc ≥ 2.39** at runtime. Supported distros (tested): Ubuntu 24.04+, Fedora 40+, Debian 13+, Arch and other current rolling releases. Older distros (Ubuntu 22.04 LTS, Debian 12, RHEL 9 and their derivatives) will emit a `GLIBC_2.39 not found` dynamic-linker error on launch; no workaround beyond upgrading the host OS.

macOS and Windows binaries are unaffected by this change.

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

- Have their manifest SHA-256 hash verified on every Gateway startup — a tampered manifest causes the extension to be disabled before it runs
- Are also re-hashed via `verifyOneExtensionStrict` immediately before any pre-spawn check to catch mutations between startup verify and child spawn (S7-F3 fix)
- Are installed only from non-symlinked source trees (`scanForSymlinks` rejects any symlink in the source) and tar archives are extracted with explicit safety flags (`--no-overwrite-dir`, `--no-same-owner`, `--no-same-permissions`) plus a post-extract path-traversal sweep (`assertNoEntryEscapes`) that refuses any entry whose final-path resolve falls outside the install root (S7-F4, S7-F5 fixes)

**Extension isolation.** Extensions run as child processes spawned by the gateway. They share the gateway's user UID and have full filesystem and network access at that UID's permissions — there is no `seccomp` / `bwrap` / `sandbox-exec` / AppContainer sandbox in this release. The only structural barriers are: (a) `extensionProcessEnv()` filters parent-process environment variables, blocking propagation of OAuth client secrets and LLM provider API keys; (b) startup SHA-256 verification detects post-install drift and disables affected rows; (c) the same SHA-256 is re-checked immediately before each spawn (S7-F3 fix). OS-level sandboxing is on the Phase 7 roadmap. Until then, extensions must be considered code that runs at full user-UID equivalence — do not install extensions from untrusted sources.

---

### IPC Surface

The Gateway listens only on a local domain socket (Unix) or named pipe (Windows), created with owner-only permissions (`chmod 0600` on Unix; DACL owner-only on Windows). There is no TCP listener. No Nimbus Gateway port is opened on any network interface.

> **⚠️ LAN Server (Phase 4 WS5) — pre-flight security audit in progress:** The LAN TCP server (`nimbus lan enable`) is implemented but not yet wired into the production gateway entrypoint. A security audit has identified several gaps — including the method-allowlist gate not being called in the production path — that must be resolved before the feature is enabled. Do **not** force-enable the LAN server via config or environment hacks; it is not secure until the audit findings are addressed. Tracked in branch `dev/asafgolombek/security-audit`.

> **⚠️ Auto-updater (Phase 4 WS4) — pre-flight security audit in progress:** The auto-update pipeline (`nimbus update`) is implemented but not yet wired into the production gateway entrypoint. A security audit has identified that the `NIMBUS_DEV_UPDATER_PUBLIC_KEY` environment override is honoured in production builds (no build-time gate), and that the download does not re-verify the version order before proceeding. These gaps must be fixed before the updater is enabled. Tracked in branch `dev/asafgolombek/security-audit`.

---

### Prompt Injection

**Tool output envelope.** Every tool result that flows into an LLM context — both gateway-internal read tools (`searchLocalIndex`, `getAuditLog`, etc.) and MCP-backed tools — is wrapped in a textual `<tool_output service="…" tool="…">…</tool_output>` envelope at the LLM-facing boundary. Literal `</tool_output>` substrings in the tool body are escaped to `<\/tool_output>` so an attacker-controlled tool result cannot terminate the envelope and re-enter "instruction mode". The agent's system prompt instructs the model to treat content inside this tag as data, not instructions.

The bare result still flows through the planner path (`ConnectorDispatcher` → `ToolExecutor`), where the structural HITL gate is the defense regardless of LLM compliance. This is a soft defense for the conversational read-tool surface (probabilistic LLM compliance); the HITL gate remains the structural defense for destructive actions.

The hard structural barrier is the **HITL consent gate** in `executor.ts`: every action type in `HITL_REQUIRED` requires explicit user approval before the connector executes, regardless of what the LLM or an injected tool result requests. A malicious tool result cannot remove an action type from `HITL_REQUIRED`.

In addition to the textual labeling, MCP tool results are returned to the agent via the LLM-provider SDK's typed message channel (`tool_result` for Anthropic, `function_call_response` for OpenAI). The provider SDK structurally labels these as tool output — not as system instructions — which is the primary soft barrier against prompt injection.

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
- **`cargo audit`** — Rust dependency advisory checks (Tauri shell)
- **`cargo deny`** — license compatibility (AGPL-3.0 inbound), unmaintained-crate bans, registry pinning
- **`trivy`** — filesystem vulnerability scanning, SARIF uploaded to GitHub Security tab
- **`CodeQL`** — static analysis for JS/TS *and* Rust (security-extended queries)
- **`gitleaks`** — committed-secret detection on PRs and nightly
- **`OpenSSF Scorecard`** — supply-chain posture, weekly + on default-branch push
- **`@nimbus-dev/client`** is published with **npm provenance** (sigstore signature backed by GitHub OIDC); verify with `npm audit signatures`

HIGH and CRITICAL findings block merges when branch protection checks are required. Dependabot opens update PRs automatically for outdated dependencies.

Release binaries (Gateway + CLI, all four platform builds) carry a **GitHub build provenance attestation** (`actions/attest-build-provenance`) and a **CycloneDX SBOM**, both attached to the GitHub Release. Verify with:

```bash
gh attestation verify nimbus-gateway-linux-x64 --owner nimbus-dev
```

---

## Updater Signing Key Lifecycle

Nimbus auto-updates are gated on an **Ed25519 signature over a canonical JSON envelope** of `{ version, target, sha256 }` (see `packages/gateway/src/updater/signature-verifier.ts:verifyManifestEnvelope`). The verifier reconstructs this envelope from the manifest's claimed fields before checking the signature, so an attacker who replays a legitimate signed binary into a fresh manifest cannot mismatch the version/target without invalidating the signature. A legacy bare-SHA mode is retained for the migration window of one release; once the next signed manifest ships, the fallback is removed.

Update binaries are downloaded only over HTTPS (with an `http://127.0.0.1` test escape that is disabled in production). The download is hard-capped at 500 MiB (`MAX_DOWNLOAD_BYTES`) — any Content-Length above the cap is rejected before the body is read, and a streaming accumulator aborts mid-download if the running total exceeds the cap. Every `applyUpdate` invocation emits four ordered audit phases (`system.update.start` / `system.update.verified` / `system.update.installed` / `system.update.failed`) via the optional `recordUpdateEvent` callback, so `nimbus audit verify` shows install history.

The public key is embedded in the binary at build time (`packages/gateway/src/updater/public-key.ts`); the private key lives only in the `UPDATER_SIGNING_KEY` repository secret and is never present on a developer machine.

### Rotation procedure

Plan a rotation at least once every 12 months, and immediately on any of these triggers:

- A maintainer with secret-read access leaves the project.
- A CI run is suspected of having leaked the key (e.g., a workflow added an unintended `echo "$UPDATER_SIGNING_KEY"`).
- A new key algorithm becomes the default for the project.

**Steps (must all happen in the same release cycle):**

1. **Generate the new keypair** locally on an air-gapped or hardened workstation:
   ```bash
   bun scripts/generate-ed25519-keypair.ts > new-updater-key.json
   ```
2. **Update the embedded public key** in `packages/gateway/src/updater/public-key.ts` (and the test override `NIMBUS_DEV_UPDATER_PUBLIC_KEY` if used) on a feature branch. Land via PR.
3. **Cut a transitional release** that ships *both* the old and new public key as trusted (the updater accepts either signature). This release must be signed with the **old** key.
4. **Rotate the secret**: replace `UPDATER_SIGNING_KEY` in repository secrets with the new private key. Delete the local copy of the new private key from the workstation immediately after upload.
5. **Cut a second release** signed with the new key. Verify clients on N-1, N, and N+1 all auto-update successfully.
6. **Remove the old public key** from `public-key.ts` in the next release. Document the rotation in `docs/SECURITY.md` change history.

### Compromise response

If the active signing key is suspected to be compromised:

1. **Disable auto-update server-side** by setting the `latest.json` manifest's `version` to a pinned safe value and the `forcedUpdate` flag to `false`.
2. Generate a new keypair and ship a transitional release within 24 hours. Notify users via the GitHub Security advisory channel.
3. Revoke the leaked key by removing it from `public-key.ts` in the immediate follow-up release.
4. Audit the GitHub Actions workflow run logs for the period the key was active — look for any step that read `UPDATER_SIGNING_KEY` outside `scripts/sign-ed25519.ts`.

**Long-term mitigation:** the project is tracking migration to **sigstore/cosign with GitHub OIDC** for keyless updater signing, eliminating the long-lived secret entirely. Tracked under Phase 4 release-infra hardening.

---

## Release Signing Key

Nimbus release artifacts are distributed with a GPG-signed `SHA256SUMS.asc` integrity manifest (and per-artifact `.asc` sidecars on Linux). All release signing uses the single key whose fingerprint is published below.

**Project GPG fingerprint (v0.1.0 and later):**

```
PLACEHOLDER — real fingerprint lands when docs/release/v0.1.0-prerequisites.md §3 is completed by the maintainer.
Until then, releases are signed with a development test key; DO NOT install v0.1.0-rc releases in production.
```

**Cross-check this fingerprint against four sources** — if any two disagree, **do not install**; open a private security issue per "Reporting a Vulnerability" above:

1. This file (`docs/SECURITY.md`) — you're reading it now.
2. The repository README (`README.md`, "Install → Verify any download" section).
3. The public key ASCII-armored block at [`docs/release/SIGNING-KEY.asc`](release/SIGNING-KEY.asc).
4. Either keyserver — `keys.openpgp.org` or `keyserver.ubuntu.com`.

**To import the key from a keyserver:**

```bash
gpg --keyserver keys.openpgp.org --recv-keys <FINGERPRINT>
# or
gpg --keyserver keyserver.ubuntu.com --recv-keys <FINGERPRINT>
```

**First-time users:** the `nimbus-verify.sh` / `nimbus-verify.ps1` helper scripts print the fingerprint they imported before running `gpg --verify`. Match that printed value against this file, the README, and a keyserver lookup before allowing the script to touch your keyring. See [`docs/verify-release-integrity.md`](verify-release-integrity.md) for the full walkthrough.

**Key rotation.** When the project rotates its signing key, the transition runs over two releases: one signed by the old key but carrying the new fingerprint in the scripts' `TRUSTED_FINGERPRINTS` array, and a subsequent release signed by the new key only. See [`docs/verify-release-integrity.md#key-rotation`](verify-release-integrity.md#key-rotation) for the worked example.