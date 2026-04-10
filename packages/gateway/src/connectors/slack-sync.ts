import { getValidSlackAccessToken } from "../auth/slack-access-token.ts";
import { upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord } from "./unknown-record.ts";

const SERVICE_ID = "slack";
const CURSOR_PREFIX = "nimbus-slk1:";

type SlackSyncCursorV1 = {
  phase: "list" | "history";
  floorTs: string;
  ids: string[];
  nextIdx: number;
  hw: Record<string, string | null>;
  listCursor: string | null;
  histCursor: string | null;
  teamSubdomain: string | null;
};

function encodeCursor(c: SlackSyncCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function decodeCursor(raw: string | null): SlackSyncCursorV1 | null {
  if (raw === null || raw === "") {
    return null;
  }
  const parsed = decodeNimbusJsonCursorPayload(raw, CURSOR_PREFIX);
  if (parsed === undefined) {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  const phase = rec["phase"];
  const floorTs = rec["floorTs"];
  const ids = rec["ids"];
  const nextIdx = rec["nextIdx"];
  const hw = rec["hw"];
  if (phase !== "list" && phase !== "history") {
    return null;
  }
  if (typeof floorTs !== "string" || floorTs === "") {
    return null;
  }
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
    return null;
  }
  if (typeof nextIdx !== "number" || !Number.isInteger(nextIdx) || nextIdx < 0) {
    return null;
  }
  const hwOut: Record<string, string | null> = {};
  if (hw !== null && typeof hw === "object" && !Array.isArray(hw)) {
    for (const [k, v] of Object.entries(hw as Record<string, unknown>)) {
      hwOut[k] = typeof v === "string" ? v : null;
    }
  }
  const listCursor = rec["listCursor"];
  const histCursor = rec["histCursor"];
  const teamSubdomain = rec["teamSubdomain"];
  return {
    phase,
    floorTs,
    ids: ids as string[],
    nextIdx,
    hw: hwOut,
    listCursor: typeof listCursor === "string" ? listCursor : null,
    histCursor: typeof histCursor === "string" ? histCursor : null,
    teamSubdomain: typeof teamSubdomain === "string" ? teamSubdomain : null,
  };
}

function slackTsFromMs(ms: number): string {
  return (ms / 1000).toFixed(6);
}

async function slackWebApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; json: Record<string, unknown>; text: string }> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, json: {}, text };
  }
  const json =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const okField = json["ok"];
  return { ok: okField === true && res.ok, json, text };
}

function permalink(teamSub: string | null, channel: string, ts: string): string | null {
  const compact = ts.replace(".", "");
  if (teamSub !== null && teamSub !== "") {
    return `https://${teamSub}.slack.com/archives/${channel}/p${compact}`;
  }
  return null;
}

export type SlackSyncableOptions = {
  ensureSlackMcpRunning: () => Promise<void>;
};

export function createSlackSyncable(options: SlackSyncableOptions): Syncable {
  const syncable: Syncable = {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 5 * 60 * 1000,
    initialSyncDepthDays: 14,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureSlackMcpRunning();
      const rawVault = await ctx.vault.get("slack.oauth");
      if (rawVault === null || rawVault === "") {
        return {
          cursor,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
        };
      }

      let token: string;
      try {
        token = await getValidSlackAccessToken(ctx.vault);
      } catch {
        return {
          cursor,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
        };
      }

      const depthMs = Math.max(1, syncable.initialSyncDepthDays) * 86_400_000;
      const floorTs = slackTsFromMs(Date.now() - depthMs);

      let state =
        decodeCursor(cursor) ??
        ({
          phase: "list",
          floorTs,
          ids: [],
          nextIdx: 0,
          hw: {},
          listCursor: null,
          histCursor: null,
          teamSubdomain: null,
        } satisfies SlackSyncCursorV1);

      if (state.floorTs === "" || Number.isNaN(Number(state.floorTs))) {
        state = { ...state, floorTs };
      }

      await ctx.rateLimiter.acquire("slack");

      if (state.teamSubdomain === null) {
        const who = await slackWebApi(token, "auth.test", {});
        if (who.ok) {
          const urlRaw = who.json["url"];
          if (typeof urlRaw === "string" && urlRaw !== "") {
            try {
              const host = new URL(urlRaw).hostname;
              const sub = host.replace(/\.slack\.com$/i, "");
              state = { ...state, teamSubdomain: sub !== host ? sub : null };
            } catch {
              /* ignore */
            }
          }
        }
      }

      let itemsUpserted = 0;
      let bytesTransferred = 0;
      let hasMore = false;

      if (state.phase === "list") {
        const listBody: Record<string, unknown> = {
          types: "public_channel,private_channel,mpim,im",
          limit: 200,
          exclude_archived: true,
        };
        if (state.listCursor !== null && state.listCursor !== "") {
          listBody["cursor"] = state.listCursor;
        }
        const res = await slackWebApi(token, "conversations.list", listBody);
        bytesTransferred += res.text.length;
        if (!res.ok) {
          if (res.json["error"] === "ratelimited") {
            ctx.rateLimiter.penalise("slack", 60_000);
          }
          throw new Error(`Slack conversations.list: ${res.text.slice(0, 200)}`);
        }
        const chans = res.json["channels"];
        const nextIds = [...state.ids];
        if (Array.isArray(chans)) {
          for (const c of chans) {
            const cr = asRecord(c);
            if (cr === undefined) {
              continue;
            }
            const id = cr["id"];
            const member = cr["is_member"];
            if (typeof id === "string" && id !== "" && member === true) {
              nextIds.push(id);
            }
          }
        }
        const meta = asRecord(res.json["response_metadata"]);
        const nextList =
          meta !== undefined && typeof meta["next_cursor"] === "string" ? meta["next_cursor"] : "";
        if (nextList !== "") {
          const nextState: SlackSyncCursorV1 = {
            ...state,
            ids: nextIds,
            listCursor: nextList,
          };
          return {
            cursor: encodeCursor(nextState),
            itemsUpserted: 0,
            itemsDeleted: 0,
            hasMore: true,
            durationMs: Math.round(performance.now() - t0),
            bytesTransferred,
          };
        }
        const unique = [...new Set(nextIds)].sort((a, b) => a.localeCompare(b));
        const nextState: SlackSyncCursorV1 = {
          ...state,
          phase: "history",
          ids: unique,
          listCursor: null,
          nextIdx: 0,
          histCursor: null,
        };
        state = nextState;
        hasMore = unique.length > 0;
      }

      if (state.phase === "history" && state.ids.length === 0) {
        return {
          cursor: encodeCursor(state),
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
          bytesTransferred,
        };
      }

      if (state.phase === "history") {
        const ch = state.ids[state.nextIdx % state.ids.length] ?? "";
        if (ch === "") {
          return {
            cursor: encodeCursor(state),
            itemsUpserted,
            itemsDeleted: 0,
            hasMore: false,
            durationMs: Math.round(performance.now() - t0),
            bytesTransferred,
          };
        }

        const hwVal = state.hw[ch] ?? null;
        const histBody: Record<string, unknown> = {
          channel: ch,
          limit: 100,
        };
        if (state.histCursor !== null && state.histCursor !== "") {
          histBody["cursor"] = state.histCursor;
        } else if (hwVal !== null && hwVal !== "") {
          histBody["oldest"] = hwVal;
          histBody["inclusive"] = false;
        } else {
          histBody["oldest"] = state.floorTs;
          histBody["inclusive"] = true;
        }

        const hres = await slackWebApi(token, "conversations.history", histBody);
        bytesTransferred += hres.text.length;
        if (!hres.ok) {
          if (hres.json["error"] === "ratelimited") {
            ctx.rateLimiter.penalise("slack", 60_000);
          }
          throw new Error(`Slack conversations.history: ${hres.text.slice(0, 200)}`);
        }

        const messages = hres.json["messages"];
        const now = Date.now();
        let maxTs = hwVal;
        if (Array.isArray(messages)) {
          for (const m of messages) {
            const mr = asRecord(m);
            if (mr === undefined) {
              continue;
            }
            const ts = mr["ts"];
            const text = mr["text"];
            const user = mr["user"];
            const threadTs = mr["thread_ts"];
            if (typeof ts !== "string" || ts === "") {
              continue;
            }
            if (mr["subtype"] !== undefined && mr["subtype"] !== "thread_broadcast") {
              continue;
            }
            const preview = typeof text === "string" ? text.slice(0, 512) : "";
            const title =
              preview.trim() !== ""
                ? preview.length > 120
                  ? `${preview.slice(0, 117)}…`
                  : preview
                : "(no text)";
            const tsNum = Number.parseFloat(ts);
            const modifiedAt = Number.isFinite(tsNum) ? Math.round(tsNum * 1000) : now;
            const externalId = `${ch}:${ts}`;
            const url = permalink(state.teamSubdomain, ch, ts);
            upsertIndexedItem(ctx.db, {
              service: SERVICE_ID,
              type: "message",
              externalId,
              title: title.length > 512 ? title.slice(0, 512) : title,
              bodyPreview: preview,
              url,
              canonicalUrl: url,
              modifiedAt,
              authorId: null,
              metadata: {
                channel: ch,
                user: typeof user === "string" ? user : null,
                thread_ts: typeof threadTs === "string" ? threadTs : null,
              },
              pinned: false,
              syncedAt: now,
            });
            itemsUpserted += 1;
            maxTs = maxTs === null || ts.localeCompare(maxTs) > 0 ? ts : maxTs;
          }
        }

        const nextHw = { ...state.hw, [ch]: maxTs };
        const meta = asRecord(hres.json["response_metadata"]);
        const nextHist =
          meta !== undefined && typeof meta["next_cursor"] === "string" ? meta["next_cursor"] : "";

        if (nextHist !== "") {
          const nextState: SlackSyncCursorV1 = {
            ...state,
            hw: nextHw,
            histCursor: nextHist,
          };
          return {
            cursor: encodeCursor(nextState),
            itemsUpserted,
            itemsDeleted: 0,
            hasMore: true,
            durationMs: Math.round(performance.now() - t0),
            bytesTransferred,
          };
        }

        const nextState: SlackSyncCursorV1 = {
          ...state,
          hw: nextHw,
          histCursor: null,
          nextIdx: state.nextIdx + 1,
        };
        hasMore = nextState.nextIdx < nextState.ids.length;
        return {
          cursor: encodeCursor(nextState),
          itemsUpserted,
          itemsDeleted: 0,
          hasMore,
          durationMs: Math.round(performance.now() - t0),
          bytesTransferred,
        };
      }

      return {
        cursor: encodeCursor(state),
        itemsUpserted,
        itemsDeleted: 0,
        hasMore,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred,
      };
    },
  };
  return syncable;
}
