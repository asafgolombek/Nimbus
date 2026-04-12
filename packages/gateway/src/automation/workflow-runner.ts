import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { Agent } from "@mastra/core/agent";
import { runConversationalAgent } from "../engine/run-conversational-agent.ts";
import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import {
  finishWorkflowRunRow,
  getWorkflowByName,
  insertWorkflowRunRow,
  insertWorkflowRunStepRow,
  updateWorkflowRunStepRow,
} from "./workflow-store.ts";

export type WorkflowStep = {
  label?: string;
  run: string;
  continueOnError?: boolean;
};

export function parseWorkflowStepsJson(stepsJson: string): WorkflowStep[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stepsJson) as unknown;
  } catch {
    throw new Error("workflow steps_json is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("workflow steps must be a JSON array");
  }
  const out: WorkflowStep[] = [];
  for (const row of parsed) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const rec = row as Record<string, unknown>;
    const run = typeof rec["run"] === "string" ? rec["run"].trim() : "";
    if (run === "") {
      continue;
    }
    const label = typeof rec["label"] === "string" ? rec["label"].trim() : undefined;
    const continueOnError = rec["continueOnError"] === true || rec["continue_on_error"] === true;
    out.push({
      run,
      ...(label !== undefined && label !== "" ? { label } : {}),
      ...(continueOnError ? { continueOnError: true } : {}),
    });
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
};

export type RunWorkflowExecutionResult = {
  runId: string;
  dryRun: boolean;
  stepResults: Array<{ label?: string; status: string; output?: string; error?: string }>;
};

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

  if (p.dryRun) {
    return {
      runId,
      dryRun: true,
      stepResults: steps.map((s, i) => ({
        label: s.label ?? `step-${String(i + 1)}`,
        status: "preview",
        output: s.run,
      })),
    };
  }

  insertWorkflowRunRow(p.db, {
    id: runId,
    workflowId: wf.id,
    triggeredBy: p.triggeredBy,
    status: "running",
    startedAt: now,
  });

  const outputs: string[] = [];
  const stepResults: RunWorkflowExecutionResult["stepResults"] = [];

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step === undefined) {
        continue;
      }
      const label = step.label ?? `step-${String(i + 1)}`;
      const stepStart = Date.now();
      insertWorkflowRunStepRow(p.db, {
        runId,
        stepIndex: i,
        label,
        status: "running",
        startedAt: stepStart,
      });

      const prior =
        outputs.length > 0
          ? `Prior step outputs (summarize, do not repeat verbatim):\n${outputs.join("\n---\n")}\n\n`
          : "";
      const prompt = `${prior}Workflow step ${String(i + 1)} (${label}):\n${step.run}`;

      if (p.stream) {
        p.sendChunk(`\n— Step ${String(i + 1)}: ${label} —\n`);
      }

      try {
        const { reply } = await runConversationalAgent({
          agent: p.agent,
          input: prompt,
          stream: p.stream,
          sendChunk: p.sendChunk,
        });
        outputs.push(reply);
        updateWorkflowRunStepRow(p.db, runId, i, {
          status: "done",
          resultJson: JSON.stringify({ reply }),
          finishedAt: Date.now(),
        });
        stepResults.push({ label, status: "done", output: reply });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateWorkflowRunStepRow(p.db, runId, i, {
          status: "error",
          resultJson: JSON.stringify({ error: msg }),
          finishedAt: Date.now(),
        });
        stepResults.push({ label, status: "error", error: msg });
        if (!step.continueOnError) {
          finishWorkflowRunRow(p.db, runId, "error", Date.now(), msg);
          return { runId, dryRun: false, stepResults };
        }
      }
    }

    finishWorkflowRunRow(p.db, runId, "done", Date.now(), null);
    return { runId, dryRun: false, stepResults };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishWorkflowRunRow(p.db, runId, "error", Date.now(), msg);
    throw err;
  }
}
