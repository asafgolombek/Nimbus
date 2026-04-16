/**
 * Removes common secret-bearing substrings before an error is returned to a client.
 * Server code should still log the original error with structured logging.
 */
export function sanitizeExternalError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replaceAll(/(key|token|secret|Bearer)\s*[=:]\s*\S{8,}/gi, "[REDACTED]");
}
