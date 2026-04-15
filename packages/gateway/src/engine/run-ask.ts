import type { Agent } from "@mastra/core/agent";

import type { LocalIndex } from "../index/local-index.ts";
import type { ConsentCoordinator } from "../ipc/consent.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import { bindConsentChannel, ToolExecutor } from "./executor.ts";
import { GatewayAgentUnavailableError } from "./gateway-agent-error.ts";
import { type PlanResult, planFromIntent } from "./planner.ts";
import { type ClassifiedIntent, classifyIntent } from "./router.ts";
import { runConversationalAgent } from "./run-conversational-agent.ts";
import type { ConnectorDispatcher, PlannedAction } from "./types.ts";

export type RunAskParams = {
  input: string;
  stream: boolean;
  clientId: string;
  paths: PlatformPaths;
  consentCoordinator: ConsentCoordinator;
  localIndex: LocalIndex;
  dispatcher: ConnectorDispatcher;
  sendChunk: (text: string) => void;
  /** Mastra agent with local index tools; when set, high-confidence `unknown` intent uses this path (Q2 §7.0). */
  conversationalAgent?: Agent;
};

const EMPTY_INDEX_GUIDANCE = `No data indexed yet.

To get started, connect a service and run an initial sync:
  nimbus connector auth github
  nimbus connector auth google
  nimbus connector auth slack
  nimbus connector list
  nimbus connector sync <service>

Then try your question again, or run nimbus doctor for a health summary.`;

/** Item count when the DB is reachable; `undefined` if we cannot query (e.g. test stubs without `getDatabase`). */
function countIndexedItems(localIndex: LocalIndex): number | undefined {
  if (typeof localIndex.getDatabase !== "function") {
    return undefined;
  }
  try {
    const row = localIndex.getDatabase().query(`SELECT COUNT(*) AS c FROM item`).get() as {
      c: number;
    } | null;
    const c = row?.c;
    return typeof c === "number" && Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 0;
  } catch {
    return undefined;
  }
}

function formatResultSummary(results: unknown[]): string {
  if (results.length === 0) {
    return "Done.";
  }
  const parts: string[] = [];
  for (const r of results) {
    try {
      parts.push(typeof r === "string" ? r : JSON.stringify(r, undefined, 2));
    } catch {
      parts.push(String(r));
    }
  }
  return parts.join("\n---\n");
}

function emptyIndexGuidanceIfNeeded(
  p: RunAskParams,
  indexed: number | undefined,
): { reply: string } | undefined {
  if (p.input.trim() === "" || indexed !== 0) {
    return undefined;
  }
  if (p.stream) {
    p.sendChunk(`${EMPTY_INDEX_GUIDANCE}\n`);
  }
  return { reply: EMPTY_INDEX_GUIDANCE };
}

async function classifyIntentForAsk(input: string): Promise<ClassifiedIntent> {
  try {
    return await classifyIntent(input);
  } catch (e) {
    if (e instanceof GatewayAgentUnavailableError) {
      throw e;
    }
    throw new GatewayAgentUnavailableError();
  }
}

async function runActionsPlan(
  p: RunAskParams,
  actions: PlannedAction[],
): Promise<{ reply: string }> {
  const consent = bindConsentChannel(p.consentCoordinator, p.clientId);
  const executor = new ToolExecutor(consent, p.localIndex, p.dispatcher);
  const summaries: string[] = [];
  const structured: unknown[] = [];

  for (const action of actions) {
    if (p.stream) {
      p.sendChunk(`Running: ${action.type}…\n`);
    }
    const out = await executor.execute(action);
    if (out.status === "rejected") {
      summaries.push(`Rejected: ${out.reason}`);
      structured.push(out);
      break;
    }
    structured.push(out.result);
    summaries.push(`OK: ${action.type}`);
  }

  const summaryText = formatResultSummary(structured);
  const reply = `${summaries.join("\n")}\n\n${summaryText}`;
  if (p.stream) {
    p.sendChunk(`\n${summaryText}\n`);
  }
  return { reply };
}

function handleReplyPlan(p: RunAskParams, text: string): { reply: string } {
  if (p.stream) {
    p.sendChunk(text);
  }
  return { reply: text };
}

async function dispatchPlan(p: RunAskParams, plan: PlanResult): Promise<{ reply: string }> {
  if (plan.kind === "reply") {
    return handleReplyPlan(p, plan.text);
  }
  return await runActionsPlan(p, plan.actions);
}

/**
 * NL ask pipeline: classify → plan → HITL-gated {@link ToolExecutor} steps.
 */
export async function runAsk(p: RunAskParams): Promise<{ reply: string }> {
  const indexed = countIndexedItems(p.localIndex);
  const empty = emptyIndexGuidanceIfNeeded(p, indexed);
  if (empty !== undefined) {
    return empty;
  }

  const classified = await classifyIntentForAsk(p.input);

  if (
    classified.intent === "unknown" &&
    classified.confidence >= 0.6 &&
    p.conversationalAgent !== undefined
  ) {
    return await runConversationalAgent({
      agent: p.conversationalAgent,
      input: p.input,
      stream: p.stream,
      sendChunk: p.sendChunk,
    });
  }

  const plan = planFromIntent(classified, p.paths);
  return await dispatchPlan(p, plan);
}
