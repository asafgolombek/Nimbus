export type WorkflowRunContext = {
  clientId: string;
  /** Saved workflow name (same as workflow.save `name`). */
  workflowName: string;
  triggeredBy: string;
  dryRun: boolean;
  stream: boolean;
  sendChunk: (text: string) => void;
  sessionId?: string;
  /** Engine profile: `nimbus` (default), `devops`, or `research`. */
  agent?: string;
};

export type WorkflowRunHandler = (ctx: WorkflowRunContext) => Promise<{
  runId: string;
  dryRun: boolean;
  stepResults: Array<{ label?: string; status: string; output?: string; error?: string }>;
}>;
