# The Nimbus Mission

Nimbus exists because the modern developer and knowledge worker have no coherent way to reason across the services they depend on. Your pull requests are in GitHub. Your pipeline is in Jenkins. Your tickets are in Jira. Your alerts are in PagerDuty. Your team's discussion of the incident is in Slack. Understanding any single situation requires seven browser tabs, four logins, and constant context-switching.

That fragmentation is not accidental — it is the natural result of excellent tools that were never designed to talk to each other. Nimbus adds the missing composition layer: local, secure, and extensible.

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

**Not a consumer app.** Nimbus is built for technically literate users — engineers, DevOps practitioners, knowledge workers — who want to understand and control the systems that operate on their behalf.

**Not a CI/CD platform.** Nimbus does not run your pipelines. It reasons about them, acts on them on your behalf, and connects them to everything else you care about.

**Not a cloud management console.** Nimbus does not provision resources or manage IAM. It reads infrastructure state, surfaces drift, and executes specific consent-gated actions against your existing cloud tooling.

**Not a log aggregator or APM.** Nimbus does not ingest or store your application logs or metrics. It queries summaries from the tools that already do — Datadog, Grafana, CloudWatch — and correlates them against the rest of your development context.

**Not a prototype.** Every design decision is tested and held to production standards — because for the person running it, it is production software.

---

## License Rationale

Nimbus is AGPL-3.0. MIT would allow any vendor to take the Gateway, strip the privacy guarantees, and ship a hosted "Nimbus Cloud" service — extracting value from a project that exists precisely to resist that pattern. AGPL-3.0 closes the network service loophole: anyone who runs Nimbus as a service must publish their modifications under the same terms.

The `@nimbus-dev/sdk` extension SDK is MIT-licensed separately so extension authors are not burdened by copyleft obligations.

Commercial license available for embedding Nimbus in a product without AGPL obligations — contact the maintainers.

---

## Roadmap Philosophy

Nimbus uses phases, not calendar quarters. A phase completes when its acceptance criteria pass, not at a date boundary. This is deliberate: a system that orchestrates real actions against real data should not ship features on a deadline at the cost of correctness.

See [`roadmap.md`](./roadmap.md) for the full phase breakdown, acceptance criteria, and sequencing rationale.