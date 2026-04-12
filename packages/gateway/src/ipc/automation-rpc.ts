import type { Database } from "bun:sqlite";

import { deleteWatcher, insertWatcher, listWatchers } from "../automation/watcher-store.ts";
import {
  deleteWorkflowByName,
  listWorkflows,
  upsertWorkflowByName,
} from "../automation/workflow-store.ts";
import { asRecord } from "./connector-rpc-shared.ts";

export class AutomationRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "AutomationRpcError";
  }
}

type Hit = { kind: "hit"; value: unknown };

function requireString(rec: Record<string, unknown> | undefined, key: string): string {
  if (rec === undefined) {
    throw new AutomationRpcError(-32602, `Missing or invalid ${key}`);
  }
  const v = rec[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new AutomationRpcError(-32602, `Missing or invalid ${key}`);
  }
  return v.trim();
}

export function dispatchAutomationRpc(options: {
  method: string;
  params: unknown;
  db: Database;
}): Hit | { kind: "miss" } {
  const { method, db } = options;
  const rec = asRecord(options.params);

  switch (method) {
    case "watcher.list":
      return { kind: "hit", value: { watchers: listWatchers(db) } };

    case "watcher.create": {
      const name = requireString(rec, "name");
      const conditionType = requireString(rec, "conditionType");
      const conditionJson = requireString(rec, "conditionJson");
      const actionType = requireString(rec, "actionType");
      const actionJson = requireString(rec, "actionJson");
      const id = insertWatcher(db, {
        name,
        enabled: 1,
        condition_type: conditionType,
        condition_json: conditionJson,
        action_type: actionType,
        action_json: actionJson,
        created_at: Date.now(),
      });
      return { kind: "hit", value: { id } };
    }

    case "watcher.delete": {
      const id = requireString(rec, "id");
      deleteWatcher(db, id);
      return { kind: "hit", value: { ok: true } };
    }

    case "workflow.list":
      return { kind: "hit", value: { workflows: listWorkflows(db) } };

    case "workflow.save": {
      const name = requireString(rec, "name");
      const stepsJson = requireString(rec, "stepsJson");
      const description =
        rec !== undefined && typeof rec["description"] === "string" ? rec["description"] : null;
      const id = upsertWorkflowByName(db, name, description, stepsJson, Date.now());
      return { kind: "hit", value: { id } };
    }

    case "workflow.delete": {
      const name = requireString(rec, "name");
      const ok = deleteWorkflowByName(db, name);
      return { kind: "hit", value: { ok } };
    }

    default:
      return { kind: "miss" };
  }
}
