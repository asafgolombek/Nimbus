# Nimbus UX SLO Sheet

> **Status:** PR-B-2a — UX surfaces published with concrete thresholds; workload surfaces (S6, S7, S8, S9, S10) are flagged `TBD Phase 2` and will be filled in once `nimbus bench --reference` measurement runs land.
>
> **Spec source:** [`docs/superpowers/specs/2026-04-26-perf-audit-design.md`](../superpowers/specs/2026-04-26-perf-audit-design.md) §3.

## Reference hardware caveat

These figures are measured on a **2020 M1 MacBook Air, 8 GB / 256 GB**. Performance on x64 / older hardware is measured but **not threshold-gated** for `v0.1.0`; see GHA matrix results in [`history.jsonl`](./history.jsonl) for that baseline. The reference machine anchors the published SLO to a real-world worst-case "Nimbus runs on your existing laptop" profile; runs on equal-or-better hardware should meet or beat these targets.

## Threshold semantics

For every measurement entry, `threshold` is the maximum allowed value for the **specified percentile of a multi-run aggregate** (median-of-medians across 5 runs — see spec §4.5). Almost all UX rows use **p95**.

A bench fails when either:
- the measured aggregate exceeds the absolute reference or GHA threshold, **or**
- the run delta vs the most recent `main` history entry for the same `runner` exceeds the per-surface noise floor (`max(noise_floor_pct, absolute_noise_floor_ms / previous × 100)`).

## Surface table

| # | Surface | Class | Inputs / preconditions | Metric (aggregate) | Reference threshold | GHA threshold | Noise floor (rel %, abs) | Citation |
|---|---|---|---|---|---|---|---|---|
| S1 | Gateway cold start (PAL → IPC ready) | UX | none | p95 of cold-start ms across 5 fresh-process runs | **≤2 000 ms** | ≤10 000 ms | 25 %, 200 ms | Nielsen 1 s "flow" threshold¹ |
| S2-a | Query p95 (`engine.askStream`) — **10 K corpus** | UX | synthetic snapshot tier `small` | p95 ms across 5 runs × 100 queries | **≤30 ms** | ≤200 ms | 25 %, 5 ms | Nimbus product claim²; Nielsen 0.1 s perception threshold¹ |
| S2-b | Query p95 — **100 K corpus** | UX | synthetic snapshot tier `medium` | p95 ms across 5 runs × 100 queries | **≤80 ms** | ≤500 ms | 25 %, 10 ms | Nimbus product claim²; Nielsen 0.1 s perception threshold¹ |
| S2-c | Query p95 — **1 M corpus** | UX | synthetic snapshot tier `large`, **reference only** (skipped on GHA — corpus generation cost) | p95 ms across 5 runs × 100 queries | **≤300 ms** | n/a (reference only) | 25 %, 25 ms | Nimbus product claim²; Nielsen 1 s flow threshold¹ as ceiling |
| S3 | Dashboard first-paint | UX | synthetic snapshot tier `medium`, warm gateway | p95 ms across 5 cold-app launches | **≤1 500 ms** | ≤7 500 ms | 25 %, 100 ms | Nielsen 1 s flow threshold¹; RAIL Load budget³ |
| S4 | TUI first-paint (`nimbus tui` → first frame) | UX | warm gateway | p95 ms across 5 invocations | **≤500 ms** | ≤2 500 ms | 25 %, 50 ms | RAIL Response budget³; Nielsen 1 s ceiling¹ |
| S5 | HITL popup latency | UX | warm gateway, popup window pre-warmed | p95 ms (`consent.request` → renderer paint) across 20 invocations | **≤200 ms** | ≤1 000 ms | 25 %, 25 ms | RAIL Response budget³; Nielsen 0.1 s perception threshold¹ |
| S6 | Sync throughput per connector (Drive / Gmail / GitHub) | Workload | recorded HTTP trace via MSW; fetch-only | items/sec, p50 across 5 replays | TBD Phase 2 | per-OS TBD Phase 2 | 25 %, 5 items/sec | (workload surface — set after measurement) |
| S7-a | Memory RSS — **idle** | Workload | warm gateway, synthetic snapshot `medium`, **Linux only gates** (macOS/Windows informational) | p95 of `process.memoryUsage().rss` over 60 s sampling | TBD Phase 2 | n/a (Linux GHA only) | 20 %, 20 MB | (workload surface — set after measurement) |
| S7-b | Memory RSS — **heavy sync** | Workload | as S7-a + scripted parallel sync of 3 connectors | p95 RSS over the sync window | TBD Phase 2 | n/a | 20 %, 50 MB | (workload surface — set after measurement) |
| S7-c | Memory RSS — **multi-agent** | Workload | as S7-a + 3-sub-agent decomposition; **reference only** (requires loaded LLM, see S9) | p95 RSS during multi-agent run | TBD Phase 2 | n/a (reference only) | 20 %, 50 MB | (workload surface — set after measurement) |
| S8 | Embedding generation throughput (MiniLM) | Workload | synthetic text fixtures (50/500/5 000 chars; batch sizes 1/8/32/64) | items/sec by `(length, batch)`; matrix output | TBD Phase 2 | per-OS TBD Phase 2 | 25 %, 5 items/sec | (workload surface — set after measurement) |
| S9 | Local LLM round-trip (Ollama, `llama3.2:3b-instruct-q4_K_M`, warm-model) | Workload | canonical 3-prompt set; **reference only on Apple Silicon GPU**; GHA-skipped | first-token-ms p50 + tokens/sec median across 5 runs per prompt | TBD Phase 2 | n/a (skipped) | 30 %, 50 ms / 2 tps | (workload surface — set after measurement) |
| S10 | SQLite write throughput under contention | Workload | scripted concurrent writers (sync + watcher fire + audit append) against fresh DB | writes/sec p50 across 5 runs | TBD Phase 2 | per-OS TBD Phase 2 | 25 %, 100 writes/sec | (workload surface — set after measurement) |
| S11-a | CLI invocation overhead — **cold** (`nimbus help`) | UX | fresh process, no warm cache | p95 ms across 5 invocations | **≤300 ms** | ≤1 500 ms | 25 %, 50 ms | Nielsen 1 s flow threshold¹ |
| S11-b | CLI invocation overhead — **warm** | UX | second invocation within same shell | p95 ms across 5 invocations | **≤50 ms** | ≤250 ms | 25 %, 10 ms | RAIL Response budget³ |

## Surfaces shipped as stubs in PR-B-2a

S3 and S5 publish a target threshold but their bench drivers ship as stubs (return `[]`, write a per-surface `stub_reason` field) until renderer-side perf marks land in a follow-up PR scoped to `packages/ui/`. The bidirectional driver↔row mapping (spec §6 acceptance criterion 7) holds because `surfaces/bench-dashboard-first-paint.ts` and `surfaces/bench-hitl-popup.ts` exist and are registered.

## Citations

1. **Nielsen, J.** — *Response Times: The 3 Important Limits.* Nielsen Norman Group, 1993, updated at <https://www.nngroup.com/articles/response-times-3-important-limits/>. Three thresholds: 0.1 s = perceived as instantaneous; 1.0 s = limit of uninterrupted flow; 10 s = limit of attention.
2. **Nimbus product claim** — see [`docs/mission.md`](../mission.md): "local-first should feel snappier than SaaS." Concretely, sub-100 ms query latency on a 10 K-row local corpus is the floor that makes the claim defensible against cloud-hosted equivalents (typical SaaS dashboard query: ~200–500 ms RTT).
3. **Google** — *Measure performance with the RAIL model.* <https://web.dev/articles/rail>. Four budgets: Response ≤100 ms, Animation ≤16 ms / frame, Idle ≤50 ms work units, Load ≤1 s.

## What this sheet is not

- **Not a workload SLO.** S6 / S7 / S8 / S9 / S10 thresholds are filled in by Phase 2 (PR-C) once `nimbus bench --reference` has produced a baseline.
- **Not a `slo.md`.** Phase 2 renames this file to `docs/perf/slo.md` once the workload rows are populated.
- **Not a regression-tracking document.** The ongoing per-run history lives in [`history.jsonl`](./history.jsonl).
