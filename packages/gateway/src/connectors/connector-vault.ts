import type { Database } from "bun:sqlite";

import { countItemsForAnyService } from "../sync/scheduler-store.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  type ConnectorServiceId,
  GOOGLE_CONNECTOR_SERVICES,
  MICROSOFT_CONNECTOR_SERVICES,
} from "./connector-catalog.ts";

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
 * One-time startup migration: copy `google.oauth` / `microsoft.oauth` to
 * per-service keys for any service whose per-service key is missing.
 * Safe to call repeatedly; only writes when the per-service key is absent.
 */
export async function migrateToPerServiceOAuthKeys(vault: NimbusVault): Promise<void> {
  const googleShared = await vault.get("google.oauth");
  if (googleShared !== null && googleShared !== "") {
    for (const key of Object.values(GOOGLE_SERVICE_VAULT_KEYS)) {
      const existing = await vault.get(key);
      if (existing === null || existing === "") {
        await vault.set(key, googleShared);
      }
    }
  }

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
