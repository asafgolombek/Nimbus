import { describe, expect, test } from "bun:test";
import type { ToolExecutor } from "../engine/executor.ts";
import type { PlannedAction } from "../engine/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { dispatchVaultGated } from "./server.ts";

type GateOutcome = "proceed" | { status: "rejected"; reason: string };

function makeFakeExecutor(opts?: {
  outcome?: GateOutcome;
  onGate?: (action: PlannedAction) => void;
}): ToolExecutor {
  const outcome: GateOutcome = opts?.outcome ?? "proceed";
  return {
    gate: async (action: PlannedAction) => {
      opts?.onGate?.(action);
      return outcome;
    },
  } as unknown as ToolExecutor;
}

type VaultCounters = {
  setCalls: number;
  getCalls: number;
  deleteCalls: number;
  listKeysCalls: number;
};

function makeFakeVault(): { vault: NimbusVault; counters: VaultCounters } {
  const state: Record<string, string> = {};
  const counters: VaultCounters = {
    setCalls: 0,
    getCalls: 0,
    deleteCalls: 0,
    listKeysCalls: 0,
  };
  const vault: NimbusVault = {
    async set(k: string, v: string): Promise<void> {
      counters.setCalls++;
      state[k] = v;
    },
    async get(k: string): Promise<string | null> {
      counters.getCalls++;
      return state[k] ?? null;
    },
    async delete(k: string): Promise<void> {
      counters.deleteCalls++;
      delete state[k];
    },
    async listKeys(): Promise<string[]> {
      counters.listKeysCalls++;
      return Object.keys(state).sort((a, b) => a.localeCompare(b));
    },
  };
  return { vault, counters };
}

describe("dispatchVaultGated (S2-F8)", () => {
  test("vault.set requires consent before persistence", async () => {
    let gateCalls = 0;
    const { vault, counters } = makeFakeVault();
    const exec = makeFakeExecutor({ onGate: () => gateCalls++ });
    await dispatchVaultGated(vault, exec, "vault.set", {
      key: "github.pat",
      value: "ghp_test",
    });
    expect(gateCalls).toBe(1);
    expect(counters.setCalls).toBe(1);
  });

  test("vault.set runs gate BEFORE the underlying set call", async () => {
    const order: string[] = [];
    const exec = makeFakeExecutor({ onGate: () => order.push("gate") });
    const vault: NimbusVault = {
      set: async () => {
        order.push("set");
      },
      get: async () => null,
      delete: async () => {},
      listKeys: async () => [],
    };
    await dispatchVaultGated(vault, exec, "vault.set", {
      key: "github.pat",
      value: "ghp_test",
    });
    expect(order).toEqual(["gate", "set"]);
  });

  test("vault.set redacts the value from the gate payload", async () => {
    let captured: PlannedAction | undefined;
    const exec = makeFakeExecutor({ onGate: (a) => (captured = a) });
    const { vault } = makeFakeVault();
    await dispatchVaultGated(vault, exec, "vault.set", {
      key: "github.pat",
      value: "ghp_super_secret",
    });
    expect(captured?.type).toBe("vault.set");
    const payload = captured?.payload;
    expect(payload?.["key"]).toBe("github.pat");
    expect(payload?.["value"]).toBeUndefined();
  });

  test("vault.delete requires consent before deletion", async () => {
    let gateCalls = 0;
    const { vault, counters } = makeFakeVault();
    await vault.set("github.pat", "ghp_existing");
    const exec = makeFakeExecutor({ onGate: () => gateCalls++ });
    await dispatchVaultGated(vault, exec, "vault.delete", { key: "github.pat" });
    expect(gateCalls).toBe(1);
    expect(counters.deleteCalls).toBe(1);
  });

  test("vault.get does NOT call the gate (read-only)", async () => {
    let gateCalls = 0;
    const { vault } = makeFakeVault();
    await vault.set("github.pat", "x");
    const exec = makeFakeExecutor({ onGate: () => gateCalls++ });
    await dispatchVaultGated(vault, exec, "vault.get", { key: "github.pat" });
    expect(gateCalls).toBe(0);
  });

  test("vault.listKeys does NOT call the gate (read-only)", async () => {
    let gateCalls = 0;
    const { vault } = makeFakeVault();
    const exec = makeFakeExecutor({ onGate: () => gateCalls++ });
    await dispatchVaultGated(vault, exec, "vault.listKeys", {});
    expect(gateCalls).toBe(0);
  });

  test("internal callers (no toolExecutor) bypass the gate by design", async () => {
    const { vault, counters } = makeFakeVault();
    await dispatchVaultGated(vault, undefined, "vault.set", {
      key: "github.pat",
      value: "ghp_internal",
    });
    expect(counters.setCalls).toBe(1);
  });

  test("rejected consent throws and skips the underlying set", async () => {
    const { vault, counters } = makeFakeVault();
    const exec = makeFakeExecutor({
      outcome: { status: "rejected", reason: "User declined consent gate." },
    });
    await expect(
      dispatchVaultGated(vault, exec, "vault.set", { key: "github.pat", value: "x" }),
    ).rejects.toThrow(/declined/i);
    expect(counters.setCalls).toBe(0);
  });
});
