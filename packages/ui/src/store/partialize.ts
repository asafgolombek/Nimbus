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

type Whitelisted = (typeof WHITELISTED_PERSIST_KEYS)[number];

/**
 * Recursively walks `value` and deletes any key matching `FORBIDDEN_PERSIST_KEYS`,
 * regardless of nesting depth. Tolerates cycles via a seen-set. Mutates `value`
 * in place — callers supply an already-cloned/new value.
 */
function deepScrubForbidden(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) deepScrubForbidden(item, seen);
    return;
  }
  const rec = value as Record<string, unknown>;
  for (const forbidden of FORBIDDEN_PERSIST_KEYS) {
    if (forbidden in rec) {
      delete rec[forbidden];
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
