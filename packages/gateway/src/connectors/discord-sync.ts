import { upsertIndexedItem } from "../index/item-store.ts";
import { resolvePersonForSync } from "../people/linker.ts";
import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord, stringField } from "./unknown-record.ts";

const SERVICE_ID = "discord";
const CURSOR_PREFIX = "nimbus-dsc1:";
const DISCORD_API = "https://discord.com/api/v10";
const MAX_API_CALLS_PER_SYNC = 8;

/** Text-like channels we index (GUILD_TEXT, GUILD_NEWS). */
const TEXT_CHANNEL_TYPES = new Set([0, 5]);

type DiscordSyncCursorV1 = {
  guildIds: string[];
  guildIndex: number;
  channelIds: string[];
  channelIndex: number;
  lastMsgByChannel: Record<string, string>;
};

function encodeCursor(c: DiscordSyncCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function decodeCursor(raw: string | null): DiscordSyncCursorV1 | null {
  if (raw === null || raw === "") {
    return null;
  }
  const parsed = decodeNimbusJsonCursorPayload(raw, CURSOR_PREFIX);
  if (
    parsed === undefined ||
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  const guildIds = rec["guildIds"];
  const guildIndex = rec["guildIndex"];
  const channelIds = rec["channelIds"];
  const channelIndex = rec["channelIndex"];
  const lastMsgByChannel = rec["lastMsgByChannel"];
  if (!Array.isArray(guildIds) || guildIds.some((g) => typeof g !== "string")) {
    return null;
  }
  if (typeof guildIndex !== "number" || !Number.isInteger(guildIndex) || guildIndex < 0) {
    return null;
  }
  if (!Array.isArray(channelIds) || channelIds.some((c) => typeof c !== "string")) {
    return null;
  }
  if (typeof channelIndex !== "number" || !Number.isInteger(channelIndex) || channelIndex < 0) {
    return null;
  }
  const lastMap: Record<string, string> = {};
  if (
    lastMsgByChannel !== null &&
    typeof lastMsgByChannel === "object" &&
    !Array.isArray(lastMsgByChannel)
  ) {
    for (const [k, v] of Object.entries(lastMsgByChannel as Record<string, unknown>)) {
      if (typeof v === "string" && v !== "") {
        lastMap[k] = v;
      }
    }
  }
  return {
    guildIds,
    guildIndex,
    channelIds,
    channelIndex,
    lastMsgByChannel: lastMap,
  };
}

async function discordFetch(
  token: string,
  path: string,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = path.startsWith("http") ? path : `${DISCORD_API}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": "NimbusGateway (https://github.com/nimbus-dev/nimbus)",
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Seconds to wait from a Discord 429 JSON body (avoids stringifying non-primitive `retry_after`). */
function discordRetryAfterSeconds(json: unknown): number {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return 1;
  }
  const raw = (json as Record<string, unknown>)["retry_after"];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 1;
  }
  return 1;
}

function displayNameFromDiscordAuthor(author: Record<string, unknown>): string {
  const gn = stringField(author, "global_name");
  const un = stringField(author, "username");
  if (gn !== undefined && gn !== "") {
    return gn;
  }
  if (un !== undefined && un !== "") {
    return un;
  }
  return "unknown";
}

export type DiscordSyncableOptions = {
  ensureDiscordMcpRunning: () => Promise<void>;
};

export function createDiscordSyncable(options: DiscordSyncableOptions): Syncable {
  const initialSyncDepthDays = 14;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 5 * 60 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureDiscordMcpRunning();
      const enabled = await ctx.vault.get("discord.enabled");
      const token = await ctx.vault.get("discord.bot_token");
      if (enabled !== "1" || token === null || token === "") {
        return syncNoopResult(cursor, t0);
      }

      let state = decodeCursor(cursor);
      if (state === null) {
        state = {
          guildIds: [],
          guildIndex: 0,
          channelIds: [],
          channelIndex: 0,
          lastMsgByChannel: {},
        };
      }

      let upserted = 0;
      let bytesTransferred = 0;
      let apiCalls = 0;
      const now = Date.now();

      const finish = (next: DiscordSyncCursorV1, hasMore: boolean): SyncResult => ({
        cursor: encodeCursor(next),
        itemsUpserted: upserted,
        itemsDeleted: 0,
        hasMore,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred,
      });

      while (apiCalls < MAX_API_CALLS_PER_SYNC) {
        if (state.guildIds.length === 0) {
          await ctx.rateLimiter.acquire("discord");
          apiCalls += 1;
          const res = await discordFetch(token, "/users/@me/guilds");
          bytesTransferred += res.text.length;
          if (res.status === 429) {
            const ra = discordRetryAfterSeconds(res.json);
            const ms = Number.isFinite(ra) && ra > 0 ? Math.ceil(ra * 1000) : 60_000;
            ctx.rateLimiter.penalise("discord", ms);
            throw new Error(`Discord guilds 429: ${res.text.slice(0, 200)}`);
          }
          if (!res.ok || !Array.isArray(res.json)) {
            throw new Error(`Discord guilds ${String(res.status)}: ${res.text.slice(0, 200)}`);
          }
          const ids: string[] = [];
          for (const g of res.json) {
            const gr = asRecord(g);
            const id = gr === undefined ? undefined : stringField(gr, "id");
            if (id !== undefined && id !== "") {
              ids.push(id);
            }
          }
          state = {
            guildIds: ids,
            guildIndex: 0,
            channelIds: [],
            channelIndex: 0,
            lastMsgByChannel: {},
          };
          if (ids.length === 0) {
            return finish(state, false);
          }
          continue;
        }

        if (state.guildIndex >= state.guildIds.length) {
          const cleared: DiscordSyncCursorV1 = {
            guildIds: [],
            guildIndex: 0,
            channelIds: [],
            channelIndex: 0,
            lastMsgByChannel: state.lastMsgByChannel,
          };
          return finish(cleared, false);
        }

        const guildId = state.guildIds[state.guildIndex] ?? "";
        if (guildId === "") {
          state = { ...state, guildIndex: state.guildIndex + 1, channelIds: [], channelIndex: 0 };
          continue;
        }

        if (state.channelIds.length === 0) {
          await ctx.rateLimiter.acquire("discord");
          apiCalls += 1;
          const res = await discordFetch(token, `/guilds/${encodeURIComponent(guildId)}/channels`);
          bytesTransferred += res.text.length;
          if (res.status === 429) {
            ctx.rateLimiter.penalise("discord", 60_000);
            throw new Error(`Discord channels 429: ${res.text.slice(0, 200)}`);
          }
          if (!res.ok || !Array.isArray(res.json)) {
            throw new Error(`Discord channels ${String(res.status)}: ${res.text.slice(0, 200)}`);
          }
          const chIds: string[] = [];
          for (const ch of res.json) {
            const cr = asRecord(ch);
            if (cr === undefined) {
              continue;
            }
            const id = stringField(cr, "id");
            const type = cr["type"];
            if (
              id !== undefined &&
              id !== "" &&
              typeof type === "number" &&
              TEXT_CHANNEL_TYPES.has(type)
            ) {
              chIds.push(id);
            }
          }
          state = { ...state, channelIds: chIds, channelIndex: 0 };
          if (chIds.length === 0) {
            state = {
              ...state,
              guildIndex: state.guildIndex + 1,
              channelIds: [],
              channelIndex: 0,
            };
          }
          continue;
        }

        if (state.channelIndex >= state.channelIds.length) {
          state = {
            ...state,
            guildIndex: state.guildIndex + 1,
            channelIds: [],
            channelIndex: 0,
          };
          continue;
        }

        const channelId: string = state.channelIds[state.channelIndex] ?? "";
        if (channelId === "") {
          state = { ...state, channelIndex: state.channelIndex + 1 };
          continue;
        }

        const after = state.lastMsgByChannel[channelId];
        let path = `/channels/${encodeURIComponent(channelId)}/messages?limit=50`;
        if (after !== undefined && after !== "") {
          path += `&after=${encodeURIComponent(after)}`;
        }

        await ctx.rateLimiter.acquire("discord");
        apiCalls += 1;
        const res = await discordFetch(token, path);
        bytesTransferred += res.text.length;
        if (res.status === 429) {
          ctx.rateLimiter.penalise("discord", 60_000);
          throw new Error(`Discord messages 429: ${res.text.slice(0, 200)}`);
        }
        if (!res.ok) {
          state = { ...state, channelIndex: state.channelIndex + 1 };
          continue;
        }
        if (!Array.isArray(res.json)) {
          state = { ...state, channelIndex: state.channelIndex + 1 };
          continue;
        }
        const messages = res.json as unknown[];
        if (messages.length === 0) {
          const nextLast: Record<string, string> = { ...state.lastMsgByChannel };
          delete nextLast[channelId];
          state = {
            ...state,
            lastMsgByChannel: nextLast,
            channelIndex: state.channelIndex + 1,
          };
          continue;
        }

        const newestId =
          typeof (messages[0] as { id?: string })?.id === "string"
            ? (messages[0] as { id: string }).id
            : "";
        const nextLastMap: Record<string, string> = {
          ...state.lastMsgByChannel,
          [channelId]: newestId,
        };

        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const mr = asRecord(messages[i]);
          if (mr === undefined) {
            continue;
          }
          const mid = stringField(mr, "id");
          const content = typeof mr["content"] === "string" ? mr["content"] : "";
          const author = asRecord(mr["author"]);
          if (mid === undefined || mid === "" || author === undefined) {
            continue;
          }
          const authorSnowflake = stringField(author, "id");
          const bodyPreview = content.length > 512 ? content.slice(0, 512) : content;
          const titleBase =
            bodyPreview.trim() === ""
              ? displayNameFromDiscordAuthor(author)
              : bodyPreview.replace(/\s+/g, " ").slice(0, 80);
          const title = titleBase.length > 512 ? titleBase.slice(0, 512) : titleBase;
          const url = `https://discord.com/channels/${guildId}/${channelId}/${mid}`;
          const authorId =
            authorSnowflake !== undefined && authorSnowflake !== ""
              ? resolvePersonForSync(ctx.db, {
                  discordUserId: authorSnowflake,
                  displayName: displayNameFromDiscordAuthor(author),
                })
              : null;
          upsertIndexedItem(ctx.db, {
            service: SERVICE_ID,
            type: "message",
            externalId: `${channelId}:${mid}`,
            title,
            bodyPreview,
            url,
            canonicalUrl: url,
            modifiedAt: now,
            authorId,
            metadata: {
              guildId,
              channelId,
              messageId: mid,
            },
            pinned: false,
            syncedAt: now,
          });
          upserted += 1;
        }

        state = {
          ...state,
          lastMsgByChannel: nextLastMap,
        };
      }

      const moreWork =
        state.guildIds.length > 0 &&
        (state.guildIndex < state.guildIds.length ||
          state.channelIndex < state.channelIds.length ||
          state.channelIds.length === 0);
      return finish(state, moreWork);
    },
  };
}
