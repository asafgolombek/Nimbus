/**
 * Persist whitelist.
 *
 * Spec §2.1 persists exactly three slice surfaces (`connectors` / `model` / `profile`)
 * and nothing else. Transient state (HITL queue, tray, dashboard, audit, telemetry
 * counters, transient dialog state, pull progress, export/import progress, router
 * status, connection state) is memory-only and rebuilt on reconnect.
 *
 * The forbidden-key blocklist is redundant with the whitelist (none of the whitelisted
 * names collide with secrets today), but exists as defence in depth so that a future
 * slice typo cannot accidentally persist a secret value under a whitelisted name.
 */

export const WHITELISTED_PERSIST_KEYS = [
  // connectors slice
  "connectorsList",
  // model slice
  "installedModels",
  "activePullId",
  // profile slice
  "active",
  "profiles",
] as const;

export const FORBIDDEN_PERSIST_KEYS = [
  "passphrase",
  "recoverySeed",
  "mnemonic",
  "privateKey",
  "encryptedVaultManifest",
] as const;

/**
 * S2-F6 — mirror gateway-side `executor.ts:SENSITIVE_PAYLOAD_KEY` so the
 * persist-side scrubber catches the same connector-secret names. Catches
 * `apiToken`, `clientSecret`, `accessToken`, `refreshToken`, `bot_token`,
 * `api_key`, `app_password`, `Authorization`, etc. — independent of the
 * `FORBIDDEN_PERSIST_KEYS` exact-match list, which remains unchanged for
 * cross-surface stability.
 *
 * Keep in sync with packages/gateway/src/engine/executor.ts.
 */
const SENSITIVE_KEY_PATTERN = /(token|key|secret|password|credential|bearer|auth)/i;
// `pat` is short and would not match the generic pattern; treat it as exact.
const EXTRA_EXACT_KEYS: readonly string[] = ["pat"];

function isForbiddenKeyName(name: string): boolean {
  if ((FORBIDDEN_PERSIST_KEYS as readonly string[]).includes(name)) return true;
  if (EXTRA_EXACT_KEYS.includes(name)) return true;
  return SENSITIVE_KEY_PATTERN.test(name);
}

type Whitelisted = (typeof WHITELISTED_PERSIST_KEYS)[number];

/**
 * Recursively walks `value` and deletes any key matching `FORBIDDEN_PERSIST_KEYS`
 * OR the gateway-side sensitive-key pattern (S2-F6), regardless of nesting
 * depth. Tolerates cycles via a seen-set. Mutates `value` in place — callers
 * supply an already-cloned/new value.
 */
function deepScrubForbidden(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepScrubForbidden(item, seen);
    return;
  }
  const rec = value as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (isForbiddenKeyName(k)) {
      delete rec[k];
    }
  }
  for (const child of Object.values(rec)) {
    deepScrubForbidden(child, seen);
  }
}

export function persistPartialize(
  state: Record<string, unknown>,
): Partial<Record<Whitelisted, unknown>> {
  const out: Partial<Record<Whitelisted, unknown>> = {};
  for (const key of WHITELISTED_PERSIST_KEYS) {
    if (key in state) {
      // Structured clone so deep scrubbing never mutates the live store.
      out[key] = structuredClone(state[key]);
    }
  }
  // Top-level: strip any forbidden name that somehow matched a whitelist entry.
  for (const forbidden of FORBIDDEN_PERSIST_KEYS) {
    if (forbidden in out) {
      delete (out as Record<string, unknown>)[forbidden];
    }
  }
  // Deep: walk every persisted value and strip forbidden keys at any depth.
  deepScrubForbidden(out);
  return out;
}
