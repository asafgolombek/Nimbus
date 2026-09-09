import { confirm, isCancel } from "@clack/prompts";
import { INTERACTIVE_RPC_TIMEOUT_MS } from "../lib/rpc-timeouts.ts";
import { withGatewayIpc } from "../lib/with-gateway-ipc.ts";

/**
 * Control outcomes, in the SAME 124-127 shell-reserved band `exec.ts`'s `EXEC_EXIT_CODES` uses, and
 * for the identical reason: 126/127 are the shell's own found-but-not-executed / not-found codes, so
 * picking them here (rather than a fresh 10-14 range that ordinary scripts would use for their own
 * errors) minimises collision with anything this command itself might one day emit. There is no
 * `wallClock`/`outputCap` pair here -- a tool registration has no running-script phase to bound, only
 * "the owner approved it" (`denied` when they didn't) or "it never got that far" (`refused`).
 */
export const TOOL_EXIT_CODES = {
  denied: 126,
  refused: 127,
} as const;

/** One `--credential <host>=<token>` binding, parsed but never rendered back to the terminal. */
export interface CredentialBindingArg {
  readonly host: string;
  readonly token: string;
}

export type CredentialSchemeArg =
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "header"; readonly headerName: string; readonly value: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string };

export type ParsedToolArgs =
  | {
      readonly sub: "create";
      readonly description: string;
      readonly hosts: string[];
      readonly credentials: CredentialBindingArg[];
    }
  | { readonly sub: "list"; readonly json: boolean }
  | { readonly sub: "revoke"; readonly toolId: string }
  | {
      readonly sub: "credential-set";
      readonly toolId: string;
      readonly host: string;
      readonly scheme: CredentialSchemeArg;
    };

const USAGE = [
  "Usage: nimbus tool create --description <text> --host <h> [--host <h>...]",
  "                           [--credential <host>=<token>]...",
  "       nimbus tool list [--json]",
  "       nimbus tool revoke <tool-id>",
  "       nimbus tool credential set <tool-id> <host>",
  "                           (--bearer <token> | --header <name> <value> | --basic <user> <pass>)",
].join("\n");

function parseCreateArgs(rest: readonly string[]): Extract<ParsedToolArgs, { sub: "create" }> {
  let description: string | undefined;
  const hosts: string[] = [];
  const credentials: CredentialBindingArg[] = [];

  let i = 0;
  while (i < rest.length) {
    const flag = rest[i];
    const next = (): string => {
      const v = rest[++i];
      if (v === undefined) throw new Error(`${flag} requires a value\n${USAGE}`);
      return v;
    };
    switch (flag) {
      case "--description":
        description = next();
        break;
      case "--host":
        hosts.push(next());
        break;
      case "--credential": {
        const raw = next();
        // Split on the FIRST "=" only -- a bearer token can itself contain "=" (base64 padding),
        // so `raw.split("=")` would silently truncate it.
        const eq = raw.indexOf("=");
        if (eq <= 0) {
          throw new Error(`--credential must be <host>=<token>, got "${raw}"\n${USAGE}`);
        }
        credentials.push({ host: raw.slice(0, eq), token: raw.slice(eq + 1) });
        break;
      }
      default:
        throw new Error(`Unknown flag: ${flag}\n${USAGE}`);
    }
    i += 1;
  }

  if (description === undefined) {
    throw new Error(`nimbus tool create: --description is required\n${USAGE}`);
  }
  if (hosts.length === 0) {
    throw new Error(`nimbus tool create: at least one --host is required\n${USAGE}`);
  }
  // A credential naming a host the owner did not also grant via --host would let the approval
  // prompt's `credentialHosts` disclose a binding for a host the tool was never approved to reach --
  // refused here, before anything is sent to the gateway, rather than resolved by silently adding
  // the host to the grant.
  for (const cred of credentials) {
    if (!hosts.includes(cred.host)) {
      throw new Error(
        `nimbus tool create: --credential names host "${cred.host}", which is not in --host\n${USAGE}`,
      );
    }
  }
  return { sub: "create", description, hosts, credentials };
}

function parseListArgs(rest: readonly string[]): Extract<ParsedToolArgs, { sub: "list" }> {
  let json = false;
  for (const flag of rest) {
    if (flag === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown flag: ${flag}\n${USAGE}`);
  }
  return { sub: "list", json };
}

function parseRevokeArgs(rest: readonly string[]): Extract<ParsedToolArgs, { sub: "revoke" }> {
  const toolId = rest[0];
  if (toolId === undefined || toolId.startsWith("--")) {
    throw new Error(`nimbus tool revoke: a tool id is required\n${USAGE}`);
  }
  return { sub: "revoke", toolId };
}

/**
 * `nimbus tool credential set <tool-id> <host> (--bearer|--header|--basic ...)`.
 *
 * Parsing succeeds independently of whether the tool named is live -- that check belongs to
 * `runCredentialSetCmd`, which refuses unconditionally (see its doc comment). Kept separate so the
 * pure parser stays testable without a gateway.
 */
function parseCredentialSetArgs(
  rest: readonly string[],
): Extract<ParsedToolArgs, { sub: "credential-set" }> {
  const positional: string[] = [];
  let bearer: string | undefined;
  let header: { name: string; value: string } | undefined;
  let basic: { user: string; pass: string } | undefined;
  let schemeCount = 0;

  let i = 0;
  while (i < rest.length) {
    const flag = rest[i];
    const next = (): string => {
      const v = rest[++i];
      if (v === undefined) throw new Error(`${flag} requires a value\n${USAGE}`);
      return v;
    };
    switch (flag) {
      case "--bearer":
        bearer = next();
        schemeCount += 1;
        break;
      case "--header":
        header = { name: next(), value: next() };
        schemeCount += 1;
        break;
      case "--basic":
        basic = { user: next(), pass: next() };
        schemeCount += 1;
        break;
      default:
        if (flag?.startsWith("--")) {
          throw new Error(`Unknown flag: ${flag}\n${USAGE}`);
        }
        if (flag !== undefined) positional.push(flag);
        break;
    }
    i += 1;
  }

  const toolId = positional[0];
  const host = positional[1];
  if (toolId === undefined) {
    throw new Error(`nimbus tool credential set: a tool id is required\n${USAGE}`);
  }
  if (host === undefined) {
    throw new Error(`nimbus tool credential set: a host is required\n${USAGE}`);
  }
  // ONE message covers both the "none supplied" and "more than one supplied" cases: it names every
  // scheme flag (so a caller who typed none sees what to add) and says "exactly one" (so a caller
  // who typed two sees why it was refused rather than one being picked silently).
  if (schemeCount !== 1) {
    throw new Error(
      "nimbus tool credential set requires exactly one of --bearer <token>, " +
        `--header <name> <value>, or --basic <user> <pass>\n${USAGE}`,
    );
  }
  let scheme: CredentialSchemeArg;
  if (bearer !== undefined) {
    scheme = { type: "bearer", token: bearer };
  } else if (header !== undefined) {
    scheme = { type: "header", headerName: header.name, value: header.value };
  } else if (basic !== undefined) {
    scheme = { type: "basic", username: basic.user, password: basic.pass };
  } else {
    // Unreachable: `schemeCount === 1` above guarantees exactly one of the three is set.
    throw new Error(`internal: no credential scheme captured\n${USAGE}`);
  }
  return { sub: "credential-set", toolId, host, scheme };
}

/**
 * Parse `nimbus tool`'s argv. Unknown flags and unknown subcommands THROW rather than being
 * ignored or defaulted -- silently dropping `--credential` would approve a tool for fewer secrets
 * than the owner believed they granted, and silently defaulting an unknown subcommand would run the
 * wrong one.
 */
export function parseToolArgs(argv: readonly string[]): ParsedToolArgs {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "create":
      return parseCreateArgs(rest);
    case "list":
      return parseListArgs(rest);
    case "revoke":
      return parseRevokeArgs(rest);
    case "credential": {
      const [action, ...credRest] = rest;
      if (action !== "set") {
        throw new Error(`Unknown "nimbus tool credential" subcommand: "${action ?? ""}"\n${USAGE}`);
      }
      return parseCredentialSetArgs(credRest);
    }
    default:
      throw new Error(`Unknown "nimbus tool" subcommand: "${sub ?? ""}"\n${USAGE}`);
  }
}

// -------------------------------------------------------------------------------------------
// Orchestration below. Only the parser above and the pure render/format helpers are unit-tested
// directly with real assertions on message content; the gateway round-trip is exercised through
// injected fakes, matching `exec.ts`'s split.
// -------------------------------------------------------------------------------------------

/**
 * Every `nimbus tool` invocation from this CLI shares one session id. The gateway's
 * `ToolgenRegistry` is keyed by `sessionId` (it also bounds `max_tools_per_session`), and a real
 * agent conversation mints a fresh one per session via `agentRequestContext`. A CLI-originated tool
 * belongs to no such conversation, so a random id per invocation would make `nimbus tool list`
 * unable to find a tool `nimbus tool create` had just registered in a different process. A single
 * fixed id groups every CLI-originated tool into one stable, listable session for the life of the
 * gateway process (the registry itself is in-memory only and does not survive a restart).
 */
export const CLI_TOOLGEN_SESSION_ID = "cli";

/** What a `toolgen.create` call resolves to, mirroring the gateway's `ToolgenOutcome`. */
export interface ToolOutcomeShape {
  readonly status: string;
  readonly code?: string;
  readonly toolId?: string;
}

/** Where rendered output goes. Injected so rendering is testable without a live process. */
export interface OutcomeSink {
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
}

/**
 * Map a `toolgen.create` outcome to a process exit code. An unrecognised shape maps to `refused`,
 * never 0 -- exiting 0 on something this command did not understand would read as "it registered".
 */
export function exitCodeForTool(outcome: ToolOutcomeShape): number {
  if (outcome.status === "registered") return 0;
  if (outcome.status === "denied") return TOOL_EXIT_CODES.denied;
  return TOOL_EXIT_CODES.refused;
}

/**
 * The message shown for PR 1's known, permanent-for-this-release refusal.
 *
 * `toolgen.create` runs the ENTIRE gate -- the local kill-switch, org policy, the session budget,
 * confinement -- and only THEN refuses, at the point where a model would author the tool body. This
 * command must say exactly that rather than printing a bare error code: a generic "refused
 * (ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED)" would read as a bug to work around, when it is in fact the
 * honest shape of this release -- the gate, sandbox and broker are real; drafting is not, on
 * purpose, because designing that prompt is its own reviewed piece of work.
 */
const DRAFT_NOT_IMPLEMENTED_MESSAGE = [
  "error: tool drafting is not implemented in this release.",
  "       The generation gate, sandbox and broker are in place; the step that",
  "       drafts the tool body is not. See docs/superpowers/specs/2026-09-09-s2-runtime-tool-generation-design.md § 10.",
].join("\n");

/**
 * Write a `toolgen.create` outcome to the user. Pure over an injected sink, matching
 * `exec.ts`'s `renderOutcome` split.
 */
export function renderToolOutcome(outcome: ToolOutcomeShape, sink: OutcomeSink): void {
  if (outcome.status === "registered") {
    sink.out(`Tool registered: ${outcome.toolId ?? "(unknown id)"}\n`);
    return;
  }
  if (outcome.status === "denied") {
    sink.err("nimbus: tool registration denied\n");
    return;
  }
  if (outcome.code === "ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED") {
    sink.err(`${DRAFT_NOT_IMPLEMENTED_MESSAGE}\n`);
    return;
  }
  sink.err(`nimbus: refused (${outcome.code ?? "unknown"})\n`);
}

/** What a `toolgen.approvalRequest` broadcast carries, prior to validation. */
export interface ToolApprovalPrompt {
  readonly toolName: string;
  readonly description: string;
  readonly body: string;
  readonly approvedHosts: readonly string[];
  readonly credentialHosts: readonly string[];
}

const list = (v: readonly string[]): string => (v.length === 0 ? "none" : v.join(", "));

/**
 * Render what the owner is being asked to approve.
 *
 * The body is shown VERBATIM, never as a digest -- the human is the entire security boundary for
 * this capability. `credentialHosts` names only HOSTS, never a credential value: the wire shape
 * this reads from (`ToolgenApprovalInput`) never carries a token, header value, or password, so
 * there is nothing here that could leak one even by omission of care.
 */
export function formatToolApprovalPrompt(p: ToolApprovalPrompt): string {
  return [
    `Register the generated tool "${p.toolName}"?`,
    "",
    `  description: ${p.description}`,
    "",
    p.body,
    "",
    `  hosts:            ${list(p.approvedHosts)}`,
    `  credential hosts: ${list(p.credentialHosts)}`,
  ].join("\n");
}

type ToolApprovalBroadcast = Partial<ToolApprovalPrompt> & { requestId?: string };

/**
 * Answer one `toolgen.approvalRequest` broadcast. Mirrors `exec.ts`'s `handleApprovalBroadcast`:
 * every field validated (including nested arrays) before use, a broadcast with no usable
 * `requestId` is ignored rather than answered, and only an explicit `true` approves.
 */
export async function handleToolApprovalBroadcast(
  params: unknown,
  ask: (message: string) => Promise<unknown>,
  respond: (requestId: string, approved: boolean) => Promise<unknown>,
): Promise<void> {
  const p = (params ?? {}) as ToolApprovalBroadcast;
  if (typeof p.requestId !== "string" || p.requestId === "") return;

  const strs = (v: unknown): string[] =>
    Array.isArray(v) && v.every((e) => typeof e === "string") ? [...(v as string[])] : [];

  const answer = await ask(
    formatToolApprovalPrompt({
      toolName: typeof p.toolName === "string" ? p.toolName : "unknown",
      description: typeof p.description === "string" ? p.description : "",
      body: typeof p.body === "string" ? p.body : "",
      approvedHosts: strs(p.approvedHosts),
      credentialHosts: strs(p.credentialHosts),
    }),
  );
  await respond(p.requestId, !isCancel(answer) && answer === true);
}

/** The slice of the IPC client `nimbus tool` uses. Narrow so a test can supply one. */
export interface ToolClient {
  onNotification(method: string, handler: (params: unknown) => unknown): void;
  call(method: string, params: unknown): Promise<unknown>;
}

/** Seams `runTool` needs from the outside world, matching `exec.ts`'s `RunExecDeps` split. */
export interface RunToolDeps {
  readonly runWithClient: <T>(fn: (c: ToolClient) => Promise<T>) => Promise<T>;
  readonly ask: (message: string) => Promise<unknown>;
  readonly sink: OutcomeSink;
  readonly setExitCode: (code: number) => void;
  /**
   * Whether stdin is an interactive TTY right now. Injected (rather than read from
   * `process.stdin.isTTY` inline) so the non-TTY refusal path is testable without spawning a real
   * detached process — `runTool` never calls `process.exit` itself, only `setExitCode`, so a test
   * can assert the refusal without killing the test runner.
   */
  readonly isInteractiveTty: () => boolean;
}

const defaultDeps: RunToolDeps = {
  runWithClient: (fn) =>
    withGatewayIpc(fn as never, undefined, {
      // The call can block on the owner answering the approval prompt.
      requestTimeoutMs: INTERACTIVE_RPC_TIMEOUT_MS,
    }) as never,
  ask: (message) => confirm({ message }),
  sink: {
    out: (s) => void process.stdout.write(s),
    err: (s) => void process.stderr.write(s),
  },
  setExitCode: (c) => {
    process.exitCode = c;
  },
  isInteractiveTty: () => process.stdin.isTTY === true,
};

/** Narrows an `unknown` IPC response to a keyed record. */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

async function runCreateCmd(
  parsed: Extract<ParsedToolArgs, { sub: "create" }>,
  deps: RunToolDeps,
): Promise<void> {
  // Refuse OUTRIGHT in a non-TTY, before any gateway connection is opened. `toolgen.create` is
  // LAN-forbidden and local-only (§ 9.2 of the design spec) -- there is no headless path, by
  // design, because a piped "y" must never be able to approve model-authored code that then runs
  // with the owner's credentials.
  if (!deps.isInteractiveTty()) {
    deps.sink.err("error: nimbus tool create needs an interactive TTY for owner approval.\n");
    deps.sink.err("There is no headless path: toolgen.create is LAN-forbidden and local-only.\n");
    deps.setExitCode(TOOL_EXIT_CODES.refused);
    return;
  }

  try {
    const outcome = await deps.runWithClient(async (c) => {
      // Registered before the call: the approval broadcast can share a socket chunk with the
      // response, matching `exec.ts`'s ordering.
      c.onNotification("toolgen.approvalRequest", (params: unknown) =>
        handleToolApprovalBroadcast(params, deps.ask, (requestId, approved) =>
          c.call("toolgen.approvalRespond", { requestId, approved }),
        ),
      );
      return (await c.call("toolgen.create", {
        sessionId: CLI_TOOLGEN_SESSION_ID,
        description: parsed.description,
        hosts: parsed.hosts,
        // Forward-compatible only: PR 1's `toolgen.create` RPC handler does not read a
        // `credentials` field yet, and `ToolgenGateDeps.bindCredentials` is an honest no-op until
        // drafting itself ships (the gate refuses before it would ever be consulted -- see
        // `DRAFT_NOT_IMPLEMENTED_MESSAGE` above). Sending the shape now means the wire contract's
        // eventual widening needs no CLI change; it changes nothing observable today.
        credentials: parsed.credentials,
      })) as ToolOutcomeShape;
    });

    renderToolOutcome(outcome, deps.sink);
    deps.setExitCode(exitCodeForTool(outcome));
  } catch (e) {
    deps.sink.err(`${e instanceof Error ? e.message : String(e)}\n`);
    deps.setExitCode(TOOL_EXIT_CODES.refused);
  }
}

/** One `toolgen.list` entry, mirroring the gateway's `toListEntry` wire shape. Never a credential. */
export interface ToolListEntry {
  readonly toolId: string;
  readonly toolName: string;
  readonly description: string;
  readonly approvedHosts: readonly string[];
  readonly credentialHosts: readonly string[];
  readonly approvedAt: number;
}

function toToolListEntry(raw: unknown): ToolListEntry | undefined {
  const r = asRecord(raw);
  const toolId = typeof r["toolId"] === "string" ? r["toolId"] : undefined;
  const toolName = typeof r["toolName"] === "string" ? r["toolName"] : undefined;
  const description = typeof r["description"] === "string" ? r["description"] : undefined;
  if (toolId === undefined || toolName === undefined || description === undefined) {
    return undefined;
  }
  const strs = (v: unknown): string[] =>
    Array.isArray(v) && v.every((e) => typeof e === "string") ? [...(v as string[])] : [];
  const approvedAt = typeof r["approvedAt"] === "number" ? r["approvedAt"] : 0;
  return {
    toolId,
    toolName,
    description,
    approvedHosts: strs(r["approvedHosts"]),
    credentialHosts: strs(r["credentialHosts"]),
    approvedAt,
  };
}

/**
 * Render `nimbus tool list`'s plain-text form. Never renders a credential VALUE — the wire shape
 * this reads from carries only host names for `credentialHosts`, never a token/header/password.
 */
export function renderToolList(entries: readonly ToolListEntry[]): string {
  if (entries.length === 0) {
    return "No active generated tools.\n";
  }
  return `${entries
    .map((e) => {
      const approvedAt = new Date(e.approvedAt);
      const when = Number.isFinite(approvedAt.getTime())
        ? approvedAt.toISOString()
        : `unknown (${String(e.approvedAt)})`;
      return (
        `  ${e.toolId}  ${e.toolName} — ${e.description}\n` +
        `      hosts: ${list(e.approvedHosts)}  credential hosts: ${list(e.credentialHosts)}  approved: ${when}`
      );
    })
    .join("\n")}\n`;
}

async function runListCmd(
  parsed: Extract<ParsedToolArgs, { sub: "list" }>,
  deps: RunToolDeps,
): Promise<void> {
  try {
    const entries = await deps.runWithClient(async (c) => {
      const res = await c.call("toolgen.list", { sessionId: CLI_TOOLGEN_SESSION_ID });
      const rawTools = asRecord(res)["tools"];
      if (!Array.isArray(rawTools)) return [] as ToolListEntry[];
      const out: ToolListEntry[] = [];
      for (const raw of rawTools) {
        const entry = toToolListEntry(raw);
        if (entry !== undefined) out.push(entry);
      }
      return out;
    });
    if (parsed.json) {
      deps.sink.out(`${JSON.stringify(entries, null, 2)}\n`);
    } else {
      deps.sink.out(renderToolList(entries));
    }
  } catch (e) {
    deps.sink.err(`${e instanceof Error ? e.message : String(e)}\n`);
    deps.setExitCode(TOOL_EXIT_CODES.refused);
  }
}

async function runRevokeCmd(
  parsed: Extract<ParsedToolArgs, { sub: "revoke" }>,
  deps: RunToolDeps,
): Promise<void> {
  try {
    // `toolgen.revoke` drops BOTH halves server-side -- `registry.revoke` (closes the live child)
    // AND `removeScript` (drops the approved body from disk) -- see `ipc/toolgen-rpc.ts`'s
    // `ToolgenRpcCtx.removeScript` doc comment. This command's job is only to call the one RPC that
    // does both; there is no separate "drop the script" step for the CLI to forget, because the CLI
    // never touches the gateway's config dir directly.
    await deps.runWithClient(async (c) => {
      await c.call("toolgen.revoke", { toolId: parsed.toolId });
    });
    deps.sink.out(`Revoked ${parsed.toolId}.\n`);
  } catch (e) {
    deps.sink.err(`${e instanceof Error ? e.message : String(e)}\n`);
    deps.setExitCode(TOOL_EXIT_CODES.refused);
  }
}

/**
 * `nimbus tool credential set` REFUSES a live tool, unconditionally and without contacting the
 * gateway. `toolgen.create`'s wire contract binds credentials at CREATE time, before the toolId
 * exists (so the approval prompt can name a real `credentialHosts` list) -- there is no gateway
 * method that adds one to an already-registered tool. Even if there were, doing so would change the
 * artifact the owner already approved (`credentialHosts` sits inside the hashed/signed object
 * precisely so a change invalidates the approval), which is the exact widening this whole gate
 * exists to prevent. The fix is always the same: revoke and recreate with the credential included.
 */
function runCredentialSetCmd(
  parsed: Extract<ParsedToolArgs, { sub: "credential-set" }>,
  deps: RunToolDeps,
): void {
  deps.sink.err("error: cannot add a credential to an already-approved (live) tool.\n");
  deps.sink.err(
    "       Credentials are bound only at create time: nimbus tool create --credential\n" +
      "       <host>=<token>. Revoke this tool and recreate it with the credential included:\n" +
      `       nimbus tool revoke ${parsed.toolId}\n`,
  );
  deps.setExitCode(TOOL_EXIT_CODES.refused);
}

export async function runTool(args: string[], deps: RunToolDeps = defaultDeps): Promise<void> {
  let parsed: ParsedToolArgs;
  try {
    parsed = parseToolArgs(args);
  } catch (e) {
    deps.sink.err(`${e instanceof Error ? e.message : String(e)}\n`);
    deps.setExitCode(TOOL_EXIT_CODES.refused);
    return;
  }

  switch (parsed.sub) {
    case "create":
      await runCreateCmd(parsed, deps);
      return;
    case "list":
      await runListCmd(parsed, deps);
      return;
    case "revoke":
      await runRevokeCmd(parsed, deps);
      return;
    case "credential-set":
      runCredentialSetCmd(parsed, deps);
      return;
  }
}
