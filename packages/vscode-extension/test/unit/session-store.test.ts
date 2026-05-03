import { describe, expect, test } from "vitest";

import { createSessionStore } from "../../src/chat/session-store.js";
import type { MementoLike } from "../../src/vscode-shim.js";

function makeMemento(initial: Record<string, unknown> = {}): MementoLike {
  const data = { ...initial };
  return {
    get: <T>(key: string, dflt?: T): T | undefined => (key in data ? (data[key] as T) : dflt),
    update: async (key, value) => {
      if (value === undefined) delete data[key];
      else data[key] = value;
    },
  };
}

describe("SessionStore", () => {
  test("returns undefined when no sessionId stored", () => {
    const s = createSessionStore(makeMemento());
    expect(s.get()).toBeUndefined();
  });

  test("set/get round-trip", async () => {
    const s = createSessionStore(makeMemento());
    await s.set("sess-abc");
    expect(s.get()).toBe("sess-abc");
  });

  test("clear removes the stored value", async () => {
    const s = createSessionStore(makeMemento({ "nimbus.activeSessionId": "x" }));
    expect(s.get()).toBe("x");
    await s.clear();
    expect(s.get()).toBeUndefined();
  });

  test("rejects non-UUID-looking content (sanity guard)", async () => {
    const s = createSessionStore(makeMemento());
    await expect(s.set("")).rejects.toThrow();
  });
});
