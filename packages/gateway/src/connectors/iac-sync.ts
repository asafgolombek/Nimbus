import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import { encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";

const SERVICE_ID = "iac";
const CURSOR_PREFIX = "nimbus-iac1:";

type IacCursorV1 = { tick: number };

function encodeCursor(c: IacCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

export type IacSyncableOptions = {
  ensureIacMcpRunning: () => Promise<void>;
};

/**
 * Registers the connector for scheduler + MCP tools; state/drift indexing is a follow-up slice.
 */
export function createIacSyncable(options: IacSyncableOptions): Syncable {
  const initialSyncDepthDays = 1;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 120 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureIacMcpRunning();
      const en = await ctx.vault.get("iac.enabled");
      if (en !== "1") {
        return syncNoopResult(cursor, t0);
      }
      await ctx.rateLimiter.acquire("iac");
      return {
        cursor: encodeCursor({ tick: Date.now() }),
        itemsUpserted: 0,
        itemsDeleted: 0,
        hasMore: false,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred: 0,
      };
    },
  };
}
