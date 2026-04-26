/**
 * Build env for MCP child processes: BASELINE_KEYS from host plus caller-supplied extras only.
 * No `process.env` spread — gateway-private vars (API keys, updater overrides) must not leak.
 */
const BASELINE_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "SYSTEMROOT",
  "BUN_INSTALL",
  "LANG",
  "TZ",
] as const;

export function extensionProcessEnv(extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of BASELINE_KEYS) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v;
  }
  return out;
}
