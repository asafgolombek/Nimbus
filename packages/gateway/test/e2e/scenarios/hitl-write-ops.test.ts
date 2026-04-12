/**
 * Q2 §7.3 — HITL write-ops scenario
 *
 * Verifies that every Q2 write action type routes through the consent gate BEFORE
 * the connector dispatcher is called.  Tests cover:
 *   - Google Drive (file.create)
 *   - Slack (slack.message.post)
 *   - Teams (teams.message.post, teams.message.postChat)
 *   - Linear (linear.issue.create, linear.issue.update, linear.comment.create)
 *   - Jira (jira.issue.create, jira.issue.update, jira.comment.add)
 *   - Notion (notion.page.create, notion.page.update, notion.block.append, notion.comment.create)
 *   - Confluence (confluence.page.create, confluence.page.update, confluence.comment.add)
 *   - Jenkins (jenkins.build.trigger, jenkins.build.abort)
 *   - GitHub Actions (github_actions.run.trigger, github_actions.run.cancel)
 *   - CircleCI (circleci.pipeline.trigger, circleci.job.cancel)
 *
 * No subprocess, no cloud.  Uses the real ToolExecutor with mock consent / audit / dispatcher.
 */

import { describe, expect, test } from "bun:test";
import { HITL_REQUIRED, ToolExecutor } from "../../../src/engine/executor.ts";
import type {
  AuditSink,
  ConnectorDispatcher,
  ConsentChannel,
  PlannedAction,
} from "../../../src/engine/types.ts";

/** All Q2 write action types that must trigger HITL. */
const Q2_WRITE_ACTIONS: ReadonlyArray<string> = [
  "file.create",
  "slack.message.post",
  "teams.message.post",
  "teams.message.postChat",
  "linear.issue.create",
  "linear.issue.update",
  "linear.comment.create",
  "jira.issue.create",
  "jira.issue.update",
  "jira.comment.add",
  "notion.page.create",
  "notion.page.update",
  "notion.block.append",
  "notion.comment.create",
  "confluence.page.create",
  "confluence.page.update",
  "confluence.comment.add",
  "jenkins.build.trigger",
  "jenkins.build.abort",
  "github_actions.run.trigger",
  "github_actions.run.cancel",
  "circleci.pipeline.trigger",
  "circleci.job.cancel",
];

/** Minimal representative payload for each write action type. */
function payloadFor(actionType: string): Record<string, unknown> {
  switch (actionType) {
    case "file.create":
      return { mcpToolId: "google_drive_gdrive_file_create", input: { name: "report.md" } };
    case "slack.message.post":
      return { mcpToolId: "slack_slack_message_post", input: { channel: "C123", text: "hello" } };
    case "teams.message.post":
      return {
        mcpToolId: "teams_teams_message_post",
        input: { teamId: "T1", channelId: "C1", content: "hi" },
      };
    case "teams.message.postChat":
      return {
        mcpToolId: "teams_teams_message_post_chat",
        input: { chatId: "CH1", content: "hi" },
      };
    case "linear.issue.create":
      return {
        mcpToolId: "linear_linear_issue_create",
        input: { teamId: "TEAM", title: "Bug: crash on startup" },
      };
    case "linear.issue.update":
      return {
        mcpToolId: "linear_linear_issue_update",
        input: { issueId: "ISS-1", stateId: "done" },
      };
    case "linear.comment.create":
      return {
        mcpToolId: "linear_linear_comment_create",
        input: { issueId: "ISS-1", body: "Fixed." },
      };
    case "jira.issue.create":
      return {
        mcpToolId: "jira_jira_issue_create",
        input: { projectKey: "NIM", summary: "Login fails" },
      };
    case "jira.issue.update":
      return {
        mcpToolId: "jira_jira_issue_update",
        input: { issueKey: "NIM-42", status: "In Progress" },
      };
    case "jira.comment.add":
      return {
        mcpToolId: "jira_jira_comment_add",
        input: { issueKey: "NIM-42", body: "Investigating." },
      };
    case "notion.page.create":
      return {
        mcpToolId: "notion_notion_page_create",
        input: { parentPageId: "PAGE1", title: "Q2 Retro" },
      };
    case "notion.page.update":
      return {
        mcpToolId: "notion_notion_page_update",
        input: { pageId: "PAGE1", propertiesJson: "{}" },
      };
    case "notion.block.append":
      return {
        mcpToolId: "notion_notion_block_append",
        input: { parentBlockId: "BLK1", childrenJson: "[]" },
      };
    case "notion.comment.create":
      return {
        mcpToolId: "notion_notion_comment_create",
        input: { pageId: "PAGE1", text: "LGTM" },
      };
    case "confluence.page.create":
      return {
        mcpToolId: "confluence_confluence_page_create",
        input: { spaceKey: "ENG", title: "Architecture Decision" },
      };
    case "confluence.page.update":
      return {
        mcpToolId: "confluence_confluence_page_update",
        input: { pageId: "PG1", title: "Architecture Decision v2" },
      };
    case "confluence.comment.add":
      return {
        mcpToolId: "confluence_confluence_comment_add",
        input: { pageId: "PG1", body: "Looks good." },
      };
    case "jenkins.build.trigger":
      return {
        mcpToolId: "jenkins_jenkins_build_trigger",
        input: { jobName: "my-folder/my-job" },
      };
    case "jenkins.build.abort":
      return {
        mcpToolId: "jenkins_jenkins_build_abort",
        input: { jobName: "my-folder/my-job", buildNumber: 7 },
      };
    case "github_actions.run.trigger":
      return {
        mcpToolId: "github_actions_gha_run_trigger",
        input: { owner: "org", repo: "svc", workflowId: "build.yml", ref: "main" },
      };
    case "github_actions.run.cancel":
      return {
        mcpToolId: "github_actions_gha_run_cancel",
        input: { owner: "org", repo: "svc", runId: 12345 },
      };
    case "circleci.pipeline.trigger":
      return {
        mcpToolId: "circleci_circleci_pipeline_trigger",
        input: { projectSlug: "gh/org/svc", branch: "main" },
      };
    case "circleci.job.cancel":
      return {
        mcpToolId: "circleci_circleci_job_cancel",
        input: { projectSlug: "gh/org/svc", jobNumber: 101 },
      };
    default:
      return {};
  }
}

function buildMocks(approve: boolean): {
  consentCalls: string[];
  dispatchCalls: PlannedAction[];
  executor: ToolExecutor;
} {
  const consentCalls: string[] = [];
  const dispatchCalls: PlannedAction[] = [];

  const consent: ConsentChannel = {
    requestApproval(prompt: string): Promise<boolean> {
      consentCalls.push(prompt);
      return Promise.resolve(approve);
    },
  };

  const audit: AuditSink = {
    recordAudit(): void {
      /* no-op */
    },
  };

  const connectors: ConnectorDispatcher = {
    dispatch(action: PlannedAction): Promise<unknown> {
      dispatchCalls.push(action);
      return Promise.resolve({ ok: true });
    },
  };

  return { consentCalls, dispatchCalls, executor: new ToolExecutor(consent, audit, connectors) };
}

describe("HITL_REQUIRED covers every Q2 write action", () => {
  test("all Q2 write action types are in the frozen HITL_REQUIRED set", () => {
    for (const actionType of Q2_WRITE_ACTIONS) {
      expect(HITL_REQUIRED.has(actionType)).toBe(true);
    }
  });
});

describe("ToolExecutor — consent gate fires before dispatch (approved)", () => {
  for (const actionType of Q2_WRITE_ACTIONS) {
    test(`${actionType}: consent requested once, dispatch called once`, async () => {
      const { consentCalls, dispatchCalls, executor } = buildMocks(true);
      const action: PlannedAction = { type: actionType, payload: payloadFor(actionType) };

      const result = await executor.execute(action);

      expect(result.status).toBe("ok");
      expect(consentCalls).toHaveLength(1);
      expect(dispatchCalls).toHaveLength(1);
      expect(dispatchCalls[0]).toMatchObject({ type: actionType });
    });
  }
});

describe("ToolExecutor — consent gate fires before dispatch (rejected)", () => {
  for (const actionType of Q2_WRITE_ACTIONS) {
    test(`${actionType}: consent requested once, dispatch NOT called`, async () => {
      const { consentCalls, dispatchCalls, executor } = buildMocks(false);
      const action: PlannedAction = { type: actionType, payload: payloadFor(actionType) };

      const result = await executor.execute(action);

      expect(result.status).toBe("rejected");
      expect(consentCalls).toHaveLength(1);
      expect(dispatchCalls).toHaveLength(0);
    });
  }
});

describe("ToolExecutor — read-only actions bypass consent gate", () => {
  for (const readAction of ["file_search", "index_search", "filesystem_search_files"]) {
    test(`${readAction}: no consent call, dispatch called directly`, async () => {
      const { consentCalls, dispatchCalls, executor } = buildMocks(false);
      const action: PlannedAction = { type: readAction, payload: { query: "test" } };

      const result = await executor.execute(action);

      expect(result.status).toBe("ok");
      expect(consentCalls).toHaveLength(0);
      expect(dispatchCalls).toHaveLength(1);
    });
  }
});
