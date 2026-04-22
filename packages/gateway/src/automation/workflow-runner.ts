import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { Agent } from "@mastra/core/agent";
import { formatAuditPayload } from "../audit/format-audit-payload.ts";
import { appendAuditEntry } from "../db/audit-chain.ts";
import {
  type RunConversationalAgentParams,
  runConversationalAgent,
} from "../engine/run-conversational-agent.ts";
import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { previewHitlActionsForStepText } from "./workflow-hitl-preview.ts";
import { pruneWorkflowRuns } from "./workflow-run-history.ts";
import {
  finishWorkflowRunRow,
  getWorkflowByName,
  insertWorkflowRunRow,
  insertWorkflowRunStepRow,
  updateWorkflowRunStepRow,
} from "./workflow-store.ts";

const RUN_RETENTION_PER_WORKFLOW = 100;

function emitRunCompletedAudit(params: {
  readonly db: Database;
  readonly runId: string;
  readonly workflowName: string;
  readonly status: string;
  readonly startedAt: number;
  readonly dryRun: boolean;
  readonly paramsOverride?: Readonly<Record<string, Record<string, unknown>>>;
  readonly errorMsg?: string | null;
}): void {
  const durationMs = Date.now() - params.startedAt;
  const details: Record<string, unknown> = {
    runId: params.runId,
    workflowName: params.workflowName,
    status: params.status,
    durationMs,
    dryRun: params.dryRun,
  };
  if (params.paramsOverride !== undefined) {
    details.paramsOverride = params.paramsOverride;
  }
  if (params.errorMsg !== undefined && params.errorMsg !== null) {
    details.errorMsg = params.errorMsg;
  }
  appendAuditEntry(params.db, {
    actionType: "workflow.run.completed",
    hitlStatus: "not_required",
    actionJson: formatAuditPayload(details),
    timestamp: Date.now(),
  });
}

export type WorkflowStep = {
  label?: string;
  run: string;
  continueOnError?: boolean;
};

function parseOneWorkflowStepRow(row: unknown): WorkflowStep | null {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return null;
  }
  const rec = row as Record<string, unknown>;
  const run = typeof rec["run"] === "string" ? rec["run"].trim() : "";
  if (run === "") {
    return null;
  }
  const label = typeof rec["label"] === "string" ? rec["label"].trim() : undefined;
  const continueOnError = rec["continueOnError"] === true || rec["continue_on_error"] === true;
  const step: WorkflowStep = { run };
  if (label !== undefined && label !== "") {
    step.label = label;
  }
  if (continueOnError) {
    step.continueOnError = true;
  }
  return step;
}

export function parseWorkflowStepsJson(stepsJson: string): WorkflowStep[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stepsJson) as unknown;
  } catch {
    throw new Error("workflow steps_json is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError("workflow steps must be a JSON array");
  }
  const out: WorkflowStep[] = [];
  for (const row of parsed) {
    const step = parseOneWorkflowStepRow(row);
    if (step !== null) {
      out.push(step);
    }
  }
  if (out.length === 0) {
    throw new Error("workflow has no executable steps (need objects with non-empty run string)");
  }
  return out;
}

export type RunWorkflowExecutionParams = {
  db: Database;
  agent: Agent;
  workflowName: string;
  triggeredBy: string;
  dryRun: boolean;
  stream: boolean;
  sendChunk: (text: string) => void;
  /** When set (tests), invoked instead of {@link runConversationalAgent}. Production IPC omits this. */
  conversationalRunner?: (p: RunConversationalAgentParams) => Promise<{ reply: string }>;
  /**
   * Optional per-step parameter overrides: map of step label → params patch.
   * Persisted on the workflow_run row as `params_override_json` for audit.
   * For prompt-based steps, the override is recorded but not applied mid-execution
   * (steps have no structured params object to merge into).
   */
  readonly paramsOverride?: Readonly<Record<string, Record<string, unknown>>>;
};

export type RunWorkflowExecutionResult = {
  runId: string;
  dryRun: boolean;
  stepResults: Array<{
    label?: string;
    status: string;
    output?: string;
    error?: string;
    /** Dry-run only: heuristic HITL action ids for CLI preview. */
    hitlActions?: readonly string[];
  }>;
};

type StepExecOutcome =
  | { kind: "ok"; label: string; reply: string }
  | { kind: "err"; label: string; message: string; halt: boolean };

async function executeWorkflowStep(
  p: RunWorkflowExecutionParams,
  runId: string,
  stepIndex: number,
  step: WorkflowStep,
  outputs: string[],
): Promise<StepExecOutcome> {
  const label = step.label ?? `step-${String(stepIndex + 1)}`;
  const stepStart = Date.now();
  insertWorkflowRunStepRow(p.db, {
    runId,
    stepIndex,
    label,
    status: "running",
    startedAt: stepStart,
  });

  const prior =
    outputs.length > 0
      ? `Prior step outputs (summarize, do not repeat verbatim):\n${outputs.join("\n---\n")}\n\n`
      : "";
  const prompt = `${prior}Workflow step ${String(stepIndex + 1)} (${label}):\n${step.run}`;

  if (p.stream) {
    p.sendChunk(`\n— Step ${String(stepIndex + 1)}: ${label} —\n`);
  }

  try {
    const runner = p.conversationalRunner ?? runConversationalAgent;
    const { reply } = await runner({
      agent: p.agent,
      input: prompt,
      stream: p.stream,
      sendChunk: p.sendChunk,
    });
    outputs.push(reply);
    updateWorkflowRunStepRow(p.db, runId, stepIndex, {
      status: "done",
      resultJson: JSON.stringify({ reply }),
      finishedAt: Date.now(),
    });
    return { kind: "ok", label, reply };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateWorkflowRunStepRow(p.db, runId, stepIndex, {
      status: "error",
      resultJson: JSON.stringify({ error: msg }),
      finishedAt: Date.now(),
    });
    return { kind: "err", label, message: msg, halt: step.continueOnError !== true };
  }
}

/**
 * Executes a saved workflow sequentially via the conversational agent (tools allowed per step).
 */
export async function runWorkflowExecution(
  p: RunWorkflowExecutionParams,
): Promise<RunWorkflowExecutionResult> {
  if (readIndexedUserVersion(p.db) < 9) {
    throw new Error("Workflow schema requires v9+");
  }
  const wf = getWorkflowByName(p.db, p.workflowName);
  if (wf === null) {
    throw new Error(`Unknown workflow: ${p.workflowName}`);
  }
  const steps = parseWorkflowStepsJson(wf.steps_json);
  const runId = randomUUID();
  const now = Date.now();
  const paramsOverrideJson =
    p.paramsOverride === undefined ? null : JSON.stringify(p.paramsOverride);

  if (p.dryRun) {
    insertWorkflowRunRow(p.db, {
      id: runId,
      workflowId: wf.id,
      triggeredBy: p.triggeredBy,
      status: "preview",
      startedAt: now,
      dryRun: true,
      paramsOverrideJson,
    });
    finishWorkflowRunRow(p.db, runId, "preview", Date.now(), null);
    emitRunCompletedAudit({
      db: p.db,
      runId,
      workflowName: wf.name,
      status: "preview",
      startedAt: now,
      dryRun: true,
      paramsOverride: p.paramsOverride,
    });
    pruneWorkflowRuns(p.db, wf.id, RUN_RETENTION_PER_WORKFLOW);
    return {
      runId,
      dryRun: true,
      stepResults: steps.map((s, i) => ({
        label: s.label ?? `step-${String(i + 1)}`,
        status: "preview",
        output: s.run,
        hitlActions: previewHitlActionsForStepText(s.run),
      })),
    };
  }

  insertWorkflowRunRow(p.db, {
    id: runId,
    workflowId: wf.id,
    triggeredBy: p.triggeredBy,
    status: "running",
    startedAt: now,
    paramsOverrideJson,
  });

  const outputs: string[] = [];
  const stepResults: RunWorkflowExecutionResult["stepResults"] = [];

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step === undefined) {
        continue;
      }
      const outcome = await executeWorkflowStep(p, runId, i, step, outputs);
      if (outcome.kind === "ok") {
        stepResults.push({ label: outcome.label, status: "done", output: outcome.reply });
        continue;
      }
      stepResults.push({ label: outcome.label, status: "error", error: outcome.message });
      if (outcome.halt) {
        finishWorkflowRunRow(p.db, runId, "error", Date.now(), outcome.message);
        emitRunCompletedAudit({
          db: p.db,
          runId,
          workflowName: wf.name,
          status: "error",
          startedAt: now,
          dryRun: false,
          paramsOverride: p.paramsOverride,
          errorMsg: outcome.message,
        });
        pruneWorkflowRuns(p.db, wf.id, RUN_RETENTION_PER_WORKFLOW);
        return { runId, dryRun: false, stepResults };
      }
    }

    finishWorkflowRunRow(p.db, runId, "done", Date.now(), null);
    emitRunCompletedAudit({
      db: p.db,
      runId,
      workflowName: wf.name,
      status: "done",
      startedAt: now,
      dryRun: false,
      paramsOverride: p.paramsOverride,
    });
    pruneWorkflowRuns(p.db, wf.id, RUN_RETENTION_PER_WORKFLOW);
    return { runId, dryRun: false, stepResults };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishWorkflowRunRow(p.db, runId, "error", Date.now(), msg);
    emitRunCompletedAudit({
      db: p.db,
      runId,
      workflowName: wf.name,
      status: "error",
      startedAt: now,
      dryRun: false,
      paramsOverride: p.paramsOverride,
      errorMsg: msg,
    });
    pruneWorkflowRuns(p.db, wf.id, RUN_RETENTION_PER_WORKFLOW);
    throw err;
  }
}
