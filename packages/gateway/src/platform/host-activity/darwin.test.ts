import { describe, expect, test } from "bun:test";
import type { DarwinSpawn } from "./darwin.ts";
import { run } from "./darwin.ts";

describe("darwin run() windows console hygiene", () => {
  // Rationale: `ownership/repo-remote.test.ts`'s "windows console hygiene" test. A presence
  // check (`"windowsHide" in opts`) would pass `windowsHide: false` — the actual defect shape
  // this test exists to catch — so it asserts the VALUE.
  test("pmset/ioreg are spawned with windowsHide: true", async () => {
    const seen: Record<string, unknown>[] = [];
    const capturingSpawn = ((_cmd: readonly string[], opts: Record<string, unknown>) => {
      seen.push(opts);
      return {
        kill: () => {},
        exited: Promise.resolve(0),
        stdout: new Response("ok").body,
      };
    }) as unknown as DarwinSpawn;

    await run(["pmset", "-g", "batt"], capturingSpawn);

    expect(seen.length).toBeGreaterThan(0);
    for (const opts of seen) {
      expect(opts["windowsHide"]).toBe(true);
    }
  });
});

describe("darwin run() timer hygiene", () => {
  test("clears its spawn timeout even when reading stdout throws", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let capturedTimerId: ReturnType<typeof setTimeout> | undefined;
    const clearedIds = new Set<ReturnType<typeof setTimeout>>();

    globalThis.setTimeout = ((
      handler: () => void,
      timeout?: number,
    ): ReturnType<typeof setTimeout> => {
      const id = originalSetTimeout(handler, timeout);
      capturedTimerId = id;
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id?: Parameters<typeof clearTimeout>[0]) => {
      if (id !== undefined) clearedIds.add(id as ReturnType<typeof setTimeout>);
      originalClearTimeout(id);
    }) as typeof clearTimeout;

    try {
      const throwingStdoutSpawn = ((_cmd: readonly string[], _opts: Record<string, unknown>) => ({
        kill: () => {},
        exited: Promise.resolve(0),
        get stdout(): never {
          throw new Error("boom");
        },
      })) as unknown as DarwinSpawn;

      const result = await run(["pmset", "-g", "batt"], throwingStdoutSpawn);

      expect(result).toBeUndefined();
      expect(capturedTimerId).toBeDefined();
      expect(capturedTimerId !== undefined && clearedIds.has(capturedTimerId)).toBe(true);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
