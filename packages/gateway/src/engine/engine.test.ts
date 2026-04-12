import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConsentCoordinatorImpl,
  ConsentDisconnectedError,
  type ConsentSessionWriter,
} from "../ipc/consent.ts";
import {
  bindConsentChannel,
  ENGINE_SUBSYSTEM_ID,
  formatConsentPrompt,
  HITL_REQUIRED,
  ToolExecutor,
} from "./index.ts";
import type { AuditSink, ConnectorDispatcher, ConsentChannel, PlannedAction } from "./types.ts";

type AuditRecord = Parameters<AuditSink["recordAudit"]>[0];

/** Avoid hardcoded `/tmp/…` in tests (world-writable; Sonar security hotspot). */
const HITL_TEST_TARGET_PATH = join(tmpdir(), "nimbus-engine-hitl-test-target");

describe("engine subsystem", () => {
  test("exports stable subsystem id", () => {
    expect(ENGINE_SUBSYSTEM_ID).toBe("nimbus-engine");
  });
});

describe("HITL_REQUIRED", () => {
  test("cannot be mutated at runtime (no Set.prototype.add on export)", () => {
    const mutable = HITL_REQUIRED as unknown as Set<string>;
    expect(() => {
      mutable.add("evil.action");
    }).toThrow();
    expect(HITL_REQUIRED.has("evil.action")).toBe(false);
  });

  test("includes core destructive / outbound action types", () => {
    for (const t of [
      "file.delete",
      "file.create",
      "email.send",
      "email.draft.create",
      "calendar.event.create",
      "calendar.event.delete",
      "onedrive.delete",
      "onedrive.move",
      "pipeline.trigger",
      "deployment.apply",
      "k8s.delete",
      "incident.resolve",
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
      "gitlab.pipeline.retry",
      "gitlab.pipeline.cancel",
      "pagerduty.incident.acknowledge",
      "pagerduty.incident.resolve",
      "pagerduty.incident.escalate",
    ]) {
      expect(HITL_REQUIRED.has(t)).toBe(true);
    }
  });
});

function createMocks(initialApprove = true): {
  approveNext: boolean;
  consentCalls: string[];
  consent: ConsentChannel;
  auditCalls: AuditRecord[];
  audit: AuditSink;
  dispatchCalls: PlannedAction[];
  connectors: ConnectorDispatcher;
} {
  const consentCalls: string[] = [];
  const auditCalls: AuditRecord[] = [];
  const dispatchCalls: PlannedAction[] = [];
  let approveNext = initialApprove;

  const consent: ConsentChannel = {
    requestApproval(prompt: string): Promise<boolean> {
      consentCalls.push(prompt);
      return Promise.resolve(approveNext);
    },
  };

  const audit: AuditSink = {
    recordAudit(entry: AuditRecord): void {
      auditCalls.push(entry);
    },
  };

  const connectors: ConnectorDispatcher = {
    dispatch(action: PlannedAction): Promise<unknown> {
      dispatchCalls.push(action);
      return Promise.resolve({ done: true });
    },
  };

  return {
    get approveNext(): boolean {
      return approveNext;
    },
    set approveNext(v: boolean) {
      approveNext = v;
    },
    consentCalls,
    consent,
    auditCalls,
    audit,
    dispatchCalls,
    connectors,
  };
}

function hitlNotionRejectPayload(
  notionAction:
    | "notion.page.create"
    | "notion.page.update"
    | "notion.block.append"
    | "notion.comment.create",
): Record<string, unknown> {
  if (notionAction === "notion.page.create") {
    return {
      mcpToolId: "notion_notion_page_create",
      input: { parentPageId: "p1", title: "t" },
    };
  }
  if (notionAction === "notion.page.update") {
    return {
      mcpToolId: "notion_notion_page_update",
      input: { pageId: "p1", propertiesJson: "{}" },
    };
  }
  if (notionAction === "notion.block.append") {
    return {
      mcpToolId: "notion_notion_block_append",
      input: { parentBlockId: "b1", childrenJson: "[]" },
    };
  }
  return {
    mcpToolId: "notion_notion_comment_create",
    input: { pageId: "p1", text: "c" },
  };
}

function hitlEmailRejectPayload(
  emailAction: "email.send" | "email.draft.send" | "email.draft.create",
): Record<string, unknown> {
  if (emailAction === "email.send") {
    return {
      mcpToolId: "gmail_gmail_message_send",
      input: { to: "a@b.com", subject: "s", body: "x" },
    };
  }
  if (emailAction === "email.draft.send") {
    return { mcpToolId: "gmail_gmail_draft_send", input: { draftId: "d1" } };
  }
  return {
    mcpToolId: "gmail_gmail_draft_create",
    input: { to: "a@b.com", subject: "s", body: "x" },
  };
}

function hitlJiraRejectPayload(
  jiraAction: "jira.issue.create" | "jira.issue.update" | "jira.comment.add",
): Record<string, unknown> {
  if (jiraAction === "jira.issue.create") {
    return {
      mcpToolId: "jira_jira_issue_create",
      input: { projectKey: "NIM", summary: "x" },
    };
  }
  if (jiraAction === "jira.issue.update") {
    return {
      mcpToolId: "jira_jira_issue_update",
      input: { issueKey: "NIM-1", summary: "y" },
    };
  }
  return {
    mcpToolId: "jira_jira_comment_add",
    input: { issueKey: "NIM-1", body: "c" },
  };
}

function hitlFileRejectPayload(
  fileAction: "file.create" | "file.move" | "file.rename",
): Record<string, unknown> {
  if (fileAction === "file.create") {
    return { mcpToolId: "google_drive_gdrive_file_create", input: { name: "n.txt" } };
  }
  if (fileAction === "file.move") {
    return {
      mcpToolId: "google_drive_gdrive_file_move",
      input: { fileId: "x", newParentId: "y" },
    };
  }
  return {
    mcpToolId: "google_drive_gdrive_file_rename",
    input: { fileId: "x", newName: "z" },
  };
}

function hitlTeamsRejectPayload(
  teamsAction: "teams.message.post" | "teams.message.postChat",
): Record<string, unknown> {
  if (teamsAction === "teams.message.post") {
    return {
      mcpToolId: "teams_teams_message_post",
      input: { teamId: "t1", channelId: "c1", body: "hi" },
    };
  }
  return {
    mcpToolId: "teams_teams_message_post_chat",
    input: { chatId: "ch1", body: "hi" },
  };
}

function hitlLinearRejectPayload(
  linearAction: "linear.issue.create" | "linear.issue.update" | "linear.comment.create",
): Record<string, unknown> {
  if (linearAction === "linear.issue.create") {
    return {
      mcpToolId: "linear_linear_issue_create",
      input: { teamId: "t1", title: "x" },
    };
  }
  if (linearAction === "linear.issue.update") {
    return {
      mcpToolId: "linear_linear_issue_update",
      input: { issueId: "i1", title: "y" },
    };
  }
  return {
    mcpToolId: "linear_linear_comment_create",
    input: { issueId: "i1", body: "c" },
  };
}

type ConfluenceHitlRejectAction =
  | "confluence.page.create"
  | "confluence.page.update"
  | "confluence.comment.add";

function hitlJenkinsRejectPayload(
  jenkinsAction: "jenkins.build.trigger" | "jenkins.build.abort",
): Record<string, unknown> {
  if (jenkinsAction === "jenkins.build.trigger") {
    return {
      mcpToolId: "jenkins_jenkins_build_trigger",
      input: { jobName: "folder/job" },
    };
  }
  return {
    mcpToolId: "jenkins_jenkins_build_abort",
    input: { jobName: "folder/job", buildNumber: 42 },
  };
}

function hitlGithubActionsRejectPayload(
  ghaAction: "github_actions.run.trigger" | "github_actions.run.cancel",
): Record<string, unknown> {
  if (ghaAction === "github_actions.run.trigger") {
    return {
      mcpToolId: "github_actions_gha_run_trigger",
      input: { owner: "acme", repo: "app", workflowId: "ci.yml", ref: "main" },
    };
  }
  return {
    mcpToolId: "github_actions_gha_run_cancel",
    input: { owner: "acme", repo: "app", runId: 99 },
  };
}

function hitlCircleciRejectPayload(
  cciAction: "circleci.pipeline.trigger" | "circleci.job.cancel",
): Record<string, unknown> {
  if (cciAction === "circleci.pipeline.trigger") {
    return {
      mcpToolId: "circleci_circleci_pipeline_trigger",
      input: { projectSlug: "gh/acme/app", branch: "main" },
    };
  }
  return {
    mcpToolId: "circleci_circleci_job_cancel",
    input: { projectSlug: "gh/acme/app", jobNumber: 42 },
  };
}

function hitlGitlabCiRejectPayload(
  glAction: "gitlab.pipeline.retry" | "gitlab.pipeline.cancel",
): Record<string, unknown> {
  if (glAction === "gitlab.pipeline.retry") {
    return {
      mcpToolId: "gitlab_gitlab_pipeline_retry",
      input: { projectPath: "acme/app", pipelineId: 9001 },
    };
  }
  return {
    mcpToolId: "gitlab_gitlab_pipeline_cancel",
    input: { projectPath: "acme/app", pipelineId: 9002 },
  };
}

function hitlPagerdutyRejectPayload(
  pdAction:
    | "pagerduty.incident.acknowledge"
    | "pagerduty.incident.resolve"
    | "pagerduty.incident.escalate",
): Record<string, unknown> {
  if (pdAction === "pagerduty.incident.acknowledge") {
    return {
      mcpToolId: "pagerduty_pd_incident_acknowledge",
      input: { incidentId: "Q123" },
    };
  }
  if (pdAction === "pagerduty.incident.resolve") {
    return {
      mcpToolId: "pagerduty_pd_incident_resolve",
      input: { incidentId: "Q123" },
    };
  }
  return {
    mcpToolId: "pagerduty_pd_incident_escalate",
    input: { incidentId: "Q123" },
  };
}

function hitlConfluenceRejectPayload(
  confluenceAction: ConfluenceHitlRejectAction,
): Record<string, unknown> {
  if (confluenceAction === "confluence.page.create") {
    return {
      mcpToolId: "confluence_confluence_page_create",
      input: { spaceKey: "S", title: "t", storageHtml: "<p>x</p>" },
    };
  }
  if (confluenceAction === "confluence.page.update") {
    return {
      mcpToolId: "confluence_confluence_page_update",
      input: {
        pageId: "1",
        versionNumber: 1,
        title: "t",
        storageHtml: "<p>y</p>",
      },
    };
  }
  return {
    mcpToolId: "confluence_confluence_comment_add",
    input: { pageId: "1", storageHtml: "<p>c</p>" },
  };
}

describe("ToolExecutor", () => {
  test("every HITL_REQUIRED action type triggers the consent channel", async () => {
    for (const actionType of HITL_REQUIRED) {
      const m = createMocks(true);
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      await exec.execute({ type: actionType });
      expect(m.consentCalls.length).toBe(1);
    }
  });

  test("action types not in HITL_REQUIRED do not call the consent channel", async () => {
    const m = createMocks(true);
    const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
    await exec.execute({ type: "filesystem.search" });
    expect(m.consentCalls.length).toBe(0);
  });

  test("rejected consent does not call the connector; audit shows rejected", async () => {
    const m = createMocks(true);
    m.approveNext = false;
    const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
    const action: PlannedAction = { type: "file.delete", payload: { path: HITL_TEST_TARGET_PATH } };
    const out = await exec.execute(action);
    expect(out).toEqual({ status: "rejected", reason: "User declined consent gate." });
    expect(m.dispatchCalls.length).toBe(0);
    expect(m.auditCalls.length).toBe(1);
    expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
    expect(m.auditCalls[0]?.actionType).toBe("file.delete");
  });

  for (const emailAction of ["email.send", "email.draft.send", "email.draft.create"] as const) {
    test(`rejected consent for ${emailAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlEmailRejectPayload(emailAction);
      const out = await exec.execute({ type: emailAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(emailAction);
    });
  }

  test("rejected consent for slack.message.post does not call the connector; audit rejected", async () => {
    const m = createMocks(true);
    m.approveNext = false;
    const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
    const out = await exec.execute({
      type: "slack.message.post",
      payload: {
        mcpToolId: "slack_slack_message_post",
        input: { channel: "C0123", text: "hi" },
      },
    });
    expect(out.status).toBe("rejected");
    expect(m.dispatchCalls.length).toBe(0);
    expect(m.auditCalls.length).toBe(1);
    expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
    expect(m.auditCalls[0]?.actionType).toBe("slack.message.post");
  });

  for (const teamsAction of ["teams.message.post", "teams.message.postChat"] as const) {
    test(`rejected consent for ${teamsAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlTeamsRejectPayload(teamsAction);
      const out = await exec.execute({ type: teamsAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(teamsAction);
    });
  }

  for (const linearAction of [
    "linear.issue.create",
    "linear.issue.update",
    "linear.comment.create",
  ] as const) {
    test(`rejected consent for ${linearAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlLinearRejectPayload(linearAction);
      const out = await exec.execute({ type: linearAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(linearAction);
    });
  }

  for (const jiraAction of [
    "jira.issue.create",
    "jira.issue.update",
    "jira.comment.add",
  ] as const) {
    test(`rejected consent for ${jiraAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlJiraRejectPayload(jiraAction);
      const out = await exec.execute({ type: jiraAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(jiraAction);
    });
  }

  for (const notionAction of [
    "notion.page.create",
    "notion.page.update",
    "notion.block.append",
    "notion.comment.create",
  ] as const) {
    test(`rejected consent for ${notionAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlNotionRejectPayload(notionAction);
      const out = await exec.execute({ type: notionAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(notionAction);
    });
  }

  for (const confluenceAction of [
    "confluence.page.create",
    "confluence.page.update",
    "confluence.comment.add",
  ] as const) {
    test(`rejected consent for ${confluenceAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlConfluenceRejectPayload(confluenceAction);
      const out = await exec.execute({ type: confluenceAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(confluenceAction);
    });
  }

  for (const jenkinsAction of ["jenkins.build.trigger", "jenkins.build.abort"] as const) {
    test(`rejected consent for ${jenkinsAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlJenkinsRejectPayload(jenkinsAction);
      const out = await exec.execute({ type: jenkinsAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(jenkinsAction);
    });
  }

  for (const ghaAction of ["github_actions.run.trigger", "github_actions.run.cancel"] as const) {
    test(`rejected consent for ${ghaAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlGithubActionsRejectPayload(ghaAction);
      const out = await exec.execute({ type: ghaAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(ghaAction);
    });
  }

  for (const cciAction of ["circleci.pipeline.trigger", "circleci.job.cancel"] as const) {
    test(`rejected consent for ${cciAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlCircleciRejectPayload(cciAction);
      const out = await exec.execute({ type: cciAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(cciAction);
    });
  }

  for (const glAction of ["gitlab.pipeline.retry", "gitlab.pipeline.cancel"] as const) {
    test(`rejected consent for ${glAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlGitlabCiRejectPayload(glAction);
      const out = await exec.execute({ type: glAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(glAction);
    });
  }

  for (const pdAction of [
    "pagerduty.incident.acknowledge",
    "pagerduty.incident.resolve",
    "pagerduty.incident.escalate",
  ] as const) {
    test(`rejected consent for ${pdAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlPagerdutyRejectPayload(pdAction);
      const out = await exec.execute({ type: pdAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(pdAction);
    });
  }

  for (const fileAction of ["file.create", "file.move", "file.rename"] as const) {
    test(`rejected consent for ${fileAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload = hitlFileRejectPayload(fileAction);
      const out = await exec.execute({ type: fileAction, payload });
      expect(out.status).toBe("rejected");
      expect(m.dispatchCalls.length).toBe(0);
      expect(m.auditCalls.length).toBe(1);
      expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
      expect(m.auditCalls[0]?.actionType).toBe(fileAction);
    });
  }

  test("approved consent calls the connector; audit shows approved", async () => {
    const m = createMocks(true);
    const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
    const action: PlannedAction = { type: "file.delete", payload: { path: HITL_TEST_TARGET_PATH } };
    const out = await exec.execute(action);
    expect(out).toEqual({ status: "ok", result: { done: true } });
    expect(m.dispatchCalls).toEqual([action]);
    expect(m.auditCalls[0]?.hitlStatus).toBe("approved");
  });

  test("not_required path calls connector without consent; audit shows not_required", async () => {
    const m = createMocks(true);
    const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
    const action: PlannedAction = { type: "filesystem.search", payload: { q: "notes" } };
    const out = await exec.execute(action);
    expect(out).toEqual({ status: "ok", result: { done: true } });
    expect(m.consentCalls.length).toBe(0);
    expect(m.auditCalls[0]?.hitlStatus).toBe("not_required");
  });

  test("audit record is written before the connector dispatch", async () => {
    const order: string[] = [];
    const consent: ConsentChannel = {
      requestApproval(): Promise<boolean> {
        return Promise.resolve(true);
      },
    };
    const audit: AuditSink = {
      recordAudit(): void {
        order.push("audit");
      },
    };
    const connectors: ConnectorDispatcher = {
      dispatch(): Promise<unknown> {
        order.push("dispatch");
        return Promise.resolve(undefined);
      },
    };
    const exec = new ToolExecutor(consent, audit, connectors);
    await exec.execute({ type: "file.delete" });
    expect(order).toEqual(["audit", "dispatch"]);
  });

  test("ConsentDisconnectedError rejects without connector; audit records rejected with disconnect reason", async () => {
    const consent: ConsentChannel = {
      requestApproval(): Promise<boolean> {
        return Promise.reject(new ConsentDisconnectedError("client disconnected"));
      },
    };
    const auditCalls: AuditRecord[] = [];
    const audit: AuditSink = {
      recordAudit(e: AuditRecord): void {
        auditCalls.push(e);
      },
    };
    let dispatched = false;
    const connectors: ConnectorDispatcher = {
      dispatch(): Promise<unknown> {
        dispatched = true;
        return Promise.resolve(undefined);
      },
    };
    const exec = new ToolExecutor(consent, audit, connectors);
    const action: PlannedAction = { type: "file.move", payload: { from: "a", to: "b" } };
    const out = await exec.execute(action);
    expect(out).toEqual({ status: "rejected", reason: "client disconnected" });
    expect(dispatched).toBe(false);
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0]?.hitlStatus).toBe("rejected");
    const parsed: unknown = JSON.parse(auditCalls[0]?.actionJson ?? "{}");
    expect(parsed).toEqual(
      expect.objectContaining({
        hitlRejectReason: "client disconnected",
      }),
    );
  });

  test("non-consent errors from the consent channel propagate (no audit, no dispatch)", async () => {
    const consent: ConsentChannel = {
      requestApproval(): Promise<boolean> {
        return Promise.reject(new Error("network glitch"));
      },
    };
    const auditCalls: AuditRecord[] = [];
    const audit: AuditSink = {
      recordAudit(e: AuditRecord): void {
        auditCalls.push(e);
      },
    };
    const connectors: ConnectorDispatcher = {
      dispatch(): Promise<unknown> {
        return Promise.resolve(undefined);
      },
    };
    const exec = new ToolExecutor(consent, audit, connectors);
    await expect(exec.execute({ type: "file.delete" })).rejects.toThrow("network glitch");
    expect(auditCalls.length).toBe(0);
  });

  test("bindConsentChannel wires coordinator + clientId for requestApproval", async () => {
    let lastRequestId = "";
    const writers = new Map<string, ConsentSessionWriter>();
    const coordinator = new ConsentCoordinatorImpl((clientId) => writers.get(clientId));
    writers.set("c1", (n) => {
      const p = n.params as { requestId: string };
      lastRequestId = p.requestId;
    });
    const channel = bindConsentChannel(coordinator, "c1");
    const pending = channel.requestApproval("approve move?", { path: "/x" });
    expect(lastRequestId.length).toBeGreaterThan(0);
    const err = coordinator.handleRespond("c1", { requestId: lastRequestId, approved: true });
    expect(err).toBeNull();
    await expect(pending).resolves.toBe(true);
  });
});

describe("formatConsentPrompt", () => {
  test("includes type and optional payload", () => {
    expect(formatConsentPrompt({ type: "file.delete" })).toContain("file.delete");
    const withPayload = formatConsentPrompt({
      type: "file.delete",
      payload: { path: "/p" },
    });
    expect(withPayload).toContain("Details:");
    expect(withPayload).toContain("/p");
  });
});
