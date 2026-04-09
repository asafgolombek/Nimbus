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
      "calendar.event.create",
      "onedrive.delete",
      "pipeline.trigger",
      "deployment.apply",
      "k8s.delete",
      "incident.resolve",
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

  for (const fileAction of ["file.create", "file.move", "file.rename"] as const) {
    test(`rejected consent for ${fileAction} does not call the connector; audit rejected`, async () => {
      const m = createMocks(true);
      m.approveNext = false;
      const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
      const payload =
        fileAction === "file.create"
          ? { mcpToolId: "google_drive_gdrive_file_create", input: { name: "n.txt" } }
          : fileAction === "file.move"
            ? {
                mcpToolId: "google_drive_gdrive_file_move",
                input: { fileId: "x", newParentId: "y" },
              }
            : {
                mcpToolId: "google_drive_gdrive_file_rename",
                input: { fileId: "x", newName: "z" },
              };
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
