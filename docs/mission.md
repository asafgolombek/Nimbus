# The Nimbus Mission

**Nimbus is a local-first AI agent built for DevOps engineers, security practitioners, and senior developers who run systems in production.** It runs on your machine, maintains a private index across your entire toolchain — source control, CI/CD, cloud infrastructure, monitoring, and incident management — and executes multi-step tasks on your behalf, with your explicit consent before any write, send, or delete. No cloud server holds your data. No API key is required for local queries. Every credential lives in your OS keystore.

---

Nimbus exists because engineers who run systems in production have no coherent way to reason across the tools they depend on. When an alert fires at 2am, the relevant context is split: the PR is in GitHub, the pipeline in Jenkins, the alert history in PagerDuty, the deployment in AWS, the metrics in Datadog, and the previous incident diagnosis in a Slack thread from three weeks ago. Assembling that picture requires seven browser tabs, four logins, and ten minutes you don't have.

That fragmentation is not accidental — it is the natural result of excellent tools that were never designed to talk to each other. Nimbus adds the missing composition layer: local, secure, and built for the professionals who pay the cost of that fragmentation every time they're on call.

---

## Design Principles

Every decision in Nimbus — architecture, features, licensing — is evaluated against one question:

> **Does this return control to the user, or does it erode it?**

The four principles that follow from this question are non-negotiable. They are not aspirational values on a poster; they are load-bearing constraints that shape how Nimbus is implemented.

---

### 1. Local-First

Your machine is the source of truth. The cloud is a connector.

Nimbus maintains a local SQLite metadata index of your digital footprint across every connected service. Most queries are answered from that index without a network call. Cloud providers are rich, useful data sources — but they are never positioned as the primary authority.

This is not anti-cloud. It is a control topology choice: you decide what is primary.

**Concrete consequences:**
- Credentials never leave your machine
- Search latency is ~20–80ms regardless of how many services are connected
- Nimbus functions without internet access for read queries once indexed
- There is no Nimbus server. There is no Nimbus account.

---

### 2. HITL Is Structural

Every destructive, outgoing, or irreversible action — delete, send, move, merge, deploy, apply — is blocked at the executor by a compile-time constant. The agent proposes; you approve or reject. This is not a prompt instruction. A model that generates a plan to "skip confirmation" produces a plan that does not execute.

**Why this matters:** Most automation tools implement consent as a UX feature — a modal, a flag, a setting. Those can be configured away. Nimbus's consent gate is a function call that does not exist if you do not call it. The model cannot reason around a missing function.

This places a real obligation on Nimbus: every proposed action must be described accurately and completely before asking for your approval. A misleading description that causes you to approve an action you did not intend is a Nimbus defect. An action you understood and chose to approve is your decision.

---

### 3. No Plaintext Credentials

OAuth tokens and API keys are stored exclusively in the OS-native keystore (Windows DPAPI, macOS Keychain, Linux Secret Service). There is no code path that writes them to disk, logs, IPC responses, or environment variables persisted outside the spawn context. The structured logger's `redact` config automatically censors token and secret patterns before any log line is written.

This is not a policy. It is an absence of code paths.

---

### 4. MCP as the Connector Standard

The Engine never calls cloud APIs directly. Every integration — local filesystem, Google Drive, GitHub, Jenkins, AWS — is an MCP server. This constraint is load-bearing:

- Every tool call is auditable through the same interface
- Every connector is independently replaceable without touching the engine
- Third-party connectors plug into the same system as first-party ones
- The Engine does not accumulate cloud-specific knowledge

---

## The Developer Dimension

Software engineers are not a secondary audience — they are the users most immediately harmed by the fragmentation problem.

### What It Looks Like in Practice

**Unified repository intelligence.** One query surfaces open PRs, their CI status, their reviewers, and their merge conflicts — whether the repos live on GitHub, GitLab, or Bitbucket. One local index, not three dashboards.

**Pipeline awareness.** Nimbus indexes pipeline runs — status, duration, triggering commit, artifact output — and correlates them against the repository events that caused them.

**Cross-service incident context.** When an alert fires, the agent can immediately answer: what was the last deployment before this alert? What changed in that release? Which PR merged it? What CI run approved it? That reconstruction step — normally the first fifteen minutes of any incident — happens in seconds from the local index.

**Consent-gated CI/CD and infrastructure actions.** Triggering a build, merging a PR, applying a Terraform plan, scaling a pool — all write operations go through the same HITL gate as any other irreversible action. The agent proposes a specific, reviewable change; you approve or reject. An LLM cannot silently push to main.

**Local credential safety.** Your GitHub PAT, your Jenkins API key, your AWS access key — all stored in the OS-native keystore, never in a config file, never transmitted to a relay server, never visible in a log line.

### Engineers as Extension Authors

If your organisation runs an internal GitLab instance, a bespoke deployment system, or a legacy monitoring tool — you can write an MCP connector that teaches Nimbus to speak to it. The `@nimbus-dev/sdk` package provides typed scaffolding. `nimbus scaffold` generates a working server in minutes. The extension runs in a sandboxed child process with declared permissions that the Gateway enforces. The result is organisation-specific automation built on your own infrastructure, owned and auditable by your own team.

---

## The SecDevOps Dimension

Security engineers face the same fragmentation problem, with higher stakes: the signal is split across five systems, the context needed to triage it is in five more, and by the time the picture is assembled the window to act has narrowed.

**Vulnerability triage without tab-switching.** When a CVE drops, Nimbus answers in one query: which of your indexed repos depend on the affected package? Which open PRs are touching those files? Who owns the services at risk? The answer comes from the local index — no new API calls, no rate limits.

**Alert-to-commit in seconds.** A PagerDuty P1 becomes an incident timeline: last deployment before the alert, the PR that introduced the change, the CI run that approved it, the Slack thread where a similar issue was discussed last quarter. Nimbus assembles this from indexed data — no additional API calls required.

**Consent-gated remediation.** When the agent proposes a rollback, a restart, or an infrastructure change in response to an incident, it goes through the same structural HITL gate as every other write action. The security model that protects you during normal operation applies equally under incident pressure.

**Compliance-grade audit trail.** Every action the agent takes — including every approval and rejection decision — is written to a local SQLite audit log before the action executes. The log is append-only and locally controlled. Phase 4 adds BLAKE3 tamper-evidence; Phase 9 adds shipping to SIEM targets (Splunk, Elastic, Datadog Logs).

**Local credential model for sensitive environments.** Your PagerDuty token, AWS access key, GitHub PAT — none of them leave your machine. They live in the OS-native keystore (DPAPI on Windows, Keychain on macOS, libsecret on Linux). There is no Nimbus cloud that could be breached to expose them.

---

## The Data Engineering Dimension

Analytics engineers and data scientists live in a stack that is, if anything, more fragmented than the DevOps surface: source code in dbt, orchestration in Airflow, compute in Databricks or Snowflake, visualisation in Tableau or Looker. When a production dashboard goes red, the failure is usually five systems away from the person looking at it.

**Unified metadata layer across the data stack.** One local index spans dbt models, Airflow or Dagster DAGs, Databricks notebooks, Snowflake tables and views, and Tableau / Looker dashboards. "Which dashboards depend on this model?" and "which notebooks read this table?" are answered in one query against the local index.

**Root-cause correlation from dashboard to commit.** When a production Tableau or Looker dashboard fails, the agent assembles the chain — failing dashboard → upstream view → dbt model → warehouse table → orchestration DAG failure → the GitHub PR that changed the model — from indexed metadata. The same correlation that works for incidents works for broken pipelines.

**Metadata-only by construction.** Warehouse and BI connectors ingest schema definitions (DDL), column tags, job statuses, and query plans. They do not ingest rows, result sets, or binary extracts — there is no code path in any connector that fetches them. The same boundary applies to local data files: the filesystem connector reads Parquet footers, CSV / JSONL headers, and file-level row-count estimates — never row contents, first-row samples, or cell values. The agent has a data catalog's visibility without the data-exfiltration surface of a SaaS catalog.

**Sovereign data context for local LLMs.** Lineage reasoning and schema-aware query generation happen fully locally via Ollama. Schema structures and column names — which themselves can be sensitive — never leave the machine.

## The Security Compact

Sovereignty requires responsibility. When your machine is the source of truth, the perimeter of trust is the machine itself — not a remote server with a dedicated security team.

**Nimbus secures everything within its process boundary.** Credentials are in the OS keystore. The HITL gate is in the executor. The local index is never transmitted. Extensions are sandboxed. Every contract is verified by automated tests across all three platforms on every commit.

**Below the process boundary is your responsibility:**

- Strong OS login or biometric authentication
- Screen locking when unattended
- Disk encryption (BitLocker / FileVault / LUKS)
- Active endpoint protection — the OS keystores protect against stolen-disk attacks; they do not protect against malware running live with user-level privileges
- Timely OS security updates

This is the direct consequence of local sovereignty. The cloud model outsources these responsibilities to vendors at the cost of control. The Nimbus model returns them to you — and with them, the corresponding accountability.

---

## What Nimbus Is Not

**Not a SaaS product.** There is no Nimbus cloud, no Nimbus account, no Nimbus server.

**Not a consumer app.** Nimbus is built for engineers, DevOps practitioners, and security professionals who want to understand and control the systems operating on their behalf. It is production software built to production standards — there is no onboarding wizard designed for non-technical users.

**Not a tool that phones home.** Your OAuth tokens, API keys, cloud credentials, and indexed data never leave your machine. There is no Nimbus cloud service. There is no telemetry without explicit opt-in. There is no Nimbus server that could be breached to expose your credentials.

**Not a CI/CD platform.** Nimbus does not run your pipelines. It reasons about them, acts on them on your behalf, and connects them to everything else you care about.

**Not a cloud management console.** Nimbus does not provision resources or manage IAM. It reads infrastructure state, surfaces drift, and executes specific consent-gated actions against your existing cloud tooling.

**Not a log aggregator or APM.** Nimbus does not ingest or store your application logs or metrics. It queries summaries from the tools that already do — Datadog, Grafana, CloudWatch — and correlates them against the rest of your development context.

**Not a data catalog or lineage server.** Nimbus indexes metadata about your data stack — schemas, column tags, DAGs, dashboards — so the agent can reason across it. It does not replace Atlan, Collibra, or DataHub; it does not ingest row data, run reconciliation pipelines, or publish a governed glossary.

**Not a prototype.** Every design decision is tested and held to production standards — because for the person running it, it is production software.

---

## License Rationale

Nimbus is AGPL-3.0 because it exists to protect users, not to be extracted by vendors. MIT would allow any company to take the Gateway, strip the privacy guarantees, and ship a hosted "Nimbus Cloud" — extracting value from a project built precisely to resist that model. AGPL-3.0 closes the network service loophole: anyone running Nimbus as a service must publish their modifications under the same terms.

The `@nimbus-dev/sdk` extension SDK is MIT-licensed so extension authors are not burdened by copyleft.

**Commercial license:** Teams that need to embed Nimbus in a product, or organizations with compliance requirements that preclude AGPL, can purchase a commercial license. This also unlocks the planned Team tier (shared namespaces, Team Vault, multi-user HITL — Phase 6) and Enterprise tier (SSO/SCIM, audit log shipping to SIEM, Helm/Docker, SLA support — Phase 9) before those phases complete. Contact the maintainers.

Nimbus is sustainable only if the people and organizations who depend on it in production contribute to its development. The commercial license is how that works.

---

## Roadmap Philosophy

Nimbus uses phases, not calendar quarters. A phase completes when its acceptance criteria pass, not at a date boundary. This is deliberate: a system that orchestrates real actions against real data should not ship features on a deadline at the cost of correctness.

See [`roadmap.md`](./roadmap.md) for the full phase breakdown, acceptance criteria, and sequencing rationale.