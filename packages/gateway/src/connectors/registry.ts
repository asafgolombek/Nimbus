import type { ConnectorDispatcher, PlannedAction } from "../engine/types.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { createLazyConnectorMesh, type LazyConnectorMesh } from "./lazy-mesh.ts";

export { createLazyConnectorMesh, LazyConnectorMesh } from "./lazy-mesh.ts";

/**
 * Filesystem MCP (always) + lazy Google bundle (Drive, Gmail, Photos) when `google.oauth` exists +
 * lazy Microsoft bundle (OneDrive, Outlook, Teams) when `microsoft.oauth` exists.
 */
export async function buildConnectorMesh(
  paths: PlatformPaths,
  vault: NimbusVault,
): Promise<LazyConnectorMesh> {
  return createLazyConnectorMesh(paths, vault);
}

/** Minimal surface needed to dispatch tools (MCPClient satisfies this at runtime). */
export type McpToolListingClient = {
  listTools(): Promise<
    Record<
      string,
      {
        execute?: (input: unknown, context?: unknown) => Promise<unknown>;
      }
    >
  >;
  /** When tool sets change (lazy MCP), bump this so dispatchers refresh their cache. */
  getToolsEpoch?: () => number;
};

/**
 * Maps {@link PlannedAction} to a Mastra namespaced MCP tool id (see `MCPClient.listTools()`).
 *
 * Resolution order:
 * 1. `action.payload.mcpToolId` when it is a non-empty string
 * 2. `action.type` (must equal the namespaced id, e.g. `filesystem_list_directory`)
 *
 * Execution input: `action.payload.input` when present; otherwise payload minus `mcpToolId` / `input`.
 *
 * Google Drive writes (HITL): use `file.create` | `file.delete` | `file.move` | `file.rename` as
 * `action.type` with `payload.mcpToolId` set to `google_drive_gdrive_file_create` (or `_trash`,
 * `_move`, `_rename`) and `payload.input` matching that tool's MCP arguments.
 *
 * Gmail (HITL): `email.send` → `gmail_gmail_message_send`; `email.draft.send` →
 * `gmail_gmail_draft_send`; `email.draft.create` → `gmail_gmail_draft_create`.
 *
 * OneDrive (HITL): `onedrive.delete` → `onedrive_onedrive_item_delete`; `onedrive.move` →
 * `onedrive_onedrive_item_move`.
 *
 * Outlook (HITL): `email.send` → `outlook_outlook_mail_send`; `calendar.event.create` →
 * `outlook_outlook_calendar_create`; `calendar.event.delete` → `outlook_outlook_calendar_delete`.
 *
 * GitHub (HITL): `repo.pr.merge` → `github_github_pr_merge`; `repo.pr.close` →
 * `github_github_pr_close`; `repo.branch.delete` → `github_github_branch_delete`;
 * `repo.tag.create` → `github_github_tag_create`; `repo.commit.push` → `github_github_commit_push`
 * (stub — not implemented server-side).
 *
 * GitLab (HITL): `repo.pr.merge` → `gitlab_gitlab_mr_merge` (set `payload.mcpToolId` + `input`).
 *
 * Bitbucket (HITL): `repo.pr.merge` → `bitbucket_bitbucket_pr_merge`.
 *
 * Slack (HITL): `slack.message.post` → `slack_slack_message_post` or
 * `slack_slack_message_post_dm` (set `payload.mcpToolId` + `input`).
 *
 * Teams (HITL): `teams.message.post` → `teams_teams_message_post`;
 * `teams.message.postChat` → `teams_teams_message_post_chat`.
 *
 * Linear (HITL): `linear.issue.create` → `linear_linear_issue_create`;
 * `linear.issue.update` → `linear_linear_issue_update`;
 * `linear.comment.create` → `linear_linear_comment_create`.
 *
 * Jira (HITL): `jira.issue.create` → `jira_jira_issue_create`;
 * `jira.issue.update` → `jira_jira_issue_update`; `jira.comment.add` → `jira_jira_comment_add`.
 *
 * Notion (HITL): `notion.page.create` → `notion_notion_page_create`;
 * `notion.page.update` → `notion_notion_page_update`; `notion.block.append` → `notion_notion_block_append`;
 * `notion.comment.create` → `notion_notion_comment_create`.
 *
 * Confluence (HITL): `confluence.page.create` → `confluence_confluence_page_create`;
 * `confluence.page.update` → `confluence_confluence_page_update`;
 * `confluence.comment.add` → `confluence_confluence_comment_add`.
 *
 * Jenkins (HITL): `jenkins.build.trigger` → `jenkins_jenkins_build_trigger`;
 * `jenkins.build.abort` → `jenkins_jenkins_build_abort`.
 *
 * GitHub Actions (HITL): `github_actions.run.trigger` → `github_actions_gha_run_trigger`;
 * `github_actions.run.cancel` → `github_actions_gha_run_cancel`.
 */
export function createConnectorDispatcher(client: McpToolListingClient): ConnectorDispatcher {
  let toolsPromise: ReturnType<McpToolListingClient["listTools"]> | undefined;
  let cachedEpoch = -1;

  async function tools(): Promise<
    Record<string, { execute?: (a: unknown, b?: unknown) => Promise<unknown> }>
  > {
    const epoch = client.getToolsEpoch?.() ?? 0;
    if (toolsPromise === undefined || epoch !== cachedEpoch) {
      cachedEpoch = epoch;
      toolsPromise = client.listTools();
    }
    return toolsPromise;
  }

  return {
    async dispatch(action: PlannedAction): Promise<unknown> {
      const map = await tools();
      const fromPayload = action.payload?.["mcpToolId"];
      const toolId =
        typeof fromPayload === "string" && fromPayload.length > 0 ? fromPayload : action.type;
      const tool = map[toolId];
      if (tool === undefined) {
        const available = Object.keys(map)
          .sort((a, b) => a.localeCompare(b))
          .join(", ");
        throw new Error(`No MCP tool "${toolId}". Available: ${available}`);
      }
      const execute = tool.execute;
      if (execute === undefined) {
        throw new Error(`MCP tool "${toolId}" has no execute implementation`);
      }
      const input = extractToolInput(action);
      return await execute(input, {});
    },
  };
}

function extractToolInput(action: PlannedAction): unknown {
  const p = action.payload;
  if (p === undefined) {
    return {};
  }
  if (Object.hasOwn(p, "input")) {
    return p["input"];
  }
  const rest: Record<string, unknown> = { ...p };
  delete rest["mcpToolId"];
  return rest;
}
