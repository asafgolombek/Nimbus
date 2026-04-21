import { describe, expect, it } from "vitest";
import { FORBIDDEN_PERSIST_KEYS, persistPartialize } from "../../src/store/partialize";

describe("persistPartialize", () => {
  it("output contains ONLY the whitelisted slice-root fields", () => {
    const full = {
      // Non-persisted slices (must be stripped):
      connectionState: "connected",
      aggregateHealth: "healthy",
      pendingHitl: 0,
      pending: [],
      tray: {},
      quickQuery: {},
      onboarding: {},
      dashboard: {},
      audit: [],
      // Whitelisted roots (must survive):
      connectorsList: [{ service: "github" }],
      installedModels: [{ id: "gemma:2b" }],
      activePullId: null,
      active: "work",
      profiles: [{ name: "work" }],
      // Slice-action functions must NOT be persisted:
      setConnectionState: () => {},
      setProfileList: () => {},
    } as unknown as Record<string, unknown>;
    const out = persistPartialize(full);
    expect(Object.keys(out).sort()).toEqual(
      ["active", "activePullId", "connectorsList", "installedModels", "profiles"].sort(),
    );
  });

  it("forbidden keys at the top level never survive partialize", () => {
    const poisoned = {
      connectorsList: [],
      installedModels: [],
      activePullId: null,
      active: null,
      profiles: [],
      passphrase: "very-secret",
      recoverySeed: "word-word-word",
      mnemonic: "m",
      privateKey: "pk",
      encryptedVaultManifest: "cipher",
    } as Record<string, unknown>;
    const out = persistPartialize(poisoned);
    for (const k of FORBIDDEN_PERSIST_KEYS) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it("forbidden keys nested INSIDE a whitelisted value are stripped recursively", () => {
    const poisoned = {
      connectorsList: [
        {
          service: "github",
          intervalMs: 300_000,
          passphrase: "nested-secret-1",
        },
      ],
      installedModels: [],
      activePullId: null,
      active: null,
      profiles: [
        {
          name: "work",
          meta: { debug: { mnemonic: "nested-secret-2" } },
        },
      ],
    } as unknown as Record<string, unknown>;
    const out = persistPartialize(poisoned);
    const flat = JSON.stringify(out);
    expect(flat).not.toContain("nested-secret-1");
    expect(flat).not.toContain("nested-secret-2");
    expect(flat).toContain("github");
    expect(flat).toContain("work");
  });

  it("recursion handles cycles without throwing", () => {
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { name: "b", back: a };
    a["forward"] = b;
    const poisoned = {
      connectorsList: [],
      installedModels: [],
      activePullId: null,
      active: null,
      profiles: [a],
    } as unknown as Record<string, unknown>;
    expect(() => persistPartialize(poisoned)).not.toThrow();
  });

  it("FORBIDDEN_PERSIST_KEYS lists the five spec-mandated keys", () => {
    expect([...FORBIDDEN_PERSIST_KEYS].sort()).toEqual(
      ["encryptedVaultManifest", "mnemonic", "passphrase", "privateKey", "recoverySeed"].sort(),
    );
  });
});
