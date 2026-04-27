# Feedback — Perf Audit (B2) Cluster C Design

**Date:** 2026-04-27
**Target Doc:** [`2026-04-27-perf-audit-cluster-c-design.md`](./2026-04-27-perf-audit-cluster-c-design.md)

## 1. Open Questions

1.  **S10 (SQLite Contention) Retry Visibility:** The current metric is `totalThroughputPerSec`. Should we also capture the `SQLITE_BUSY` retry count or total retry time? Throughput tells us *if* it slowed down, but retry counts tell us *how hard* the engine is fighting for the lock.
2.  **S7 (RSS) Sampling Resolution:** The default interval is `1000ms`. In the "heavy sync" (S7-b) workload, sync bursts or peak memory spikes might occur between samples. Should we consider a tighter interval (e.g., `250ms`) for the sync-heavy surfaces to ensure we don't miss the true peak?
3.  **MSW Dependency Verification:** The design notes that a grep for `node:http` and `axios` returned zero hits in `mcp-connectors`. Are there any transitive dependencies (e.g., a service-specific SDK) that might be using an internal requester that MSW doesn't catch by default? If so, do we need to wire up a custom MSW interceptor?
4.  **S8 (Embedding) MiniLM Warm-up:** For the in-process embedding bench, should we include a single "throwaway" embed call before the timer starts to ensure the model is fully loaded into memory/cache, or is the intention to include load time in the throughput?

## 2. Suggestions

1.  **S8 Wrapper Generation:** Since there are 12 cells for S8, consider using a small helper to generate the `SURFACE_REGISTRY` entries dynamically in `bench-cli.ts` rather than 12 manual exports, ensuring they all follow the same `S8-l{len}-b{batch}` naming convention.
2.  **Gateway Teardown Safety:** In `gateway-spawn-bench.ts`, if the `workload` rejects, ensure that we still `wait proc.exited` after the SIGTERM to prevent the next surface's gateway spawn from hitting a "port already in use" error if the previous gateway takes a few seconds to shut down.
3.  **Worker Error Detail:** For S10, when a Worker returns an `error` kind, include the stack trace if available. SQLite contention errors (like `Database is locked`) are often hard to debug without knowing exactly which query was in flight.
4.  **Audit Helper Reuse:** Ensure the S10 "audit" worker uses the identical `packages/gateway/src/db/write.ts` wrapper used in production to ensure the `SQLITE_FULL` and `DiskFullError` paths are exercised (or at least present) in the contention profile.
