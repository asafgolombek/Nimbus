import type { ExtensionManifest } from "../extensions/manifest.ts";

/** Scalar types supported in generated-tool parameters. */
export type ToolInputScalar = "string" | "number" | "boolean";

/** A single property in the generated tool's input schema. */
export type ToolInputProperty =
  | { readonly type: ToolInputScalar; readonly description?: string }
  | {
      readonly type: "array";
      readonly items: { readonly type: ToolInputScalar };
      readonly description?: string;
    };

/** The restricted JSON-Schema subset describing a generated tool's parameters. */
export interface ToolInputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ToolInputProperty>>;
  readonly required?: readonly string[];
}

/**
 * The custom MCP method a generated tool uses to ask the gateway to make a request for it.
 *
 * Defined ONCE here and imported by `toolgen-stub.ts` (which emits it into the generated skeleton)
 * and `toolgen-broker.ts` (which serves it). Static rule D29(a) confines the literal to this file:
 * a producer and a consumer that separately hardcode the same string are two copies that can drift
 * invisibly — the exact failure `SANDBOX_POLICY_ENV` documents for its own wire.
 */
export const BROKERED_FETCH_METHOD = "nimbus/fetch";

/** Named codes so a caller distinguishes refusals without matching on message text. */
export class ToolgenError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolgenError";
  }
}

/**
 * How the broker attaches a secret. A tagged envelope rather than a bare string: a bare string
 * would force either a convention ("assume Bearer") or a tool-supplied hint, and the second is the
 * tool telling the broker how to spend a credential it cannot see.
 */
export type ToolCredentialBinding =
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "header"; readonly headerName: string; readonly value: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string };

/**
 * Everything the owner approves, hashed into the audit row, and (in PR 3) signed — ONE object so
 * the three can never diverge.
 *
 * `credentialHosts` lists the hosts for which a Vault binding exists at approval time. It is part
 * of the artifact because "this tool will send a credential to X" is a fact the owner is
 * consenting to, so a later change to it must invalidate the approval.
 */
export interface GeneratedToolArtifact {
  readonly toolId: string;
  readonly toolName: string;
  readonly description: string;
  /** The VERBATIM model-authored body. Never a digest at the approval prompt. */
  readonly body: string;
  readonly approvedHosts: readonly string[];
  readonly credentialHosts: readonly string[];
  readonly manifest: ExtensionManifest;
}

/** A registered, live tool: the approved artifact plus its runtime bookkeeping. */
export interface ToolgenEnvelope {
  readonly artifact: GeneratedToolArtifact;
  readonly sessionId: string;
  readonly scriptPath: string;
  readonly approvedAt: number;
}
