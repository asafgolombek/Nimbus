// S8-F3 / chain C4 — wraps a tool result in a <tool_output> envelope so the
// LLM is structurally informed that the inner content is data, not
// instructions. The envelope is a plain string applied at the LLM-facing
// boundary (agent tools + Mastra-visible MCP tools). The bare result still
// flows through the planner path (ConnectorDispatcher → ToolExecutor) where
// the structural HITL gate is the defense.

export interface ToolOutputContext {
  /** Originating service identifier (e.g. "github", "filesystem"). */
  service: string;
  /** Fully-qualified tool id (e.g. "github_repo_get"). */
  tool: string;
}

function escapeAttr(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Wraps `result` in a <tool_output service="…" tool="…">…</tool_output> envelope.
 * The body is JSON-stringified; any literal </tool_output> sequences in the
 * body are broken into <\/tool_output> so the LLM tokenizer does not match
 * them against the structural close.
 */
export function wrapToolOutput(ctx: ToolOutputContext, result: unknown): string {
  const body = JSON.stringify(result ?? null);
  const safeBody = body.replaceAll("</tool_output>", "<\\/tool_output>");
  return `<tool_output service="${escapeAttr(ctx.service)}" tool="${escapeAttr(ctx.tool)}">${safeBody}</tool_output>`;
}
