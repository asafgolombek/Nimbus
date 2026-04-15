import { describe, expect, test } from "bun:test";

import { bindConsentChannel, formatConsentPrompt, ToolExecutor } from "./index.ts";
import type { AuditSink, ConnectorDispatcher, ConsentChannel, PlannedAction } from "./types.ts";

type AuditRecord = Parameters<AuditSink["recordAudit"]>[0];

/**
 * Patterns that must never appear in persisted HITL audit `action_json` (or consent prompts
 * derived from actions). Aligns with §7.8 / §7.6 — no credential material in audit surfaces.
 */
const CREDENTIAL_ARTIFACT_PATTERNS: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, // JWT-shaped
  /\bghp_[a-z0-9]{20,}\b/i,
  /\bgithub_pat_[a-z0-9_]{20,}\b/i,
  /\bxox[pba]-[a-z0-9-]{10,}\b/i,
  /\bBearer\s+[a-z0-9._-]{8,}\b/i,
  /\bsk-[A-Za-z0-9]{10,}\b/, // common API key prefix
  /\baccess_token["']?\s*:\s*["'][^"']{8,}["']/i,
  /\brefresh_token["']?\s*:\s*["'][^"']{8,}["']/i,
];

function assertNoCredentialArtifacts(text: string, label: string): void {
  for (const re of CREDENTIAL_ARTIFACT_PATTERNS) {
    expect(text, `${label} must not match ${re.source}`).not.toMatch(re);
  }
}

function createExecutorHarness(initialApprove: boolean): {
  auditCalls: AuditRecord[];
  executor: ToolExecutor;
} {
  const auditCalls: AuditRecord[] = [];

  const consent: ConsentChannel = {
    requestApproval(): Promise<boolean> {
      return Promise.resolve(initialApprove);
    },
  };

  const audit: AuditSink = {
    recordAudit(entry: AuditRecord): void {
      auditCalls.push(entry);
    },
  };

  const connectors: ConnectorDispatcher = {
    dispatch(action: PlannedAction): Promise<unknown> {
      return Promise.resolve({ ok: true, action: action.type });
    },
  };

  const executor = new ToolExecutor(consent, audit, connectors);

  return { auditCalls, executor };
}

describe("audit payload safety (§7.8)", () => {
  test("HITL audit action_json has no credential-shaped fragments after approved file.move", async () => {
    const { executor, auditCalls } = createExecutorHarness(true);
    await executor.execute({
      type: "file.move",
      payload: {
        mcpToolId: "filesystem_move_file",
        input: {
          source: "/opt/nimbus/audit-fixture/a.txt",
          destination: "/opt/nimbus/audit-fixture/b.txt",
        },
      },
    });
    expect(auditCalls.length).toBe(1);
    const json = auditCalls[0]?.actionJson ?? "";
    assertNoCredentialArtifacts(json, "approved file.move audit");
  });

  test("HITL audit action_json has no credential-shaped fragments after rejected consent", async () => {
    const { executor, auditCalls } = createExecutorHarness(false);
    await executor.execute({
      type: "slack.message.post",
      payload: { mcpToolId: "slack_post", input: { channel: "C1", text: "hi" } },
    });
    expect(auditCalls.length).toBe(1);
    const json = auditCalls[0]?.actionJson ?? "";
    assertNoCredentialArtifacts(json, "rejected slack.message.post audit");
  });

  test("non-HITL filesystem_search_files audit line is clean", async () => {
    const { executor, auditCalls } = createExecutorHarness(true);
    await executor.execute({
      type: "filesystem_search_files",
      payload: { input: { path: "/data", pattern: "*.md" } },
    });
    expect(auditCalls.length).toBe(1);
    assertNoCredentialArtifacts(auditCalls[0]?.actionJson ?? "", "filesystem_search_files audit");
  });

  test("formatConsentPrompt is safe for representative destructive actions", () => {
    const actions: PlannedAction[] = [
      { type: "notion.page.create", payload: { input: { title: "T", parent: "p" } } },
      { type: "email.send", payload: { mcpToolId: "gmail_send", input: { to: "a@b.co" } } },
    ];
    for (const action of actions) {
      assertNoCredentialArtifacts(formatConsentPrompt(action), `consent prompt ${action.type}`);
    }
  });

  test("bindConsentChannel + executor still yields clean audit JSON", async () => {
    const coordinator = {
      requestConsent: async () => true,
      rejectAllPending: () => {
        /* noop */
      },
      pendingCount: (): number => 0,
    };
    const consent = bindConsentChannel(coordinator, "client-1");
    const auditCalls: AuditRecord[] = [];
    const audit: AuditSink = {
      recordAudit(e: AuditRecord): void {
        auditCalls.push(e);
      },
    };
    const connectors: ConnectorDispatcher = {
      dispatch: async () => ({ ok: true }),
    };
    const executor = new ToolExecutor(consent, audit, connectors);
    await executor.execute({
      type: "linear.issue.create",
      payload: { mcpToolId: "x", input: { teamId: "t", title: "x" } },
    });
    expect(auditCalls.length).toBe(1);
    assertNoCredentialArtifacts(
      auditCalls[0]?.actionJson ?? "",
      "linear.issue.create via bindConsentChannel",
    );
  });
});
