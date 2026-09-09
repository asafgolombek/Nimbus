import { scanBodyForForbiddenGlobals, verifyBodySyntax } from "./toolgen-body-checks.ts";
import type { GroundedEndpoint } from "./toolgen-grounding.ts";
import { type DraftGrounding, groundingOf } from "./toolgen-grounding.ts";
import { buildDraftPrompt, buildRedraftPrompt } from "./toolgen-prompt.ts";
import { validateInputSchema } from "./toolgen-schema.ts";
import {
  type CreateGeneratedToolRequest,
  type DraftGeneration,
  type DraftSubject,
  ToolgenError,
  type ToolInputSchema,
} from "./toolgen-types.ts";

const GROUNDING_LIMIT = 8;

export interface DraftedTool {
  readonly body: string;
  readonly inputSchema: ToolInputSchema;
  readonly grounding: DraftGrounding;
  readonly attempts: 1 | 2;
  /**
   * Whether the model that authored this body was local. DERIVED from `provider.isLocal` (I34),
   * never from a vendor id or a config value — `drafting = "allow-remote"` permits a remote draft
   * but does not mean one happened. Recorded on the audit row and used by the CLI to decide
   * whether "configure a larger local model" is useful advice.
   */
  readonly locality: "local" | "remote";
}

export type { DraftGeneration };

export interface ToolgenDraftDeps {
  /** Narrowed router view. `null` means no eligible provider — never an empty string. */
  readonly generate: (prompt: string) => Promise<DraftGeneration | null>;
  readonly findEndpoints: (query: string, limit: number) => Promise<GroundedEndpoint[]>;
}

/**
 * Pull the JSON object out of whatever the model wrapped it in. NORMALISATION, not a ladder rung.
 *
 * Three widening attempts, in order. An ANCHORED fence regex is not enough: a reply reading
 * "Here is the tool:\n```json\n{…}\n```" matches nothing, falls through as raw text, fails
 * `JSON.parse`, and burns the single redraft on a formatting artifact — spending the retry budget
 * that exists for real defects.
 *
 * Widening is safe because `JSON.parse` downstream remains the actual gate: an over-eager slice
 * that grabs prose simply fails rung 1, exactly as no extraction would have. This can make a
 * malformed reply parse; it cannot make a non-object one pass.
 */
export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Not bare JSON — fall through to the wrapped forms.
  }
  // Unanchored, so surrounding prose does not defeat it.
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(trimmed);
  if (fenced?.[1] !== undefined) return fenced[1].trim();

  // Outermost braces. `lastIndexOf` and not the first closing brace, so a `}` inside the body
  // string does not truncate the object.
  const open = trimmed.indexOf("{");
  const close = trimmed.lastIndexOf("}");
  if (open >= 0 && close > open) return trimmed.slice(open, close + 1).trim();

  return trimmed;
}

interface LadderFailure {
  readonly rung: string;
  readonly reason: string;
}

/** What the ladder itself can determine. `grounding`, `attempts` and `locality` are the caller's. */
type LadderPass = Pick<DraftedTool, "body" | "inputSchema">;

function runLadder(raw: string): LadderPass | LadderFailure {
  // Rung 1 — the envelope parses.
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(raw));
  } catch (err) {
    return {
      rung: "rung 1 (output envelope)",
      reason: `reply is not JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { rung: "rung 1 (output envelope)", reason: "reply is not a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  const body = obj["body"];
  if (typeof body !== "string" || body.trim() === "") {
    return { rung: "rung 1 (output envelope)", reason: '"body" must be a non-empty string' };
  }

  // Rung 2 — the schema is inside the restricted subset.
  let inputSchema: ToolInputSchema;
  try {
    inputSchema = validateInputSchema(obj["inputSchema"]);
  } catch (err) {
    return { rung: "rung 2 (input schema)", reason: (err as Error).message };
  }

  // Rung 3 — the body parses.
  try {
    verifyBodySyntax(body);
  } catch (err) {
    return { rung: "rung 3 (body syntax)", reason: (err as Error).message };
  }

  // Rung 4 — no construct the sandbox would refuse. NOT a security boundary; see the module.
  try {
    scanBodyForForbiddenGlobals(body);
  } catch (err) {
    return { rung: "rung 4 (forbidden globals)", reason: (err as Error).message };
  }

  return { body, inputSchema };
}

function isFailure(v: LadderPass | LadderFailure): v is LadderFailure {
  return "rung" in v;
}

export type { DraftSubject };

/**
 * Draft one tool: ground, prompt, validate, and redraft AT MOST once.
 *
 * One retry and not zero because the commonest failure is a model returning prose, which it
 * recovers from when told. One and not N because every attempt is a real model call that a remote
 * route ledgers and that spends the owner's budget (spec § 4.3).
 *
 * Takes `CreateGeneratedToolRequest` plus a host SUBJECT and nothing else: credential material must
 * never reach a drafting prompt, since a secret in a remote model's context has left the machine
 * (spec § 9.1). `credentialHosts` is a list of NAMES, resolved by the gate from the credentials it
 * holds — this function is never handed the credentials themselves and has no type that could
 * carry one.
 */
export async function draftGeneratedTool(
  req: CreateGeneratedToolRequest,
  deps: ToolgenDraftDeps,
  subject: DraftSubject,
): Promise<DraftedTool> {
  const endpoints = await deps.findEndpoints(req.description, GROUNDING_LIMIT);
  const grounding = groundingOf(endpoints);
  const prompt = buildDraftPrompt({
    description: req.description,
    // NORMALISED hosts, from the gate. Passing `req.hosts` here would show the model what the
    // owner TYPED (`https://api.github.com/v1`) while the broker matches `url.hostname`
    // (`api.github.com`) — the prompt would name a host the tool cannot actually reach.
    hosts: subject.hosts,
    credentialHosts: subject.credentialHosts,
    endpoints,
  });

  let current = prompt;
  let last: LadderFailure | null = null;
  for (const attempt of [1, 2] as const) {
    const generated = await deps.generate(current);
    if (generated === null) {
      // A `null` on the redraft call means the FIRST attempt's failure is being discarded —
      // the owner must not be sent off to "configure a model" when one just answered and failed
      // validation. State both facts: what the first attempt got wrong, and that the redraft
      // could not reach a model at all. A `null` on the very first call has no prior failure to
      // report, so `last` is `null` there and the message stays exactly as it always was.
      throw new ToolgenError(
        "ERR_TOOLGEN_NO_DRAFT_MODEL",
        last === null
          ? "no model is available to draft a tool body"
          : `the first attempt failed at ${last.rung}: ${last.reason} — no model was available for the redraft`,
      );
    }
    const result = runLadder(generated.text);
    if (!isFailure(result)) {
      return {
        ...result,
        grounding,
        attempts: attempt,
        locality: generated.isLocal ? "local" : "remote",
      };
    }
    last = result;
    current = buildRedraftPrompt(prompt, result.rung, result.reason);
  }

  throw new ToolgenError(
    "ERR_TOOLGEN_DRAFT_INVALID",
    `the drafted tool failed validation twice — ${last?.rung ?? "unknown"}: ${last?.reason ?? ""}`,
  );
}
