/**
 * Build env for extension / isolated MCP child processes: explicit keys only (no `process.env` spread).
 * See architecture risk register — parent env must not leak into extensions by default.
 */
export function extensionProcessEnv(
  injected: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(injected)) {
    if (k !== "") {
      out[k] = v;
    }
  }
  return out;
}
