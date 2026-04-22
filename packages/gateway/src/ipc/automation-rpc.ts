import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import {
  deleteExtensionById,
  listExtensions,
  setExtensionEnabled,
} from "../automation/extension-store.ts";
import {
  countItemsMatchingGraphPredicate,
  listCandidateGraphRelations,
  parseGraphPredicate,
} from "../automation/graph-predicate.ts";
import { listWatcherHistory } from "../automation/watcher-history.ts";
import {
  deleteWatcher,
  insertWatcher,
  listWatchers,
  setWatcherEnabled,
} from "../automation/watcher-store.ts";
import { listWorkflowRuns } from "../automation/workflow-run-history.ts";
import {
  deleteWorkflowByName,
  listWorkflows,
  upsertWorkflowByName,
} from "../automation/workflow-store.ts";
import { installExtensionFromLocalDirectory } from "../extensions/install-from-local.ts";
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

function requireNumber(rec: Record<string, unknown> | undefined, key: string): number {
  if (rec === undefined) {
    throw new AutomationRpcError(-32602, `Missing or invalid ${key}`);
  }
  const v = rec[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new AutomationRpcError(-32602, `Missing or invalid ${key}`);
  }
  return v;
}

function handleValidateCondition(rec: Record<string, unknown> | undefined, db: Database): Hit {
  const graphPredicateJson = requireString(rec, "graphPredicateJson");
  const sinceMs = requireNumber(rec, "sinceMs");
  const parsed = parseGraphPredicate(graphPredicateJson);
  if (!parsed.ok) {
    throw new AutomationRpcError(-32602, parsed.error);
  }
  return {
    kind: "hit",
    value: {
      matchCount: countItemsMatchingGraphPredicate({ db, predicate: parsed.predicate, sinceMs }),
    },
  };
}

export function dispatchAutomationRpc(options: {
  method: string;
  params: unknown;
  db: Database;
  /** Required for `extension.install`. */
  extensionsDir?: string;
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
      const graphPredicateJson =
        rec !== undefined && typeof rec["graphPredicateJson"] === "string"
          ? rec["graphPredicateJson"]
          : null;
      const id = insertWatcher(db, {
        name,
        enabled: 1,
        condition_type: conditionType,
        condition_json: conditionJson,
        action_type: actionType,
        action_json: actionJson,
        created_at: Date.now(),
        graph_predicate_json: graphPredicateJson,
      });
      return { kind: "hit", value: { id } };
    }

    case "watcher.delete": {
      const id = requireString(rec, "id");
      deleteWatcher(db, id);
      return { kind: "hit", value: { ok: true } };
    }

    case "watcher.pause": {
      const id = requireString(rec, "id");
      const ok = setWatcherEnabled(db, id, false);
      return { kind: "hit", value: { ok } };
    }

    case "watcher.resume": {
      const id = requireString(rec, "id");
      const ok = setWatcherEnabled(db, id, true);
      return { kind: "hit", value: { ok } };
    }

    case "watcher.listCandidateRelations":
      return {
        kind: "hit",
        value: { relations: listCandidateGraphRelations() },
      };

    case "watcher.validateCondition":
      return handleValidateCondition(rec, db);

    case "watcher.listHistory": {
      const watcherId = requireString(rec, "watcherId");
      const limit = requireNumber(rec, "limit");
      return { kind: "hit", value: listWatcherHistory(db, { watcherId, limit }) };
    }

    case "extension.list":
      return { kind: "hit", value: { extensions: listExtensions(db) } };

    case "extension.install": {
      const sourcePath = requireString(rec, "sourcePath");
      const dir = options.extensionsDir;
      if (dir === undefined || dir.trim() === "") {
        throw new AutomationRpcError(
          -32603,
          "Gateway is not configured with an extensions directory",
        );
      }
      try {
        const installed = installExtensionFromLocalDirectory({
          db,
          extensionsDir: dir,
          sourcePath,
        });
        return {
          kind: "hit",
          value: {
            id: installed.id,
            version: installed.version,
            installPath: installed.installPath,
            manifestHash: installed.manifestHash,
            entryHash: installed.entryHash,
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new AutomationRpcError(-32602, msg);
      }
    }

    case "extension.enable": {
      const id = requireString(rec, "id");
      const ok = setExtensionEnabled(db, id, true);
      return { kind: "hit", value: { ok } };
    }

    case "extension.disable": {
      const id = requireString(rec, "id");
      const ok = setExtensionEnabled(db, id, false);
      return { kind: "hit", value: { ok } };
    }

    case "extension.remove": {
      const id = requireString(rec, "id");
      const installPath = deleteExtensionById(db, id);
      if (installPath === null) {
        throw new AutomationRpcError(-32602, "Extension not found");
      }
      try {
        rmSync(installPath, { recursive: true, force: true });
      } catch {
        /* row already removed; best-effort filesystem cleanup */
      }
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

    case "workflow.listRuns": {
      const workflowName = requireString(rec, "workflowName");
      const limit = requireNumber(rec, "limit");
      return { kind: "hit", value: listWorkflowRuns(db, { workflowName, limit }) };
    }

    default:
      return { kind: "miss" };
  }
}
