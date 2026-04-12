import { randomUUID } from "node:crypto";
import type { ConsentCoordinator } from "../ipc/consent.ts";
import { ConsentDisconnectedError } from "../ipc/consent.ts";
import type {
  ActionResult,
  AuditSink,
  ConnectorDispatcher,
  ConsentChannel,
  PlannedAction,
} from "./types.ts";

/**
 * HITL whitelist — immutable at runtime. The backing `Set` is module-private;
 * the exported value is a frozen `ReadonlySet` facade so `Object.freeze(new Set())`
 * cannot be bypassed via engine quirks (some runtimes still allow `Set.prototype.add`
 * on a frozen Set).
 *
 * Source of truth: `architecture.md` §HITL Consent Gate — Implementation Contract.
 */
const HITL_REQUIRED_BACKING = new Set<string>([
  // Cloud storage & communication
  "file.delete",
  "file.move",
  "file.rename",
  "file.create",
  "email.send",
  "email.draft.send",
  "email.draft.create",
  "calendar.event.create",
  "calendar.event.delete",
  "photo.delete",
  "onedrive.delete",
  "onedrive.move",
  "slack.message.post",
  "teams.message.post",
  "teams.message.postChat",
  // Linear
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
  // Source control
  "repo.pr.merge",
  "repo.pr.close",
  "repo.branch.delete",
  "repo.tag.create",
  "repo.commit.push",
  // CI/CD
  "pipeline.trigger",
  "pipeline.cancel",
  "pipeline.rerun",
  "jenkins.build.trigger",
  "jenkins.build.abort",
  // Deployments & infrastructure
  "deployment.apply",
  "deployment.rollback",
  "infra.apply",
  "infra.destroy",
  "k8s.apply",
  "k8s.delete",
  "k8s.rollout.restart",
  "cloud.resource.scale",
  "cloud.resource.stop",
  // Monitoring & incidents
  "alert.acknowledge",
  "alert.silence",
  "incident.escalate",
  "incident.resolve",
]);

/** Runtime value is an immutable facade; typed as `ReadonlySet` for call sites (`.has`, iteration). */
export const HITL_REQUIRED = Object.freeze({
  has(x: string): boolean {
    return HITL_REQUIRED_BACKING.has(x);
  },
  get size(): number {
    return HITL_REQUIRED_BACKING.size;
  },
  *[Symbol.iterator](): IterableIterator<string> {
    yield* HITL_REQUIRED_BACKING;
  },
  entries(): IterableIterator<[string, string]> {
    return HITL_REQUIRED_BACKING.entries();
  },
  keys(): IterableIterator<string> {
    return HITL_REQUIRED_BACKING.keys();
  },
  values(): IterableIterator<string> {
    return HITL_REQUIRED_BACKING.values();
  },
  forEach(
    callbackfn: (value: string, value2: string, set: ReadonlySet<string>) => void,
    thisArg?: unknown,
  ): void {
    for (const v of HITL_REQUIRED_BACKING) {
      callbackfn.call(thisArg, v, v, HITL_REQUIRED);
    }
  },
}) as ReadonlySet<string>;

export function formatConsentPrompt(action: PlannedAction): string {
  const lines = [`Action requires your approval`, ``, `Type: ${action.type}`];
  if (action.payload !== undefined && Object.keys(action.payload).length > 0) {
    lines.push("", `Details: ${JSON.stringify(action.payload)}`);
  }
  return lines.join("\n");
}

function auditPayload(
  action: PlannedAction,
  extras: { hitlRejectReason?: string } | undefined,
): string {
  return JSON.stringify(extras === undefined ? { action } : { action, ...extras });
}

export class ToolExecutor {
  constructor(
    private readonly consent: ConsentChannel,
    private readonly audit: AuditSink,
    private readonly connectors: ConnectorDispatcher,
  ) {}

  async execute(action: PlannedAction): Promise<ActionResult> {
    const requiresHITL = HITL_REQUIRED.has(action.type);

    let hitlStatus: "approved" | "rejected" | "not_required";
    let rejectReason: string | undefined;
    let auditExtras: { hitlRejectReason?: string } | undefined;

    try {
      if (requiresHITL) {
        const approved = await this.consent.requestApproval(
          formatConsentPrompt(action),
          action.payload,
        );
        hitlStatus = approved ? "approved" : "rejected";
        if (!approved) {
          rejectReason = "User declined consent gate.";
        }
      } else {
        hitlStatus = "not_required";
      }
    } catch (e) {
      if (e instanceof ConsentDisconnectedError) {
        hitlStatus = "rejected";
        rejectReason = e.message;
        auditExtras = { hitlRejectReason: e.hitlAuditReason };
      } else {
        throw e;
      }
    }

    // ALWAYS write audit record BEFORE any connector call
    this.audit.recordAudit({
      actionType: action.type,
      hitlStatus,
      actionJson: auditPayload(action, auditExtras),
      timestamp: Date.now(),
    });

    if (hitlStatus === "rejected") {
      return {
        status: "rejected",
        reason: rejectReason ?? "User declined consent gate.",
      };
    }

    const result = await this.connectors.dispatch(action);
    return { status: "ok", result };
  }
}

/**
 * Binds IPC consent to a single client for use inside `ToolExecutor`.
 */
export function bindConsentChannel(
  coordinator: ConsentCoordinator,
  clientId: string,
): ConsentChannel {
  return {
    requestApproval(prompt: string, details?: Record<string, unknown>): Promise<boolean> {
      return coordinator.requestConsent(clientId, {
        requestId: randomUUID(),
        prompt,
        details,
      });
    },
  };
}
