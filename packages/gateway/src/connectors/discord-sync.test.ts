import { expect, test } from "bun:test";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  expectServiceItemCount,
  type SyncTestFetchParams,
  syncTestContext,
  testConnectorSyncNoop,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";
import { createDiscordSyncable } from "./discord-sync.ts";

describeWithFetchRestore("discord-sync", () => {
  testConnectorSyncNoop(
    "no-op when discord not enabled",
    () => createDiscordSyncable({ ensureDiscordMcpRunning: async () => {} }),
    createStubVault({ "discord.enabled": null, "discord.bot_token": null }),
  );

  testConnectorSyncNoop(
    "no-op when enabled flag missing",
    () => createDiscordSyncable({ ensureDiscordMcpRunning: async () => {} }),
    createStubVault({ "discord.bot_token": "x" }),
  );

  test("indexes channel message and sets author_id", async () => {
    const db = createMemoryIndexDb();
    let call = 0;
    globalThis.fetch = (async (
      input: SyncTestFetchParams[0],
      init?: SyncTestFetchParams[1],
    ): Promise<Response> => {
      const u = urlFromFetchInput(input);
      call += 1;
      const auth = new Headers(init?.headers ?? undefined).get("Authorization");
      expect(auth).toBe("Bot test-token");
      if (call === 1) {
        expect(u).toContain("/users/@me/guilds");
        return new Response(JSON.stringify([{ id: "g1" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (call === 2) {
        expect(u).toContain("/guilds/g1/channels");
        return new Response(JSON.stringify([{ id: "c1", type: 0, name: "general" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      expect(u).toContain("/channels/c1/messages");
      expect(u).toContain("limit=50");
      // Pagination uses `after=`; return [] on the second fetch so the sync loop advances (see discord-sync.ts).
      if (u.includes("after=")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify([
          {
            id: "m1",
            content: "hello discord",
            author: { id: "u9001", username: "pat", global_name: "Pat" },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const sync = createDiscordSyncable({ ensureDiscordMcpRunning: async () => {} });
    const r = await sync.sync(
      syncTestContext(
        db,
        createStubVault({ "discord.enabled": "1", "discord.bot_token": "test-token" }),
      ),
      null,
    );
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-dsc1:");
    expectServiceItemCount(db, "discord", 1);
    const row = db
      .query("SELECT author_id FROM item WHERE service = ? AND external_id = ?")
      .get("discord", "c1:m1") as { author_id: string | null } | undefined;
    expect(row?.author_id).not.toBeNull();
  });
});
