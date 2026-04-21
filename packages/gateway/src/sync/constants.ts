/** Lower bound for a connector's sync interval. Enforced by `connector.setConfig` (IPC) and any future `nimbus connector set-interval` path. */
export const MIN_SYNC_INTERVAL_MS = 60_000;
