import type { LocalIndex } from "../index/local-index.ts";
import { mergePeople } from "../people/linker.ts";
import {
  countItemsByAuthor,
  getPersonById,
  listPersons,
  searchPersons,
} from "../people/person-store.ts";
import type { PersonRecord } from "../people/person-types.ts";
import { asRecord } from "./connector-rpc-shared.ts";

export class PeopleRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "PeopleRpcError";
  }
}

function requireString(rec: Record<string, unknown> | undefined, key: string): string {
  if (rec === undefined) {
    throw new PeopleRpcError(-32602, `Missing or invalid ${key}`);
  }
  const v = rec[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new PeopleRpcError(-32602, `Missing or invalid ${key}`);
  }
  return v.trim();
}

function optionalLimit(
  rec: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  if (rec === undefined) {
    return fallback;
  }
  const v = rec[key];
  if (v === undefined) {
    return fallback;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new PeopleRpcError(-32602, `Invalid ${key}`);
  }
  return Math.floor(v);
}

function personToJson(p: PersonRecord, itemCount: number): Record<string, unknown> {
  return {
    id: p.id,
    displayName: p.displayName,
    canonicalEmail: p.canonicalEmail,
    githubLogin: p.githubLogin,
    gitlabLogin: p.gitlabLogin,
    slackHandle: p.slackHandle,
    linearMemberId: p.linearMemberId,
    jiraAccountId: p.jiraAccountId,
    notionUserId: p.notionUserId,
    bitbucketUuid: p.bitbucketUuid,
    microsoftUserId: p.microsoftUserId,
    discordUserId: p.discordUserId,
    linked: p.linked,
    metadata: p.metadata ?? {},
    itemCount,
  };
}

export function dispatchPeopleRpc(options: {
  method: string;
  params: unknown;
  localIndex: LocalIndex;
}): { kind: "hit"; value: unknown } | { kind: "miss" } {
  const { method, params, localIndex } = options;
  const rec = asRecord(params);
  const db = localIndex.getDatabase();

  switch (method) {
    case "people.get": {
      const id = requireString(rec, "id");
      const p = getPersonById(db, id);
      if (p === null) {
        return { kind: "hit", value: null };
      }
      return { kind: "hit", value: personToJson(p, countItemsByAuthor(db, id)) };
    }
    case "people.list": {
      const limit = optionalLimit(rec, "limit", 100);
      const unlinkedOnly = rec?.["unlinkedOnly"] === true;
      const rows = listPersons(db, { unlinkedOnly, limit });
      return {
        kind: "hit",
        value: rows.map((p) => personToJson(p, countItemsByAuthor(db, p.id))),
      };
    }
    case "people.unlinked": {
      const limit = optionalLimit(rec, "limit", 100);
      const rows = listPersons(db, { unlinkedOnly: true, limit });
      return {
        kind: "hit",
        value: rows.map((p) => personToJson(p, countItemsByAuthor(db, p.id))),
      };
    }
    case "people.search": {
      const q = rec !== undefined && typeof rec["query"] === "string" ? rec["query"] : "";
      const limit = optionalLimit(rec, "limit", 25);
      const rows = searchPersons(db, q, limit);
      return {
        kind: "hit",
        value: rows.map((p) => personToJson(p, countItemsByAuthor(db, p.id))),
      };
    }
    case "people.items": {
      const personId = requireString(rec, "personId");
      const limit = optionalLimit(rec, "limit", 50);
      if (getPersonById(db, personId) === null) {
        throw new PeopleRpcError(-32602, "Unknown person id");
      }
      const items = localIndex.listItemsForAuthor(personId, limit);
      return { kind: "hit", value: items };
    }
    case "people.merge": {
      const a = requireString(rec, "personIdA");
      const b = requireString(rec, "personIdB");
      try {
        const survivor = mergePeople(db, a, b);
        const p = getPersonById(db, survivor);
        if (p === null) {
          throw new PeopleRpcError(-32603, "mergePeople: survivor missing");
        }
        return {
          kind: "hit",
          value: {
            survivorId: survivor,
            person: personToJson(p, countItemsByAuthor(db, survivor)),
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("conflicting canonical emails")) {
          throw new PeopleRpcError(-32602, msg);
        }
        if (msg.includes("unknown person id")) {
          throw new PeopleRpcError(-32602, msg);
        }
        throw new PeopleRpcError(-32603, msg);
      }
    }
    default:
      return { kind: "miss" };
  }
}
