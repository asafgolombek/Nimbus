# The Nimbus Sovereignty

> *"Your data exists. The question is whether you control it, or it controls you."*

---

## The Problem: Digital Feudalism

We did not choose fragmentation. It was imposed on us incrementally, one convenience at a time.

Your morning begins with a calendar notification from Google. Your files live across three cloud providers, replicated by agreements you did not read, governed by retention policies that change without notice. Your photographs are analyzed by models you did not authorize, powering advertising systems you never consented to join. Your email drafts are indexed before you send them. Your inbox is a product.

This is not paranoia. This is architecture — specifically, the architecture of systems designed to maximize data residency within a vendor's perimeter. The engineers who built these systems are not villains. They are rational actors optimizing for engagement, lock-in, and signal extraction. The result is a user who is, in every meaningful technical sense, a tenant — not an owner — of their own digital life.

The fragmentation compounds the problem. You do not have one cloud. You have five. Each has a different API, a different auth model, a different rate limit, a different definition of a "file." Searching across them requires four browser tabs and three logins. Automating across them requires a SaaS subscription that sits between you and your own data, extracting rent indefinitely.

The modern knowledge worker has more compute on their desk than was used to land on the moon. Yet they cannot, with a single command, answer: *"Where are all the documents I created last week, across every service I use?"*

This is the problem Nimbus exists to solve — for the knowledge worker managing their documents, and for the engineer managing their software.

---

## The Developer's Burden: Fragmented Pipelines

The software engineer's version of this problem is acute and daily.

Your pull request lives in GitHub. Your pipeline runs in Jenkins. Your deployment status is reported in Argo. Your tickets are in Jira. Your on-call alert fired in PagerDuty. Your logs are in Datadog. Your team's discussion about the incident is in Slack. Understanding the full state of a single production issue requires seven browser tabs, four logins, and a mental model that degrades with every context switch.

This is not a tooling failure. These are each excellent tools, operating correctly within their designed boundaries. The failure is at the composition layer — the place where none of them talk to each other unless you pay for an integration, build one yourself, or accept that a third-party SaaS intermediary now holds credentials to all of them simultaneously.

The developer who wants to ask *"What is the current state of every open PR in my org, and which ones are blocking a failing deployment?"* cannot do it with a single command. They cannot do it at all without writing a script, maintaining API tokens across four services, and rebuilding that script every time one of the services changes its rate limit or deprecates an endpoint.

The DevOps engineer who wants to ask *"Which Jenkins job last touched this Git ref, what was its exit status, and what changed in the repository between then and now?"* is navigating the same maze — just with YAML instead of browser tabs.

Nimbus exists for them too.

---

## The Principle: Local Sovereignty

Sovereignty is not a feature. It is a design constraint — one that must be enforced at the architectural level before any other decision is made.

Nimbus begins from a single, non-negotiable premise:

> **Your machine is the source of truth. The cloud is a remote appendage of it.**

This inverts the prevailing model. In the conventional paradigm, the cloud holds canonical state and your machine holds a cached, synchronized, often-stale replica. In the Nimbus model, your local index — stored in a compact, query-optimized SQLite database — is the authoritative catalog of your digital existence. Cloud providers are connectors: rich, capable, and useful, but never trusted unconditionally and never positioned above your local context.

This is not a nostalgic return to the pre-cloud era. The cloud is powerful and Nimbus leverages it fully. The distinction is one of **control topology**: who is primary, who is secondary, and who decides.

In Nimbus, you decide.

---

## The Architecture of Agency

True agency over your data requires four things, and Nimbus delivers all four:

### 1. Comprehension — The Ability to See

You cannot act on what you cannot find. Nimbus maintains a local metadata index of your digital footprint across every connected service. It understands filenames, timestamps, MIME types, short text previews, and (where shipped) **hybrid** full-text plus embedding recall over indexed metadata. It exposes this through a unified query interface that speaks plain language. You ask; Nimbus knows.

For the developer, that same index spans repositories across GitHub, GitLab, and Bitbucket; pipeline runs across Jenkins, GitHub Actions, CircleCI, and GitLab CI; issue states across Jira and Linear; Kubernetes workloads and cloud control-plane snapshots where you have connected AWS, Azure, or GCP; and monitors, dashboards, or incidents from Datadog, Grafana, Sentry, New Relic, and PagerDuty — all queryable as a single, coherent surface rather than a collection of disconnected vendor dashboards.

### 2. Orchestration — The Ability to Act

Knowing where your data lives is inert without the ability to move, transform, and route it. Nimbus provides an agentic orchestration layer — a cognitive loop powered by the Mastra framework — that can reason across services, compose multi-step workflows, and execute them on your behalf. Move a file. Send a summary. Archive a thread. Organize last month's downloads. The actions are yours; the execution is delegated.

For the engineer, that delegation extends to the entire development lifecycle: open a pull request, trigger a Jenkins job or GitHub Actions workflow, post a deployment comment, close an issue when a pipeline turns green, summarize a week of CI failures, apply or destroy infrastructure only after explicit approval, or correlate an on-call page with the last deployment — always with structural consent before irreversible or outbound steps. The cognitive loop that reasons across your documents reasons equally well across repositories, pipelines, clusters, and cloud accounts — because to Nimbus, they are all just connected services.

The interaction model matches the task model. Single commands — `nimbus ask "..."` — remain available for scripting, automation, and quick queries. But complex, multi-step work unfolds naturally in a persistent session: you ask, Nimbus acts, you refine, Nimbus continues. The session holds context across turns; a follow-up like "now move the ones from last month to the archive" is understood without re-specifying the search. HITL consent becomes a conversation step, not an interruption to a one-shot command. The Gateway is already a persistent process with memory — the session CLI makes that continuity visible to the user.

For work that repeats, script files extend this further. A YAML file containing an ordered sequence of natural language steps can be passed to `nimbus run` and executed as a single session — context accumulating across every step, HITL consent gates firing inline at each destructive action. Before any step executes, Nimbus presents a full preview of the plan and every action that will require approval. Nothing runs until you confirm. Scripts that contain only read operations run unattended — safe for automation and scheduled tasks.

### 3. Consent — The Ability to Refuse

This is the constraint that most automation systems omit, and its absence is where trust collapses. Every destructive, outgoing, or irreversible action in Nimbus — every delete, every send, every move — is gated behind an explicit Human-in-the-Loop consent checkpoint. The agent proposes; you approve or reject. The system cannot act on your behalf without your active confirmation for actions that cannot be undone.

This is not a UX decision. It is an ethical one, encoded directly into the runtime. It cannot be reasoned around by the model. It is structural.

### 4. Extensibility — The Ability to Grow

No single team can integrate every service worth integrating. Nimbus is therefore not a closed system. It is a platform. Third-party developers can build and publish extensions — new MCP connectors that slot into the Gateway and become available to the agent — without modifying the core. Extensions are sandboxed, permission-gated, manifest-verified, and discoverable through a local marketplace. The ecosystem grows; the security model holds.

---

## The Four Commitments

### Commitment One: Security by Architecture

Nimbus makes no security promises that are not also security proofs. Credentials are stored in the OS-native keystore because there is no code path that writes them anywhere else — not in a config file, not in a log line, not in an IPC response. The HITL gate blocks destructive actions because it is implemented in the executor, not in the prompt. An LLM cannot reason its way around a function call that does not exist.

Security in Nimbus is not a checklist appended after implementation. It is the shape of the implementation itself.

### Commitment Two: Testing as a First-Class Concern

A system that orchestrates real actions against real data — sending emails, deleting files, moving documents — cannot rely on the developer's confidence that it works. Every behavioural contract in Nimbus is verified by automated tests that run on every commit, across every supported platform, in parallel.

The HITL gate has unit tests that prove it fires for every destructive action type. The Vault has contract tests that prove it never exposes secret values through any interface. The extension sandbox has integration tests that prove an extension running in a child process cannot reach the Gateway's internals. The CI matrix runs on Windows, macOS, and Linux simultaneously because a test that only runs on one platform is a guess about the other two.

Tests in Nimbus are not bureaucracy. They are the only honest form of documentation for a system that acts autonomously on your behalf.

### Commitment Three: Platform Equality

Your operating system is not a second-class citizen. Windows, macOS, and Linux receive identical feature parity, identical CI coverage, and identical security guarantees. Platform-specific code — IPC transport, secret storage, autostart registration, notification delivery — is isolated behind typed abstraction interfaces and never allowed to leak into business logic.

A feature that works on macOS and "probably works" on Windows is a bug, not a release. The CI matrix enforces this mechanically: every pull request must pass on all three platforms before it can merge.

### Commitment Four: Open Ecosystem

The value of Nimbus compounds with every service it can reach. The extension system is designed so that writing a new connector feels like an afternoon's work — not an integration project. The `@nimbus-dev/sdk` package provides typed scaffolding, the manifest schema is validated at install time, the `nimbus scaffold` command generates a working server in seconds, and the in-app marketplace makes community extensions discoverable with one click.

The hard problems — OAuth token management, credential storage, sync scheduling, HITL enforcement for write operations — are handled by the Gateway. Extension authors focus on their service's API, not on reinventing infrastructure.

---

## The Security Compact

Sovereignty carries responsibility. When your machine is the source of truth, the perimeter of that trust is the machine itself — not a remote server with a dedicated security team, not a cloud vault behind multi-factor authentication enforced by a third party.

Nimbus secures everything within its boundary rigorously. Credentials are stored in the OS-native keystore — there is no code path that writes them elsewhere. The HITL gate blocks destructive actions architecturally — an LLM cannot reason around it. The local index is never transmitted to a relay server. Extensions run in sandboxed child processes with declared, enforced permissions. Every security contract is verified by automated tests on every commit, across all three platforms.

But Nimbus's security boundary ends at the process edge. What sits below it — the operating system, the disk, the physical machine — is outside Nimbus's control. And that boundary matters.

If your machine is logged in and unattended, Nimbus's internal protections are intact — but an attacker already has access to everything the operating system exposes. The OS-native keystore (DPAPI, Keychain, libsecret) protects against offline attacks such as a stolen disk or cold boot. It does not protect against malware running live on your machine with user-level privileges, which can call the same keystore APIs Nimbus uses. If someone with physical access can boot from a USB drive or pull the disk without encountering encryption, OS-level protections do not hold.

This is not a gap to patch. It is a direct consequence of the model. You chose local sovereignty. That sovereignty is real — and so is the responsibility that comes with it.

**Nimbus assumes the following on your side:**

- Your machine is protected by a strong login password or biometric authentication
- You lock your screen when stepping away — especially in shared or semi-public environments
- You store your machine in a location where untrusted parties cannot freely access it
- Your disk is encrypted — FileVault on macOS, BitLocker on Windows, LUKS on Linux; your OS provides this natively
- Antivirus or endpoint protection is active — resident malware with user privileges can reach the same secrets Nimbus holds
- You apply OS security updates in a reasonable timeframe
- Nimbus runs under your personal user account, not a shared one

These are not onerous requirements. They are the baseline expectations of any system where the machine, not a cloud server, holds the keys. The cloud model outsources these responsibilities to vendors — and charges you data sovereignty for the privilege. The Nimbus model returns those responsibilities to you — and with them, the control.

### The Consent Checkpoint Is Not a Formality

There is a second dimension to shared responsibility, distinct from physical security. Every destructive, outgoing, or irreversible action in Nimbus requires your explicit approval before it executes. That checkpoint is not a speed bump — it is the moment of ownership transfer.

When Nimbus proposes to delete a file, send a message, push a commit, or apply a Terraform plan, and you confirm, you own the outcome. Nimbus cannot act on your behalf without your active authorisation. That means the authorisation is meaningful.

This places an obligation on both sides. Nimbus's obligation is to describe every proposed action accurately and completely — in plain, unambiguous language — before asking for your approval. If Nimbus describes an action misleadingly and you approve based on that description, the failure is Nimbus's. The responsibility transfer is only valid when the information you acted on was honest.

Your obligation is to read what is proposed, understand it, and approve only when you intend to. The consent checkpoint exists precisely so that no action can be attributed to automation, miscommunication, or assumption. When you approve, you are the final authority — and the final accountable party.

The cloud model diffuses this accountability deliberately. Who deleted that file — was it the sync client, the automation rule, the SaaS workflow? In Nimbus, the answer is always traceable to a specific approved action, and the approval is always yours. This is not a burden. It is what agency actually looks like.

---

## The Developer Dimension

Software engineers are not a secondary audience for Nimbus — they are the audience most acutely harmed by the fragmentation problem and best positioned to leverage a platform that fixes it.

### The DevOps Fragmentation Problem

A modern development organisation runs across a mesh of platforms that were not designed to speak to each other:

| Layer | Typical Tooling |
|-------|----------------|
| Source control | GitHub, GitLab, Bitbucket |
| CI/CD | Jenkins, GitHub Actions, GitLab CI, CircleCI, Buildkite |
| Issue tracking | Jira, Linear, GitHub Issues, GitLab Issues |
| Deployments | ArgoCD, Flux, Render, Vercel, custom scripts |
| Monitoring | Datadog, Grafana, PagerDuty, Sentry |
| Communication | Slack, Teams, GitHub Discussions |

Each layer has an API. Most have webhooks. None of them share a common identity model, a common query language, or a common action schema. Building cross-layer automation today means writing glue code, managing token rotation across every service, paying for a workflow SaaS that becomes a single point of credential exposure, or simply not automating at all.

Nimbus provides the missing composition layer — local, credential-safe, and extensible.

### What Developer Sovereignty Looks Like

**Unified repository intelligence.** A single query surfaces open PRs, their CI status, their reviewers, and their merge conflicts — whether the repositories live on GitHub, GitLab, or Bitbucket. You are not searching three dashboards; you are querying one local index.

**Pipeline awareness.** Nimbus indexes pipeline runs — success, failure, duration, triggering commit, artefact output — and correlates them against the repository events that caused them. "Which Jenkins jobs have been failing consistently since the last deploy to production?" is a question you can ask in plain language.

**Consent-gated CI/CD actions.** Triggering a build, merging a PR, cutting a release tag, or restarting a failed job are write operations that go through the same HITL consent gate as any other irreversible action. The agent proposes; you approve. An LLM cannot silently push to main.

**Cross-service workflow automation.** "When this PR is approved, trigger the staging pipeline, post the deployment URL to the PR, and create a release ticket" is a Nimbus workflow — a multi-step plan that spans three platforms, executes sequentially, pauses at every destructive step for human sign-off, and rolls up a status summary when done.

**Local credential safety.** Your GitHub PAT, your GitLab deploy token, your Jenkins API key — all stored in the OS-native keystore, never in a config file, never transmitted to a relay server, never visible in a log line. The same vault model that protects your Google credentials protects your CI credentials.

### The Engineer as Extension Author

Developers are also the natural authors of Nimbus extensions. If your organisation runs an internal GitLab instance, or a bespoke deployment system, or a legacy Jenkins setup with a non-standard API — you can write an MCP connector that teaches Nimbus to speak to it. The `@nimbus-dev/sdk` package provides the scaffolding; `nimbus scaffold` generates a working server in minutes; and the extension runs in a sandboxed child process with declared permissions that the Gateway enforces.

The result is an organisation-specific automation layer built on your own infrastructure, credentials stored on your own machine, logic owned and auditable by your own team — not by a vendor whose pricing, uptime, and data-handling policies you cannot control.

### Cloud Infrastructure — AWS, Azure, GCP

The cloud platforms your services run on are not separate from your development workflow — they are its downstream consequence. A deployment is a git commit that graduated. An alert is a pipeline run that reached production. A cost spike is a scaling decision that made it past the HITL gate.

Nimbus treats cloud infrastructure as a first-class data source in the developer's unified index.

**Observability queries.** "Which Lambda functions have error rates above 1% since yesterday's deployment?" draws on AWS CloudWatch, correlated against the Git commit that triggered the deploy. The answer is assembled from the local index — no console tabs, no credential juggling.

**Infrastructure state awareness.** Nimbus indexes resource state from Terraform state files, CloudFormation stacks, Azure Resource Manager, or Pulumi outputs — giving the agent a queryable picture of what is declared, what is deployed, and where they diverge. Drift between `terraform plan` and actual cloud state is surfaced proactively, not discovered during the next incident.

**Kubernetes awareness.** Pod status, recent restarts, events, and log summaries are indexed alongside the repository and pipeline data that produced the running image. "What changed between the image version running in prod and the one in staging?" is answered from the local index, not from four separate `kubectl` commands.

**Consent-gated cloud actions.** Applying a Terraform plan, triggering a CodeDeploy deployment, scaling an ECS service, or restarting a failing pod are infrastructure mutations that go through the same HITL consent gate as any other irreversible action. The agent proposes a specific, reviewable change; you approve or reject it. No silent cloud mutations.

Nimbus does not replace your cloud provider CLIs or IaC tooling. It adds the reasoning and cross-service correlation layer that they individually lack.

### Monitoring, Alerts, and Incident Context

An incident is not a single alert. It is a cascade — an alert that fired, correlated with a deployment that preceded it, correlated with a code change that introduced it, correlated with a PR that merged it, correlated with a CI run that approved it. Reconstructing that chain manually across PagerDuty, Grafana, GitHub, Jenkins, and Jira costs the first fifteen minutes of every incident response.

Nimbus eliminates that reconstruction step.

Monitoring data — from Datadog, Grafana, Sentry, PagerDuty, New Relic, AWS CloudWatch, Azure Monitor, or GCP Cloud Monitoring — is indexed alongside repository, pipeline, and deployment data. When an alert fires, the agent can immediately answer: "What was the last deployment before this alert? What changed in that release? Which engineer owns the affected service? Is there an open incident ticket?" — without querying four dashboards.

Incident management actions — acknowledging an alert, escalating an incident, posting a status update, silencing a noisy monitor — go through the HITL gate. The agent can draft the status update and propose the escalation; you confirm before anything is posted.

The result is not a monitoring tool. It is a reasoning layer over your monitoring tools — one that connects the alert you are looking at to the commit that caused it.

---

## Why Now

Three converging forces make this the right moment for Nimbus:

**The Runtime Exists.** Bun has closed the performance gap between TypeScript and native runtimes. A local-first orchestration layer no longer requires a compiled systems language to be fast enough to be useful.

**The Protocol Exists.** The Model Context Protocol provides a stable, composable standard for connecting AI reasoning engines to external tools and data sources. For the first time, it is possible to build a vendor-neutral connector mesh without writing custom integration glue for every service.

**The Models Are Capable.** The language models available today can understand intent, decompose tasks, reason across context windows, and produce structured outputs suitable for programmatic execution. The cognitive loop required to power a true digital assistant is no longer a research problem — it is an engineering one.

## The Roadmap to Sovereignty

The work of reclaiming agency is not completed in a single phase. It is a multi-year structural shift. Our roadmap reflects this progression from a foundational index to a fully autonomous, sovereign mesh.

### Phase 1 — Foundation ✅
* **The Unified Local Index:** SQLite FTS5 index for metadata across the filesystem.
* **The Secure Vault:** OS-native secret management (DPAPI, Keychain, libsecret) with zero plaintext exposure.
* **The Consent Gate:** Structural Human-in-the-Loop (HITL) enforcement for all irreversible actions.
* **The Engine:** Mastra-powered orchestration loop running locally.

### Phase 2 — The Bridge ✅
All 15 first-party MCP connectors shipped (Google Drive, Gmail, Google Photos, OneDrive, Outlook, Teams, GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Notion, Confluence, Discord opt-in) with delta sync, a unified `item`/`person` index (schema v5), the cross-service people graph, engine context ranker, `nimbus connector` CLI, and headless installers.

### Phase 3 — Intelligence (Active)
Semantic layer (`sqlite-vec`, hybrid search), Extension Registry v1, CI/CD and cloud connectors (Jenkins, GitHub Actions, AWS/Azure/GCP, Kubernetes, observability tools), workflow pipelines, watchers, Session CLI, script files, filesystem connector v2, and agent specialization — as laid out in [`roadmap.md`](./roadmap.md).

### Phase 4 — Presence
Tauri 2.0 desktop application, local LLM (Ollama/llama.cpp), multi-agent orchestration, Rich TUI, local voice interface (Whisper.cpp), data portability (export/import), tamper-evident audit log, and `v0.1.0` signed release.

### Phase 5 — The Extended Surface
New connector categories: browser/reading (Pocket, Readwise, browser history), IMAP email (Fastmail, ProtonMail, generic IMAP), finance (Expensify, Ramp, Stripe), CRM (HubSpot, Salesforce), HR (Greenhouse, Lever), and design (Figma, Miro). Extension Marketplace v2 with paid extensions and verified publishers.

### Phase 6 — Team
Nimbus-to-Nimbus federation (E2EE, no relay server), Team Vault, shared index namespaces, SSO/SAML/SCIM, multi-user HITL delegation, org-level policy engine, and a local admin console. Shared intelligence without surrendering local sovereignty.

### Phase 7 — The Autonomous Agent
Standing approvals, schedule-driven unattended workflows, automatic incident correlation, long-term agent memory, LoRA fine-tuning on user data, and an Infrastructure-as-Agent SRE loop. From a tool you query to a collaborator that watches, learns, and proposes.

### Phase 8 — Sovereign Mesh
Cross-device P2P index sync, iOS/Android mobile companion (E2EE LAN/WireGuard, no cloud relay), hardware vault integration (YubiKey/Ledger), Decentralized Identifiers, and the Digital Executor (dead man's switch with Shamir's Secret Sharing).

### Phase 9 — Enterprise
Docker/Helm/air-gapped deployment, SIEM audit log shipping, `nimbus compliance check`, SCIM provisioning, privilege management, formal security audit, and SLA-backed support — tied to the commercial license tier.

---

## What Nimbus Is Not

Nimbus is not a SaaS product. There is no Nimbus cloud, no Nimbus account, no Nimbus server holding your tokens.

Nimbus is not a consumer app built for the lowest common denominator. It is a platform for technically literate users — knowledge workers, engineers, and DevOps practitioners — who want to understand and control the systems that operate on their behalf.

Nimbus is not trying to replace your cloud providers, your source control hosts, or your CI/CD platforms. It is trying to make you their peer, rather than their subject — and to make all of them talk to each other without surrendering your credentials to an intermediary to do it.

Nimbus is not a CI/CD platform. It does not run your pipelines. It reasons about them, acts on them on your behalf, and connects them to everything else you care about.

Nimbus is not a cloud management console. It does not provision resources, manage IAM policies, or replace your cloud provider's control plane. It reads infrastructure state, surfaces drift and anomalies, and executes specific consent-gated actions against your existing cloud tooling.

Nimbus is not a log aggregator or APM system. It does not ingest, store, or stream your application logs or metrics. It queries summaries and anomalies from the tools that already do — Datadog, Grafana, CloudWatch — and correlates them against the rest of your development context.

Nimbus is not a prototype. Every design decision is tested, documented, and held to the same standard of rigour as production software — because for the person running it, it is production software.

---

## The Covenant

Every design decision in Nimbus is evaluated against a single question:

> **Does this return agency to the user, or does it erode it?**

If a feature requires phoning home, it is rejected. If a workflow can execute a destructive action silently, it is rejected. If a connector requires surrendering credentials to a third-party relay, it is rejected. If an extension can exceed its declared permissions, it is rejected. If a cross-platform gap means Linux users get fewer guarantees than macOS users, it is a defect.

This question applies to the license as much as to the code. Nimbus is published under AGPL-3.0. A permissive license like MIT would allow any vendor to take the Gateway, remove the privacy guarantees, and ship a hosted service that does exactly what Nimbus was built to resist — and contribute nothing back. AGPL-3.0 closes that path: anyone who runs Nimbus as a network service must publish their modifications under the same terms. The `@nimbus-dev/sdk` extension SDK is MIT-licensed separately, so that extension authors are not burdened by copyleft obligations. The dual-license structure is intentional: protect the core, keep the ecosystem open.

The build will be slower for this. The surface area will be smaller. The tradeoffs will sometimes be frustrating. This is the cost of sovereignty, and it is worth paying.

Nimbus is not a product roadmap. It is a commitment — to the principle that the person sitting at the keyboard should be the final authority over the data that belongs to them.

---

*Nimbus — The Local-First Digital Lieutenant. For your documents, your repositories, and your pipelines.*
