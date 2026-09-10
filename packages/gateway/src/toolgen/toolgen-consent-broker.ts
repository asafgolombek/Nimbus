import { ConsentBroker } from "../util/consent-broker.ts";
import type { DraftGrounding } from "./toolgen-grounding.ts";
import type { ToolInputSchema } from "./toolgen-types.ts";

export interface ToolgenApprovalInput {
  readonly toolId: string;
  readonly toolName: string;
  readonly description: string;
  /**
   * The VERBATIM model-authored body -- never a digest. The human is the entire security boundary
   * for this capability, and a prompt reading "register tool blake3:a1b2..." is a rubber stamp with
   * extra steps.
   */
  readonly body: string;
  readonly approvedHosts: readonly string[];
  /** Hosts for which a credential will be attached. "What will be sent, and where." */
  readonly credentialHosts: readonly string[];
  /** The parameters the owner is being asked to approve -- the same object stored in the artifact. */
  readonly inputSchema: ToolInputSchema;
  /** How the draft was grounded -- disclosed so the owner can see whether it is a guess. */
  readonly grounding: DraftGrounding;
  /**
   * Who asked. `"owner"` in PR 1. Present now so the agent-initiated path (PR 2) cannot ship a
   * prompt that looks identical to one the owner started.
   */
  readonly initiator: "owner";
}

/**
 * Owner-approval round-trip for registering a generated tool (I39): broadcasts
 * `toolgen.approvalRequest` and resolves when the owner answers via `toolgen.approvalRespond`
 * (fail-closed on TTL).
 */
export class ToolgenConsentBroker extends ConsentBroker<ToolgenApprovalInput> {
  constructor() {
    super("toolgen.approvalRequest");
  }
}

/** Process singleton shared by the IPC dispatcher and the gate. */
export const toolgenConsent = new ToolgenConsentBroker();
