import type { SessionMemoryStore } from "../memory/session-memory-store.ts";
import { asRecord } from "./connector-rpc-shared.ts";

export class SessionRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "SessionRpcError";
  }
}

type Hit = { kind: "hit"; value: unknown };

function requireString(rec: Record<string, unknown> | undefined, key: string): string {
  if (rec === undefined) {
    throw new SessionRpcError(-32602, `Missing or invalid ${key}`);
  }
  const v = rec[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new SessionRpcError(-32602, `Missing or invalid ${key}`);
  }
  return v.trim();
}

export async function dispatchSessionRpc(options: {
  method: string;
  params: unknown;
  store: SessionMemoryStore;
}): Promise<Hit | { kind: "miss" }> {
  const { method, store } = options;
  const rec = asRecord(options.params);

  switch (method) {
    case "session.append": {
      const sessionId = requireString(rec, "sessionId");
      const chunkText = requireString(rec, "chunkText");
      const roleRaw = requireString(rec, "role");
      if (roleRaw !== "user" && roleRaw !== "assistant" && roleRaw !== "tool") {
        throw new SessionRpcError(-32602, "role must be user, assistant, or tool");
      }
      await store.append({
        sessionId,
        text: chunkText,
        role: roleRaw,
        createdAt: Date.now(),
      });
      return { kind: "hit", value: { ok: true } };
    }
    case "session.recall": {
      const sessionId = requireString(rec, "sessionId");
      const query = requireString(rec, "query");
      const topKRaw = rec?.["topK"];
      const topK =
        typeof topKRaw === "number" && Number.isFinite(topKRaw)
          ? Math.min(32, Math.max(1, Math.floor(topKRaw)))
          : 8;
      const chunks = await store.recall(sessionId, query, topK);
      return {
        kind: "hit",
        value: { chunks },
      };
    }
    case "session.list": {
      return { kind: "hit", value: { sessions: store.listSessions() } };
    }
    case "session.clear": {
      const sid =
        rec !== undefined && typeof rec["sessionId"] === "string" ? rec["sessionId"].trim() : "";
      if (sid === "") {
        for (const s of store.listSessions()) {
          store.deleteSession(s.sessionId);
        }
        return { kind: "hit", value: { ok: true, cleared: "all" } };
      }
      store.deleteSession(sid);
      return { kind: "hit", value: { ok: true, cleared: sid } };
    }
    default:
      return { kind: "miss" };
  }
}
