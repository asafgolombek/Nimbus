# The Nimbus Sovereignty

> *"Your data exists. The question is whether you control it, or it controls you."*

---

## The Problem: Digital Feudalism

We did not choose fragmentation. It was imposed on us incrementally, one convenience at a time.

Your morning begins with a calendar notification from Google. Your files live across three cloud providers, replicated by agreements you did not read, governed by retention policies that change without notice. Your photographs are analyzed by models you did not authorize, powering advertising systems you never consented to join. Your email drafts are indexed before you send them. Your inbox is a product.

This is not paranoia. This is architecture — specifically, the architecture of systems designed to maximize data residency within a vendor's perimeter. The engineers who built these systems are not villains. They are rational actors optimizing for engagement, lock-in, and signal extraction. The result is a user who is, in every meaningful technical sense, a tenant — not an owner — of their own digital life.

The fragmentation compounds the problem. You do not have one cloud. You have five. Each has a different API, a different auth model, a different rate limit, a different definition of a "file." Searching across them requires four browser tabs and three logins. Automating across them requires a SaaS subscription that sits between you and your own data, extracting rent indefinitely.

The modern knowledge worker has more compute on their desk than was used to land on the moon. Yet they cannot, with a single command, answer: *"Where are all the documents I created last week, across every service I use?"*

This is the problem Nimbus exists to solve.

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

You cannot act on what you cannot find. Nimbus maintains a local metadata index of your entire digital footprint across every connected service. It understands filenames, timestamps, MIME types, semantic embeddings, and relational context. It exposes this through a unified query interface that speaks plain language. You ask; Nimbus knows.

### 2. Orchestration — The Ability to Act

Knowing where your data lives is inert without the ability to move, transform, and route it. Nimbus provides an agentic orchestration layer — a cognitive loop powered by the Mastra framework — that can reason across services, compose multi-step workflows, and execute them on your behalf. Move a file. Send a summary. Archive a thread. Organize last month's downloads. The actions are yours; the execution is delegated.

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

## Why Now

Three converging forces make this the right moment for Nimbus:

**The Runtime Exists.** Bun has closed the performance gap between TypeScript and native runtimes. A local-first orchestration layer no longer requires a compiled systems language to be fast enough to be useful.

**The Protocol Exists.** The Model Context Protocol provides a stable, composable standard for connecting AI reasoning engines to external tools and data sources. For the first time, it is possible to build a vendor-neutral connector mesh without writing custom integration glue for every service.

**The Models Are Capable.** The language models available today can understand intent, decompose tasks, reason across context windows, and produce structured outputs suitable for programmatic execution. The cognitive loop required to power a true digital assistant is no longer a research problem — it is an engineering one.

---

## What Nimbus Is Not

Nimbus is not a SaaS product. There is no Nimbus cloud, no Nimbus account, no Nimbus server holding your tokens.

Nimbus is not a consumer app built for the lowest common denominator. It is a platform for technically literate users who want to understand and control the systems that operate on their behalf.

Nimbus is not trying to replace your cloud providers. It is trying to make you their peer, rather than their subject.

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

*Nimbus — The Local-First Digital Lieutenant.*
