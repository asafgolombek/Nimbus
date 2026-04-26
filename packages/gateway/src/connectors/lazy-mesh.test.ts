import { describe, expect, test } from "bun:test";

import { LazyDrainTracker, mergeToolMapsOrThrow } from "./lazy-mesh.ts";

describe("mergeToolMapsOrThrow (S8-F4)", () => {
  test("throws on duplicate tool key across sources", () => {
    const fake = { execute: async (): Promise<Record<string, unknown>> => ({}) };
    const a = { github_repo_pr_merge: fake };
    const b = { github_repo_pr_merge: fake };
    expect(() =>
      mergeToolMapsOrThrow([
        { map: a, name: "github" },
        { map: b, name: "user-mcp" },
      ]),
    ).toThrow(/collision: github_repo_pr_merge/);
  });

  test("merges disjoint maps without error", () => {
    const fake = { execute: async (): Promise<Record<string, unknown>> => ({}) };
    const merged = mergeToolMapsOrThrow([
      { map: { github_repo_get: fake }, name: "github" },
      { map: { mcp_x_some_tool: fake }, name: "user-mcp" },
    ]);
    expect(Object.keys(merged).sort((a, b) => a.localeCompare(b))).toEqual([
      "github_repo_get",
      "mcp_x_some_tool",
    ]);
  });

  test("error message names both colliding sources", () => {
    const fake = { execute: async (): Promise<Record<string, unknown>> => ({}) };
    expect(() =>
      mergeToolMapsOrThrow([
        { map: { dup: fake }, name: "first" },
        { map: { dup: fake }, name: "second" },
      ]),
    ).toThrow(/first.*second/);
  });
});

describe("LazyDrainTracker (S8-F7)", () => {
  test("awaitDrain resolves only after all bumps drop", async () => {
    const t = new LazyDrainTracker();
    expect(t.count).toBe(0);
    await t.awaitDrain();

    t.bump();
    t.bump();
    expect(t.count).toBe(2);
    let resolved = false;
    const p = t.awaitDrain().then(() => {
      resolved = true;
    });
    t.drop();
    await Promise.resolve();
    expect(resolved).toBe(false);
    t.drop();
    await p;
    expect(resolved).toBe(true);
    expect(t.count).toBe(0);
  });

  test("awaitDrain after drain returns a fresh resolved promise", async () => {
    const t = new LazyDrainTracker();
    t.bump();
    t.drop();
    await t.awaitDrain();
    t.bump();
    let later = false;
    const p = t.awaitDrain().then(() => {
      later = true;
    });
    await Promise.resolve();
    expect(later).toBe(false);
    t.drop();
    await p;
    expect(later).toBe(true);
  });

  test("drop is a no-op when count is already zero", () => {
    const t = new LazyDrainTracker();
    t.drop();
    expect(t.count).toBe(0);
  });
});
