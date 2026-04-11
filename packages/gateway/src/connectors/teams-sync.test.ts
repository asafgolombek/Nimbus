import { afterEach, describe, expect, test } from "bun:test";
import { itemPrimaryKey } from "../index/item-store.ts";
import {
  createOAuthConnectorTestSetup,
  expectPrefixedCursorCodecRoundTrip,
  registerGlobalFetchRestore,
  requestUrlString,
} from "../testing/bun-test-support.ts";
import {
  createTeamsSyncable,
  decodeTeamsSyncCursor,
  encodeTeamsSyncCursor,
  type TeamsSyncCursorV1,
} from "./teams-sync.ts";

describe("Teams sync cursor codec", () => {
  test("round-trip", () => {
    const samples: TeamsSyncCursorV1[] = [
      {
        v: 1,
        phase: "teams",
        teams: [],
        teamsNext: null,
        channelTeamIdx: 0,
        channelsByTeam: {},
        chanNext: null,
        pairs: [],
        pairIdx: 0,
        deltaByKey: {},
      },
      {
        v: 1,
        phase: "messages",
        teams: [{ id: "t1" }],
        teamsNext: null,
        channelTeamIdx: 1,
        channelsByTeam: { t1: ["c1"] },
        chanNext: null,
        pairs: [{ teamId: "t1", channelId: "c1" }],
        pairIdx: 0,
        deltaByKey: { "t1|c1": "https://graph.microsoft.com/v1.0/delta?token=x" },
      },
    ];
    expectPrefixedCursorCodecRoundTrip(
      samples,
      encodeTeamsSyncCursor,
      (raw) => decodeTeamsSyncCursor(raw),
      "nimbus-tms1:",
    );
  });
});

describe("createTeamsSyncable", () => {
  registerGlobalFetchRestore(afterEach);

  test("indexes channel messages after teams and channels discovery", async () => {
    const { db, ctx } = await createOAuthConnectorTestSetup("microsoft");
    const syncable = createTeamsSyncable({ ensureMicrosoftMcpRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrlString(input);
      if (url.includes("/joinedTeams")) {
        return new Response(JSON.stringify({ value: [{ id: "team-1", displayName: "T" }] }), {
          status: 200,
        });
      }
      if (url.includes("/teams/team-1/channels") && !url.includes("/messages")) {
        return new Response(
          JSON.stringify({ value: [{ id: "chan-1", membershipType: "standard" }] }),
          { status: 200 },
        );
      }
      if (url.includes("/messages/delta")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "msg-1",
                createdDateTime: "2024-05-01T10:00:00Z",
                body: { contentType: "text", content: "Hello channel" },
                from: { user: { id: "ms-user-1", displayName: "Pat" } },
              },
            ],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/teams/x/channels/y/messages/delta?token=z",
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r1 = await syncable.sync(ctx, null);
    expect(r1.hasMore).toBe(true);
    expect(r1.itemsUpserted).toBe(0);

    const r2 = await syncable.sync(ctx, r1.cursor);
    expect(r2.hasMore).toBe(true);
    expect(r2.itemsUpserted).toBe(0);

    const r3 = await syncable.sync(ctx, r2.cursor);
    expect(r3.itemsUpserted).toBe(0);
    expect(r3.hasMore).toBe(true);

    const r4 = await syncable.sync(ctx, r3.cursor);
    expect(r4.itemsUpserted).toBe(1);
    expect(r4.hasMore).toBe(false);

    const row = db
      .query("SELECT service, type, author_id FROM item WHERE id = ?")
      .get(itemPrimaryKey("teams", "team-1:chan-1:msg-1")) as
      | { service: string; type: string; author_id: string | null }
      | undefined;
    expect(row?.service).toBe("teams");
    expect(row?.type).toBe("message");
    expect(row?.author_id).not.toBeNull();
  });
});
