const DEFAULT_MAX_BYTES = 4096;

/**
 * JSON audit line for persistence / IPC — bounded size to protect SQLite and logs.
 */
export function formatAuditPayload(payload: unknown, maxBytes = DEFAULT_MAX_BYTES): string {
  const serialized = JSON.stringify(payload);
  if (serialized.length > maxBytes) {
    return `${serialized.slice(0, maxBytes)}…[truncated]`;
  }
  return serialized;
}
