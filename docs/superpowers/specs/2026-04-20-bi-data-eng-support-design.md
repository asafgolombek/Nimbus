# BI & Data Engineering Support — Doc Integration

**Date:** 2026-04-20
**Scope:** Integrate `BI-AND-DATA-ENGINEERING-SUPPORT.md` proposal into the four canonical docs (`roadmap.md`, `README.md`, `mission.md`, `architecture.md`). No code changes — Phase 4 (Presence) remains the active implementation phase.

---

## Decision summary

| Decision | Choice | Reason |
|---|---|---|
| Phase placement | Split: personal-auth connectors → Phase 5; SSO-dominated connectors → Phase 6 | Snowflake / Tableau / Looker / PowerBI depend on enterprise SSO + service accounts that naturally map to Team Vault (Phase 6). Shipping them in Phase 5 would force single-user service-account workarounds. |
| `mission.md` depth | Full third persona section ("The Data Engineering Dimension") | The data workflow (lineage, metadata-only ingestion, cost attribution) is distinct from DevOps/SecDevOps, not a subset. Mission is the right place to record that distinction. |
| `README.md` depth | Persona row + new example session + Phase 5/6 connector listing | New example is the most persuasive artefact for a data persona visiting the README. |
| `architecture.md` depth | New connector subsection + schema `item_type` update + illustrative HITL action IDs + one-sentence overview addition + security-model row | Architecture is authoritative for item types and HITL surface — new categories must be recorded here. Code lands in Phase 5. |
| Phase 7 Cost Guard | Extend the existing stretch-item "Cost anomaly detection" with one line covering Snowflake credits and Databricks DBUs | Phase 7 already owns generic cost anomaly; don't duplicate. |
| Persona row title | "Analytics Engineer / Data Scientist" | Analytics Engineer covers dbt/lineage; Data Scientist covers the notebook use case. |

---

## Phase 5 — personal-auth data connectors (to add to `roadmap.md`)

Inserted between "GitOps & Deployment" and "Security & Vulnerability Tooling" under `Phase 5 — The Extended Surface`:

- **Databricks** (PAT) — workspaces, notebooks (metadata), jobs, clusters, SQL warehouses. `data_pipeline` item type. `job.trigger` / `job.cancel` / `cluster.restart` behind HITL.
- **Metabase** (API key) — saved questions, dashboards, collections. Read-only.
- **Superset** (API key) — saved queries, dashboards, charts, datasets. Read-only.
- **Apache Airflow (OSS) / Prefect / Dagster** (API token) — DAGs/flows, tasks, run statuses, logs. `data_pipeline` item type. `run.trigger` / `run.cancel` behind HITL.
- **Kibana / Elasticsearch** — saved searches, dashboards, Watcher alerts. `log_alarm` item type. Read-only.
- **AWS CloudWatch Logs / GCP Cloud Logging** — log groups, alarms, metric filters. `log_alarm` item type. `alarm.acknowledge` / `alarm.silence` behind HITL.
- **BigQuery** (ADC) — dataset/table schema metadata, expensive-query log. `data_model` item type. Read-only. No row data.
- **AWS Athena** — catalog metadata, saved queries, recent queries. Read-only.
- **dbt Cloud** (API token) — projects, models, runs, tests. `data_model` item type. `dbt.job.trigger` behind HITL.

**Acceptance additions (Phase 5):**

- Cross-stack query `nimbus ask "which dbt models feed the failing Tableau Snowflake dashboard?"` returns correlated results once Phase 6 BI connectors land.
- No raw row data or binary extract crosses the connector boundary at any point — verified by integration test that asserts connector tool surface has no row-fetch tool.

---

## Phase 6 — SSO-gated warehouse & BI connectors (to add to `roadmap.md`)

Inserted under "Identity & Access" under `Phase 6 — Team`:

- **Snowflake** (SSO / OAuth) — databases, schemas, tables/views (column metadata + tags only), tasks, pipe status. `warehouse.task.run` / `warehouse.pipe.resume` behind HITL.
- **Tableau Server/Cloud** — dashboards, reports, views, workbooks, authors, folders, extracts. Read-only except `bi.comment.post` behind HITL.
- **Looker** — dashboards, Looks, Explores, LookML models, content folders. Read-only; `bi.schedule.send` behind HITL.
- **PowerBI** — workspaces, reports, dashboards, datasets (metadata only), dataflows. Read-only; `bi.dataset.refresh` behind HITL.

**Acceptance addition (Phase 6):** cross-warehouse lineage query (Looker view → dbt model → Snowflake table → Airflow DAG → failing PR) resolves from the local index in under 500 ms.

---

## Phase 7 — Cost Guard extension (to edit `roadmap.md`)

Extend the existing stretch item "Cost anomaly detection" with one line: covers AWS Cost Explorer, Azure Cost Management, GCP Billing, and — once Phase 6 ships — Snowflake credits and Databricks DBUs from the same detection window.

---

## `mission.md` — new "Data Engineering Dimension"

Inserted after "The SecDevOps Dimension", before "The Security Compact". Four bullets:

- **Unified metadata layer across the data stack.** Local index spans dbt models, Airflow/Dagster DAGs, Databricks notebooks, Snowflake tables, Tableau/Looker dashboards. "Which dashboards depend on this model?" answered without opening five consoles.
- **Root-cause correlation from dashboard to commit.** When a production dashboard goes red, the agent assembles the chain (dashboard → Looker view → dbt model → warehouse table → DAG failure → PR) from indexed metadata.
- **Metadata-only by construction.** Connectors ingest DDL, job statuses, column tags, query plans — never rows, never binary datasets. The write path has no code for fetching row data.
- **Sovereign data context for local LLMs.** Lineage reasoning happens locally via Ollama; schema structures never leave the machine.

**"What Nimbus Is Not" addition:**

- **Not a data catalog or lineage server.** Nimbus indexes metadata so the agent can reason across the stack; it does not replace Atlan, Collibra, or DataHub — no row ingestion, no reconciliation pipelines, no governed glossary.

---

## `README.md` — additions

1. **Persona table row:** "Analytics Engineer / Data Scientist" — "Cross-stack lineage from dashboard to dbt model to Snowflake table to Airflow DAG — one local query instead of five consoles; metadata-only ingestion keeps row data on the warehouse."
2. **"What It Does" bash line** (under existing examples): `nimbus ask "The Q1 revenue dashboard shows zeroes — which upstream model broke?"` with inline comment "Data lineage — answered from the local index, no warehouse query".
3. **New example session block** after the SecDevOps example: Tableau dashboard → Looker view → dbt model → Airflow DAG → PR #842, with HITL-gated revert+rerun proposal.
4. **Connector listing lines** after Phase 3:
    - **Phase 5 (planned):** Databricks, Airflow, Prefect, Dagster, Metabase, Superset, Kibana/Elasticsearch, CloudWatch Logs, GCP Cloud Logging, BigQuery, Athena, dbt Cloud
    - **Phase 6 (planned, Team tier):** Snowflake, Tableau, Looker, PowerBI

---

## `architecture.md` — additions

1. **Overview paragraph** — append: "Nimbus also serves as a unified metadata layer for the data stack — dbt models, orchestration DAGs, warehouse schemas, and BI dashboards are indexed as first-class items so lineage queries resolve from the local index without additional warehouse calls."
2. **New subsection "Data Warehouse, Orchestration & BI Connectors"** after "Monitoring and Incidents" — three tables (warehouse/compute, orchestration, BI) with Tool / HITL / Indexed Item Type columns. Representative tool IDs below. Followed by data-minimization note.
3. **`item_type` schema comment** extended with `"data_model" | "data_pipeline" | "dashboard" | "log_alarm"` — marked Phase 5/6.
4. **Illustrative `HITL_REQUIRED` block** extended (marked "Phase 5/6 — forward-looking; not yet in executor.ts"):
    - `warehouse.task.run`, `warehouse.pipe.resume`, `warehouse.job.trigger`, `warehouse.job.cancel`
    - `orchestration.run.trigger`, `orchestration.run.cancel`, `dbt.job.trigger`
    - `bi.comment.post`, `bi.dataset.refresh`, `bi.schedule.send`
    - `alarm.silence`, `alarm.acknowledge`
5. **Security Model table new row:** "Row-data exfiltration via warehouse connector | Connector boundary forbids row/binary fetches; only DDL, column tags, job status, query plans cross into the index | MCP connector contract"

---

## New `item_type` values

| Item type | Produced by | Phase |
|---|---|---|
| `data_model` | dbt Cloud, Snowflake, BigQuery, Databricks | 5/6 |
| `data_pipeline` | Airflow, Prefect, Dagster, Databricks Jobs, dbt Cloud | 5 |
| `dashboard` | Metabase, Superset, Tableau, Looker, PowerBI, Kibana | 5/6 |
| `log_alarm` | Kibana Watcher, CloudWatch Logs, GCP Cloud Logging | 5 |

## New HITL action IDs

Forward-looking — to be added to `packages/gateway/src/engine/executor.ts` `HITL_REQUIRED` when the corresponding connectors land in Phase 5 / Phase 6. Listed here to keep `architecture.md` authoritative on the HITL surface.

`warehouse.task.run`, `warehouse.pipe.resume`, `warehouse.job.trigger`, `warehouse.job.cancel`, `orchestration.run.trigger`, `orchestration.run.cancel`, `dbt.job.trigger`, `bi.comment.post`, `bi.dataset.refresh`, `bi.schedule.send`, `alarm.silence`, `alarm.acknowledge`.

---

## Out of scope

- Code changes to `executor.ts`, connector mesh, or schema migrations — Phase 4 remains active.
- Proposal's Phase 8 "shared data namespaces" — Phase 6 already covers shared namespaces; no Phase 8 change.
- Deep per-connector pages in the docs site — deferred to Phase 5+ content cadence per existing roadmap note.

---

## Execution order

1. `roadmap.md` — Phase 5 data subsection, Phase 6 BI subsection, Phase 7 Cost Guard one-liner, "Last updated" note bump.
2. `mission.md` — "Data Engineering Dimension" section + "What Nimbus Is Not" row.
3. `README.md` — persona row, example line, full example session, connector listing lines.
4. `architecture.md` — overview sentence, new connector subsection, `item_type` schema comment, HITL illustrative block, security-model row.
5. No changes to `CLAUDE.md` / `GEMINI.md` — those track phase status and code layout; this is doc-only.
