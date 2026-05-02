import type { Database } from "bun:sqlite";

import { countItemsForAnyService } from "../sync/scheduler-store.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  type ConnectorServiceId,
  GOOGLE_CONNECTOR_SERVICES,
  MICROSOFT_CONNECTOR_SERVICES,
} from "./connector-catalog.ts";
import type { CONNECTOR_VAULT_SECRET_KEYS } from "./connector-secrets-manifest.ts";

const GOOGLE_SERVICES = [...GOOGLE_CONNECTOR_SERVICES];
const MICROSOFT_SERVICES = [...MICROSOFT_CONNECTOR_SERVICES];

// ─── Per-service vault key helpers (Phase 4 A.3) ─────────────────────────────
//
// Each connector stores its OAuth token under a service-specific key in addition
// to the legacy shared provider key (`google.oauth` / `microsoft.oauth`).
// This prevents a connector with broader scopes from silently acting with
// permissions that were only granted to a narrower connector.

const GOOGLE_SERVICE_VAULT_KEYS: Partial<Record<ConnectorServiceId, string>> = {
  google_drive: "google_drive.oauth",
  gmail: "google_gmail.oauth",
  google_photos: "google_photos.oauth",
};

/** Shared + per-service keys for Google delegated OAuth (backup / restore on remove). */
export const ALL_GOOGLE_OAUTH_VAULT_KEYS: readonly string[] = [
  "google.oauth",
  "google_drive.oauth",
  "google_gmail.oauth",
  "google_photos.oauth",
];

const MICROSOFT_SERVICE_VAULT_KEYS: Partial<Record<ConnectorServiceId, string>> = {
  onedrive: "onedrive.oauth",
  outlook: "outlook.oauth",
  teams: "teams.oauth",
};

/**
 * Returns the per-service OAuth vault key for a Google or Microsoft connector,
 * or `undefined` for connectors that don't use provider-family OAuth.
 */
export function perServiceOAuthVaultKey(serviceId: ConnectorServiceId): string | undefined {
  return GOOGLE_SERVICE_VAULT_KEYS[serviceId] ?? MICROSOFT_SERVICE_VAULT_KEYS[serviceId];
}

/**
 * After a successful PKCE flow for `serviceId`, persist a copy of the token
 * under the per-service key in addition to the shared provider key already
 * written by pkce.ts. Idempotent — safe to call on re-auth.
 */
export async function writePerServiceOAuthKey(
  vault: NimbusVault,
  serviceId: ConnectorServiceId,
  sharedKey: string,
): Promise<void> {
  const key = perServiceOAuthVaultKey(serviceId);
  if (key === undefined) return;
  const payload = await vault.get(sharedKey);
  if (payload === null || payload === "") return;
  await vault.set(key, payload);
}

/**
 * One-time startup migration: copy `microsoft.oauth` to per-service Microsoft keys
 * when missing. Google is intentionally omitted: copying shared `google.oauth` into
 * empty per-service keys can install the wrong scopes (e.g. Gmail-only token on Drive).
 * Google connectors fall back to `google.oauth` until each service is authed (per-service key).
 */
export async function migrateToPerServiceOAuthKeys(vault: NimbusVault): Promise<void> {
  const msShared = await vault.get("microsoft.oauth");
  if (msShared !== null && msShared !== "") {
    for (const key of Object.values(MICROSOFT_SERVICE_VAULT_KEYS)) {
      const existing = await vault.get(key);
      if (existing === null || existing === "") {
        await vault.set(key, msShared);
      }
    }
  }
}

// ─── Provider-level cleanup ───────────────────────────────────────────────────

/**
 * After index rows for `removedServiceId` are deleted, drop shared OAuth vault keys
 * (and their per-service counterparts) when no indexed items remain for that
 * identity provider.
 */
export async function clearOAuthVaultIfProviderUnused(
  vault: NimbusVault,
  db: Database,
  removedServiceId: string,
): Promise<string[]> {
  const cleared: string[] = [];
  if (GOOGLE_CONNECTOR_SERVICES.has(removedServiceId)) {
    if (countItemsForAnyService(db, GOOGLE_SERVICES) === 0) {
      await vault.delete("google.oauth");
      cleared.push("google.oauth");
      for (const key of Object.values(GOOGLE_SERVICE_VAULT_KEYS)) {
        await vault.delete(key);
        cleared.push(key);
      }
    }
  }
  if (MICROSOFT_CONNECTOR_SERVICES.has(removedServiceId)) {
    if (countItemsForAnyService(db, MICROSOFT_SERVICES) === 0) {
      await vault.delete("microsoft.oauth");
      cleared.push("microsoft.oauth");
      for (const key of Object.values(MICROSOFT_SERVICE_VAULT_KEYS)) {
        await vault.delete(key);
        cleared.push(key);
      }
    }
  }
  return cleared;
}

// ─── Bucket-B helper: typed connector-secret reader ──────────────────────────

/**
 * Bare-key view derived from `CONNECTOR_VAULT_SECRET_KEYS`. For service `S`,
 * extracts the suffix after the dot in each fully-qualified manifest entry.
 *
 * Services with an empty manifest array (e.g. `google_drive`) resolve to `never`,
 * making `readConnectorSecret(vault, "google_drive", ...)` uncallable — those
 * services use OAuth via auth/google-access-token.ts, not this helper.
 *
 * The `[T] extends [never]` non-distributive guard short-circuits the empty-tuple
 * case before the template-literal `infer K` runs — without it, `never extends ...`
 * distribution would let `infer K` bind to its default constraint (`string`).
 */
export type ConnectorSecretKeyOf<S extends ConnectorServiceId> = [
  (typeof CONNECTOR_VAULT_SECRET_KEYS)[S][number],
] extends [never]
  ? never
  : (typeof CONNECTOR_VAULT_SECRET_KEYS)[S][number] extends `${S}.${infer K}`
    ? K
    : never;

/**
 * Reads a connector's secret from the Vault by structural key name. Returns
 * the raw stored value (no trim, no default) — semantics match `vault.get`.
 * Misspelled or non-manifested key names fail at compile time.
 */
export async function readConnectorSecret<S extends ConnectorServiceId>(
  vault: NimbusVault,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
): Promise<string | null> {
  const fullKey = `${serviceId}.${keyName}`;
  return vault.get(fullKey);
}

/**
 * Writes a connector's secret to the Vault by structural key name. Mirrors
 * `readConnectorSecret`'s typing — `keyName` is constrained to
 * `ConnectorSecretKeyOf<S>`, so misspelled or non-manifested keys fail at
 * compile time. Returns `void` (mirrors `vault.set`).
 */
export async function writeConnectorSecret<S extends ConnectorServiceId>(
  vault: NimbusVault,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
  value: string,
): Promise<void> {
  const fullKey = `${serviceId}.${keyName}`;
  return vault.set(fullKey, value);
}

/**
 * Deletes a connector's secret from the Vault by structural key name.
 * Mirrors `readConnectorSecret`/`writeConnectorSecret` typing — `keyName` is
 * constrained to `ConnectorSecretKeyOf<S>`, so misspelled or non-manifested
 * keys fail at compile time. Returns `void` (mirrors `vault.delete`).
 */
export async function deleteConnectorSecret<S extends ConnectorServiceId>(
  vault: NimbusVault,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
): Promise<void> {
  const fullKey = `${serviceId}.${keyName}`;
  return vault.delete(fullKey);
}

// ─── Bucket-C helper: provider-shared OAuth key constructor ──────────────────

export type SharedOAuthProvider = "google" | "microsoft";

/**
 * Returns the provider-shared OAuth vault key (`google.oauth` or `microsoft.oauth`).
 * Used when the caller is operating on the provider-wide token rather than a
 * per-service token. The literal lives inside this allow-listed file, so D11
 * does not fire at the call site.
 *
 * Return type is the literal union `"google.oauth" | "microsoft.oauth"` (resolved
 * by TS template-literal inference) — implicitly assignable to `string` at the
 * `vault.get`/`vault.set` boundary, so no widening cast is required at any caller.
 */
export function sharedOAuthKey(provider: SharedOAuthProvider): `${SharedOAuthProvider}.oauth` {
  return `${provider}.oauth`;
}
