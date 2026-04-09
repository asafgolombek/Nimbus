import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import pino from "pino";

import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { SyncContext } from "../sync/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export function createMemoryVault(): NimbusVault {
  const m = new Map<string, string>();
  return {
    async set(key: string, value: string): Promise<void> {
      m.set(key, value);
    },
    async get(key: string): Promise<string | null> {
      return m.get(key) ?? null;
    },
    async delete(key: string): Promise<void> {
      m.delete(key);
    },
    async listKeys(prefix?: string): Promise<string[]> {
      const keys = [...m.keys()].sort((a, b) => a.localeCompare(b));
      if (prefix === undefined || prefix === "") {
        return keys;
      }
      return keys.filter((k) => k.startsWith(prefix));
    },
  };
}

export function openMemoryIndexDatabase(): Database {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return db;
}

export function createSyncTestContext(db: Database, vault: NimbusVault): SyncContext {
  return {
    db,
    vault,
    logger: pino({ level: "silent" }),
    rateLimiter: new ProviderRateLimiter(),
  };
}

export function requestUrlString(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

/** Registers `afterEach` to restore `globalThis.fetch` (connector sync tests mock fetch). */
export function registerGlobalFetchRestore(afterEachImpl: (callback: () => void) => void): void {
  const originalFetch = globalThis.fetch;
  afterEachImpl(() => {
    globalThis.fetch = originalFetch;
  });
}

function testOAuthVaultJson(): string {
  return JSON.stringify({
    accessToken: "t",
    refreshToken: "r",
    expiresAt: Date.now() + 3_600_000,
  });
}

/** Vault + in-memory index + {@link SyncContext} for connector unit tests. */
export async function createOAuthConnectorTestSetup(
  provider: "google" | "microsoft",
): Promise<{ db: Database; vault: NimbusVault; ctx: SyncContext }> {
  const vault = createMemoryVault();
  await vault.set(provider === "google" ? "google.oauth" : "microsoft.oauth", testOAuthVaultJson());
  const db = openMemoryIndexDatabase();
  return { db, vault, ctx: createSyncTestContext(db, vault) };
}

export function expectPrefixedCursorCodecRoundTrip<T>(
  samples: readonly T[],
  encode: (c: T) => string,
  decode: (raw: string) => T | undefined,
  prefix: string,
): void {
  for (const s of samples) {
    const enc = encode(s);
    expect(enc.startsWith(prefix)).toBe(true);
    expect(decode(enc)).toEqual(s);
  }
}

/** Completes the browser step of Google PKCE tests by POSTing to the redirect_uri callback. */
export function googlePkceOpenUrlCompleter(
  code: string,
  options?: {
    expectAccountsHost?: boolean;
    missingParamsMessage?: string;
    assertFetchOk?: boolean;
  },
): (url: string) => Promise<void> {
  const msg = options?.missingParamsMessage ?? "expected redirect_uri and state in auth URL";
  const assertOk = options?.assertFetchOk ?? true;
  return async (url: string) => {
    const u = new URL(url);
    if (options?.expectAccountsHost === true) {
      expect(u.hostname).toBe("accounts.google.com");
    }
    const ru = u.searchParams.get("redirect_uri");
    const st = u.searchParams.get("state");
    if (ru === null || ru === "" || st === null || st === "") {
      throw new Error(msg);
    }
    const cb = new URL(ru);
    cb.searchParams.set("code", code);
    cb.searchParams.set("state", st);
    const res = await fetch(cb.toString());
    if (assertOk) {
      expect(res.ok).toBe(true);
    }
  };
}
