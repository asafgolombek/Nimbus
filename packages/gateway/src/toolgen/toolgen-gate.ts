import type { Database } from "bun:sqlite";
import type { NimbusToolGenerationToml } from "../config/nimbus-toml.ts";
import { appendAuditEntry } from "../db/audit-chain.ts";
import type { EnforcedPolicy } from "../policy/policy-gate.ts";
import { artifactDigest } from "./toolgen-artifact.ts";
import type { GeneratedToolHandle } from "./toolgen-client.ts";
import type { ToolgenApprovalInput } from "./toolgen-consent-broker.ts";
import type { ToolgenRegistry } from "./toolgen-registry.ts";
import { assertSafeToolId } from "./toolgen-script-store.ts";
import { buildGeneratedManifest, emitToolScript } from "./toolgen-stub.ts";
import { type GeneratedToolArtifact, type ToolgenEnvelope, ToolgenError } from "./toolgen-types.ts";

const CAPABILITY = "tool_generation";
const APPROVAL_TTL_MS = 120_000;

/**
 * Reduce whatever the owner typed to the bare hostname the broker will compare against.
 *
 * The broker matches `url.hostname` EXACTLY (no suffix matching), so an approved entry of
 * `https://api.example.com/v1` would match nothing at all — a tool approved for a host it can
 * never reach. Normalising here rather than at the broker keeps the artifact the owner approved and
 * the value later compared identical.
 */
export function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") throw new ToolgenError("ERR_TOOLGEN_HOST_NOT_ALLOWED", "empty host");
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    throw new ToolgenError("ERR_TOOLGEN_HOST_NOT_ALLOWED", `unparseable host: ${raw}`);
  }
}

export interface CreateGeneratedToolRequest {
  readonly sessionId: string;
  readonly description: string;
  readonly hosts: readonly string[];
}

export interface ToolgenGateDeps {
  readonly db: Database;
  readonly config: NimbusToolGenerationToml;
  readonly enforced?: Pick<EnforcedPolicy, "capabilitiesDisabled"> | undefined;
  readonly registry: ToolgenRegistry;
  readonly draftBody: (req: CreateGeneratedToolRequest) => Promise<string>;
  readonly assertConfinement: (
    manifest: ReturnType<typeof buildGeneratedManifest>,
  ) => Promise<void>;
  /** Pure path derivation (Task 11's `toolScriptDir`, bound to the config dir). Touches no disk. */
  readonly scriptDir: (toolId: string) => string;
  readonly writeScript: (toolId: string, source: string) => Promise<string>;
  /** Bound closure over the PAL runner + cwd (Task 12's `spawnGeneratedTool`). */
  readonly spawn: (envelope: ToolgenEnvelope) => Promise<GeneratedToolHandle>;
  readonly requestApproval: (input: ToolgenApprovalInput, ttlMs: number) => Promise<boolean>;
  /**
   * Persist the caller-supplied credentials under the NEW toolId and return the hosts that now have
   * one. Called BEFORE the approval prompt, so `credentialHosts` in the artifact is a real answer to
   * "what will be sent, and where" rather than an always-empty list.
   *
   * This is why credentials are supplied to `nimbus tool create` rather than added afterwards: the
   * toolId does not exist until create runs, so a credential could never be in the Vault at
   * approval time — and adding one to a LIVE tool would change the artifact the owner approved
   * (§ 4.5 puts `credentialHosts` inside the signed/hashed object precisely so that a change
   * invalidates the approval). `nimbus tool credential set` therefore REFUSES a live tool.
   */
  readonly bindCredentials: (toolId: string, hosts: readonly string[]) => Promise<string[]>;
  readonly now: () => number;
  readonly newId: () => string;
}

export type ToolgenOutcome =
  | { readonly status: "registered"; readonly toolId: string }
  | { readonly status: "denied" }
  | { readonly status: "refused"; readonly code: string };

type OutcomeTag =
  | "denied_by_owner"
  | "refused_before_consent"
  | "registered"
  | "failed_after_approval";

/**
 * `audit_log.hitl_status` is CHECK-constrained to approved/rejected/not_required, so this
 * capability's outcomes do not map one-to-one. A refusal-before-consent and an owner denial both
 * record `rejected`, told apart by `outcome`. `not_required` is deliberately NEVER used here: on a
 * `tool.generate` row it would read as "a tool was generated without needing approval", the single
 * most dangerous thing an auditor could wrongly conclude.
 */
function audit(
  deps: ToolgenGateDeps,
  hitlStatus: "approved" | "rejected",
  outcome: OutcomeTag,
  payload: Record<string, unknown>,
): void {
  appendAuditEntry(deps.db, {
    actionType: "tool.generate",
    hitlStatus,
    actionJson: JSON.stringify({ outcome, ...payload }),
    timestamp: deps.now(),
  });
}

/**
 * The ONE path from a model-authored body to a registered, callable tool (invariant I39).
 *
 * The ORDER is load-bearing and mirrors `runExecution`: every refusal decidable WITHOUT the owner
 * happens before the consent prompt, so a capability disabled by config or org policy never
 * advertises its own existence by prompting, and the sandbox posture is proven before the owner is
 * asked to approve something that could not have been confined.
 */
export async function createGeneratedTool(
  req: CreateGeneratedToolRequest,
  deps: ToolgenGateDeps,
): Promise<ToolgenOutcome> {
  const toolId = deps.newId();
  let approved = false;
  try {
    // The id is minted by the gateway, never supplied by a caller -- but it is validated anyway,
    // because it is interpolated into a filesystem path AND into a `//` comment in the emitted
    // script (`toolgen-stub.ts`). Asserted here rather than left to depend on `scriptDir` happening
    // to run first, so a bad `newId` is refused before anything -- including approval -- happens.
    assertSafeToolId(toolId);

    // 1. Local kill-switch.
    if (!deps.config.enabled) {
      throw new ToolgenError("ERR_TOOLGEN_DISABLED", "tool generation is disabled");
    }
    // 2. Org policy (I22). An ABSENT accessor refuses fail-closed rather than defaulting to
    //    enabled -- the gap multimodal PR 1 left open and PR 2 closed.
    if (deps.enforced === undefined) {
      throw new ToolgenError("ERR_TOOLGEN_POLICY_DISABLED", "org policy unavailable; refusing");
    }
    if (deps.enforced.capabilitiesDisabled.has(CAPABILITY)) {
      throw new ToolgenError("ERR_TOOLGEN_POLICY_DISABLED", "disabled by org policy");
    }
    // 3. Session budget.
    if (deps.registry.countForSession(req.sessionId) >= deps.config.maxToolsPerSession) {
      throw new ToolgenError(
        "ERR_TOOLGEN_SESSION_BUDGET_EXCEEDED",
        `session already holds ${deps.config.maxToolsPerSession} generated tools`,
      );
    }
    // 4. Draft, then build the manifest -- network EMPTY by construction.
    const body = await deps.draftBody(req);
    // The script DIRECTORY is derived before the manifest so the manifest can grant read to it.
    // Nothing is WRITTEN there until after approval (step 7) — a derived path touches no disk.
    const manifest = buildGeneratedManifest(toolId, { scriptDir: deps.scriptDir(toolId) });
    // 5. Prove confinement on THIS machine, still before consent.
    await deps.assertConfinement(manifest);

    // Normalised, not trusted as typed: a user will paste `https://api.example.com/v1` or
    // `api.example.com:443`, and an unnormalised entry would never match the broker's
    // `url.hostname` comparison — silently producing a tool that can reach nothing.
    const hosts = [...new Set(req.hosts.map(normalizeHost))].sort();
    if (hosts.length === 0) {
      throw new ToolgenError("ERR_TOOLGEN_HOST_NOT_ALLOWED", "at least one --host is required");
    }
    const credentialHosts = await deps.bindCredentials(toolId, hosts);
    const artifact: GeneratedToolArtifact = {
      toolId,
      toolName: `generated_${toolId}`,
      description: req.description,
      body,
      approvedHosts: hosts,
      credentialHosts,
      manifest,
    };

    // 6. Owner approves the VERBATIM artifact.
    approved = await deps.requestApproval(
      {
        toolId,
        toolName: artifact.toolName,
        description: artifact.description,
        body: artifact.body,
        approvedHosts: hosts,
        credentialHosts,
        initiator: "owner",
      },
      APPROVAL_TTL_MS,
    );
    if (!approved) {
      audit(deps, "rejected", "denied_by_owner", { toolId, body, hosts });
      return { status: "denied" };
    }

    // 7. Only now does anything reach the filesystem or spawn.
    const scriptPath = await deps.writeScript(toolId, emitToolScript(artifact));
    const envelope: ToolgenEnvelope = {
      artifact,
      sessionId: req.sessionId,
      scriptPath,
      approvedAt: deps.now(),
    };
    const handle = await deps.spawn(envelope);
    deps.registry.register(envelope, () => handle.close());

    audit(deps, "approved", "registered", {
      toolId,
      body,
      hosts,
      credentialHosts,
      artifactDigest: artifactDigest(artifact),
    });
    return { status: "registered", toolId };
  } catch (err) {
    const code = err instanceof ToolgenError ? err.code : "ERR_TOOLGEN_INTERNAL";
    audit(deps, "rejected", approved ? "failed_after_approval" : "refused_before_consent", {
      toolId,
      code,
      message: (err as Error).message,
    });
    return { status: "refused", code };
  }
}
