import type { LocalIndex } from "../index/local-index.ts";
import type { ConsentCoordinator } from "../ipc/consent.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import { bindConsentChannel, ToolExecutor } from "./executor.ts";
import { GatewayAgentUnavailableError } from "./gateway-agent-error.ts";
import { planFromIntent } from "./planner.ts";
import { type ClassifiedIntent, classifyIntent } from "./router.ts";
import type { ConnectorDispatcher } from "./types.ts";

export type RunAskParams = {
  input: string;
  stream: boolean;
  clientId: string;
  paths: PlatformPaths;
  consentCoordinator: ConsentCoordinator;
  localIndex: LocalIndex;
  dispatcher: ConnectorDispatcher;
  sendChunk: (text: string) => void;
};

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

/**
 * NL ask pipeline: classify → plan → HITL-gated {@link ToolExecutor} steps.
 */
export async function runAsk(p: RunAskParams): Promise<{ reply: string }> {
  let classified: ClassifiedIntent;
  try {
    classified = await classifyIntent(p.input);
  } catch (e) {
    if (e instanceof GatewayAgentUnavailableError) {
      throw e;
    }
    throw new GatewayAgentUnavailableError();
  }

  const plan = planFromIntent(classified, p.paths);

  if (plan.kind === "reply") {
    if (p.stream) {
      p.sendChunk(plan.text);
    }
    return { reply: plan.text };
  }

  const consent = bindConsentChannel(p.consentCoordinator, p.clientId);
  const executor = new ToolExecutor(consent, p.localIndex, p.dispatcher);
  const summaries: string[] = [];
  const structured: unknown[] = [];

  for (const action of plan.actions) {
    if (p.stream) {
      p.sendChunk(`Running: ${action.type}…\n`);
    }
    const out = await executor.execute(action);
    if (out.status === "rejected") {
      const msg = `Rejected: ${out.reason}`;
      summaries.push(msg);
      structured.push(out);
      break;
    }
    structured.push(out.result);
    summaries.push(`OK: ${action.type}`);
  }

  const reply = `${summaries.join("\n")}\n\n${formatResultSummary(structured)}`;
  if (p.stream) {
    p.sendChunk(`\n${formatResultSummary(structured)}\n`);
  }
  return { reply };
}
