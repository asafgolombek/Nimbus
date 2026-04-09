/**
 * Background sync infrastructure — rate limiting, scheduler (Q2 Phase 1).
 */

export {
  DEFAULT_QUOTAS,
  type Provider,
  type ProviderQuota,
  ProviderRateLimiter,
} from "./rate-limiter.ts";
export { SyncScheduler } from "./scheduler.ts";
export type {
  Syncable,
  SyncContext,
  SyncResult,
  SyncSchedulerConfig,
  SyncStatus,
} from "./types.ts";
