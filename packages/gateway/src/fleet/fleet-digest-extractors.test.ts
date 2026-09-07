import { describe, expect, test } from "bun:test";
import { summarizeBrief } from "./fleet-digest-extractors.ts";

const base = { agentVersion: 1, generatedAt: 0, latencyMs: 0, gaps: [] };

describe("ghost extractor keys on IDENTITY only", () => {
  test("a rank change does NOT change the key", () => {
    const mk = (rank: string) =>
      JSON.stringify({
        ...base,
        kind: "ghost",
        query: { file: "a.ts" },
        startEntityId: null,
        findings: [{ peerId: "p1", expert: null, rank, context: [], suggestedContact: "" }],
      });
    const before = summarizeBrief("agents.ghost", mk("medium"));
    const after = summarizeBrief("agents.ghost", mk("high"));
    expect(before?.keys).toEqual(["p1"]);
    expect(after?.keys).toEqual(["p1"]);
    expect(before?.metrics["rank_medium"]).toBe(1);
    expect(after?.metrics["rank_high"]).toBe(1);
  });
});

describe("janitor encodes booleans as KEYS, not metrics", () => {
  test("idle true adds the key; idle false omits it", () => {
    const mk = (idle: boolean) =>
      JSON.stringify({
        ...base,
        kind: "janitor",
        query: { resourceRef: "r", idleDays: 30 },
        idle,
        proposalSuppressed: false,
        cleanupAction: null,
        peersClear: 2,
        peersTouched: [{ peerId: "p1", who: null, lastSeenDaysAgo: 3 }],
      });
    expect(summarizeBrief("agents.janitor", mk(true))?.keys).toEqual(["idle", "peer:p1"]);
    expect(summarizeBrief("agents.janitor", mk(false))?.keys).toEqual(["peer:p1"]);
    expect(summarizeBrief("agents.janitor", mk(true))?.metrics["idle"]).toBeUndefined();
  });

  test("proposalSuppressed is keyed too, never metric-encoded", () => {
    const mk = (proposalSuppressed: boolean) =>
      JSON.stringify({
        ...base,
        kind: "janitor",
        query: { resourceRef: "r", idleDays: 30 },
        idle: false,
        proposalSuppressed,
        cleanupAction: null,
        peersClear: 0,
        peersTouched: [],
      });
    expect(summarizeBrief("agents.janitor", mk(true))?.keys).toEqual(["proposal_suppressed"]);
    expect(summarizeBrief("agents.janitor", mk(false))?.keys).toEqual([]);
    expect(
      summarizeBrief("agents.janitor", mk(true))?.metrics["proposal_suppressed"],
    ).toBeUndefined();
  });
});

describe("catchup and expert", () => {
  test("catchup keys on service:item and counts involvement", () => {
    const json = JSON.stringify({
      ...base,
      kind: "catchup",
      query: { sinceMs: 0 },
      selfPersonId: null,
      involvement: {
        ownedServices: ["s1"],
        activeRepos: ["r1", "r2"],
        incidentServices: [],
        collaboratorPersonIds: ["p1"],
      },
      sections: [
        {
          serviceId: "github",
          totalItemsInWindow: 5,
          items: [
            { itemId: "i1", title: "t", modifiedAt: 0, relevanceScore: 1, relevanceReasons: [] },
          ],
        },
      ],
    });
    const s = summarizeBrief("agents.catchup", json);
    expect(s?.keys).toEqual(["github:i1"]);
    expect(s?.metrics).toMatchObject({
      items_total: 1,
      sections: 1,
      active_repos: 2,
      collaborators: 1,
    });
  });

  test("expert keys on personId and counts confidence bands", () => {
    const json = JSON.stringify({
      ...base,
      kind: "expert",
      query: { topicOrFile: "auth" },
      ranked: [
        { personId: "p2", displayName: "B", evidence: [], score: 1, confidence: "high" },
        { personId: "p1", displayName: "A", evidence: [{}, {}], score: 2, confidence: "low" },
      ],
    });
    const s = summarizeBrief("agents.expert", json);
    expect(s?.keys).toEqual(["p1", "p2"]); // sorted by codeUnitCompare
    expect(s?.metrics).toMatchObject({
      experts: 2,
      evidence_total: 2,
      confidence_high: 1,
      confidence_low: 1,
    });
  });
});

describe("malformed input never throws", () => {
  test.each([
    ["not json at all", "{{{"],
    ["json of the wrong shape", JSON.stringify({ kind: "ghost" })],
    ["a bare primitive", JSON.stringify(7)],
    ["null", JSON.stringify(null)],
  ])("%s yields undefined", (_label, json) => {
    expect(summarizeBrief("agents.ghost", json)).toBeUndefined();
  });

  test("an unknown agent method yields undefined without parsing", () => {
    expect(summarizeBrief("agents.nope", "{}")).toBeUndefined();
    expect(summarizeBrief("constructor", "{}")).toBeUndefined();
  });

  test("a guard-passing brief with a malformed nested item yields undefined, not a throw", () => {
    // The SDK guards check that `findings` is an ARRAY, not the shape of its items, so this
    // legacy-shaped row passes isGhostBrief and then blows up inside the extractor.
    const json = JSON.stringify({
      ...base,
      kind: "ghost",
      query: { file: "a.ts" },
      startEntityId: null,
      findings: [{ peerId: "p1", rank: "high" }], // no `context`
    });
    expect(() => summarizeBrief("agents.ghost", json)).not.toThrow();
    expect(summarizeBrief("agents.ghost", json)).toBeUndefined();
  });
});
