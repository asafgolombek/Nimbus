import { describe, expect, test } from "bun:test";
import type { VaultReader, VaultWriter } from "../vault/nimbus-vault.ts";
import {
  readToolCredential,
  toolCredentialKey,
  writeToolCredential,
} from "./toolgen-credentials.ts";

function memoryVault(): VaultReader & VaultWriter {
  const store = new Map<string, string>();
  return {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
  };
}

describe("toolCredentialKey", () => {
  test("is namespaced per tool AND per host", () => {
    expect(toolCredentialKey("tg_a", "api.example.com")).toBe("toolgen.tg_a.api_pexample_pcom");
    expect(toolCredentialKey("tg_a", "other.example.com")).not.toBe(
      toolCredentialKey("tg_a", "api.example.com"),
    );
    expect(toolCredentialKey("tg_b", "api.example.com")).not.toBe(
      toolCredentialKey("tg_a", "api.example.com"),
    );
  });

  test("hosts differing only by a separator do not collide", () => {
    expect(toolCredentialKey("tg_a", "a.b-c.com")).not.toBe(toolCredentialKey("tg_a", "a-b.c.com"));
  });

  test("hosts that differ only by a dotted single-letter label vs a dash do NOT collide", () => {
    expect(toolCredentialKey("tg_a", "api.d.example.com")).not.toBe(
      toolCredentialKey("tg_a", "api-example.com"),
    );
    expect(toolCredentialKey("tg_a", "a.d.b.com")).not.toBe(toolCredentialKey("tg_a", "a-b.com"));
  });

  test("a host containing the escape character is still distinct", () => {
    expect(toolCredentialKey("tg_a", "a_b.com")).not.toBe(toolCredentialKey("tg_a", "a.b.com"));
  });
});

describe("round-trip", () => {
  test("a bearer binding survives", async () => {
    const v = memoryVault();
    await writeToolCredential(v, "tg_a", "api.example.com", { type: "bearer", token: "s3cret" });
    expect(await readToolCredential(v, "tg_a", "api.example.com")).toEqual({
      type: "bearer",
      token: "s3cret",
    });
  });

  test("a missing binding reads as null, not a throw", async () => {
    expect(await readToolCredential(memoryVault(), "tg_a", "nope.example.com")).toBeNull();
  });

  test("a malformed stored value reads as null — external data is guarded, never asserted", async () => {
    const v = memoryVault();
    await v.set(toolCredentialKey("tg_a", "api.example.com"), '{"type":"wat"}');
    expect(await readToolCredential(v, "tg_a", "api.example.com")).toBeNull();
  });

  test("credentials are NOT shared across tools", async () => {
    const v = memoryVault();
    await writeToolCredential(v, "tg_a", "api.example.com", { type: "bearer", token: "s3cret" });
    expect(await readToolCredential(v, "tg_b", "api.example.com")).toBeNull();
  });

  test("a credential written for host A is not readable for host B", async () => {
    const v = memoryVault();
    await writeToolCredential(v, "tg_a", "a.example.com", { type: "bearer", token: "A-ONLY" });
    expect(await readToolCredential(v, "tg_a", "b.example.com")).toBeNull();
  });

  test("a same-type binding missing a required field reads as null, never partially applied", async () => {
    const v = memoryVault();
    await v.set(toolCredentialKey("tg_a", "api.example.com"), '{"type":"bearer"}');
    expect(await readToolCredential(v, "tg_a", "api.example.com")).toBeNull();

    const v2 = memoryVault();
    await v2.set(
      toolCredentialKey("tg_a", "api.example.com"),
      '{"type":"header","headerName":"X"}',
    );
    expect(await readToolCredential(v2, "tg_a", "api.example.com")).toBeNull();
  });
});
