import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { LocalIndex } from "../index/local-index.ts";
import { SessionMemoryStore } from "./session-memory-store.ts";

describe("SessionMemoryStore", () => {
  test("append and recall scoped to session_id", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);

    const fixed = new Float32Array(384).fill(0.03);
    const store = new SessionMemoryStore({
      db,
      dims: 384,
      embedText: async (t: string) => {
        if (t.includes("payment")) {
          const v = new Float32Array(384).fill(0.9);
          return v;
        }
        return new Float32Array(fixed);
      },
    });

    const sid = "sess-a";
    await store.append({
      sessionId: sid,
      text: "We discussed payment-service rollout",
      role: "user",
      createdAt: Date.now(),
    });
    await store.append({
      sessionId: "sess-b",
      text: "Unrelated topic about cats",
      role: "user",
      createdAt: Date.now(),
    });

    const hits = await store.recall(sid, "payment rollout", 4);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.chunkText).toContain("payment-service");

    store.deleteSession(sid);
    const after = await store.recall(sid, "payment", 4);
    expect(after.length).toBe(0);
  });
});
