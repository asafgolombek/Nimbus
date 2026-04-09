import type { Database } from "bun:sqlite";

import { countItemsForAnyService } from "../sync/scheduler-store.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { GOOGLE_CONNECTOR_SERVICES, MICROSOFT_CONNECTOR_SERVICES } from "./connector-catalog.ts";

const GOOGLE_SERVICES = [...GOOGLE_CONNECTOR_SERVICES];
const MICROSOFT_SERVICES = [...MICROSOFT_CONNECTOR_SERVICES];

/**
 * After index rows for `removedServiceId` are deleted, drop shared OAuth vault keys
 * when no indexed items remain for that identity provider.
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
    }
  }
  if (MICROSOFT_CONNECTOR_SERVICES.has(removedServiceId)) {
    if (countItemsForAnyService(db, MICROSOFT_SERVICES) === 0) {
      await vault.delete("microsoft.oauth");
      cleared.push("microsoft.oauth");
    }
  }
  return cleared;
}
