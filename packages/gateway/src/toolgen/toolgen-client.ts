import type { ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { wrapServerSpec } from "../connectors/lazy-mesh/wrap-server-spec.ts";
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
import { policyFromManifest } from "../platform/sandbox/sandbox-policy.ts";
import type { SandboxRunner } from "../platform/sandbox/sandbox-runner.ts";
import type { ToolgenBroker } from "./toolgen-broker.ts";
import { BROKERED_FETCH_METHOD, type ToolgenEnvelope } from "./toolgen-types.ts";

/** How long a `close()` waits for a graceful exit before escalating to SIGKILL. */
const CLOSE_ESCALATION_MS = 2_000;

export interface ToolSpawnSpec {
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
}

/**
 * How a generated tool is launched.
 *
 * The script is IMPORTED via a tiny `-e` stub, never named as bun's entry point and never passed
 * inline. Both alternatives are measured dead ends recorded in `exec/exec-runtimes.ts`: naming the
 * file as the entry point (`bun run <path>` / `bun <path>`) fails under the Windows AppContainer
 * with `CouldntReadCurrentDirectory` — its startup path for a file entry point touches something
 * the sandbox denies, where `-e` does not — and `import()` of a granted file works there. Passing
 * the body inline is bounded by the Windows helper's `wchar_t cmdline[32768]`, and a generated tool
 * is a whole module, not a snippet. The `-e` import stub satisfies both constraints at once.
 *
 * Goes through `wrapServerSpec`, so I15/D10 applies to a generated tool exactly as to a connector:
 * the resulting command/args re-launch this same binary in the `__nimbus-sandbox` role, and the
 * sandbox policy travels with it via `NIMBUS_SANDBOX_POLICY_JSON`/`NIMBUS_SANDBOX_CWD`.
 */
export function buildToolSpawnSpec(envelope: ToolgenEnvelope, cwd: string): ToolSpawnSpec {
  const href = pathToFileURL(envelope.scriptPath).href;
  const spec = wrapServerSpec(
    {
      command: process.execPath,
      args: ["-e", `await import(${JSON.stringify(href)});`],
      env: extensionProcessEnv({}),
    },
    envelope.artifact.manifest,
    cwd,
  );
  return { command: spec.command, args: spec.args, env: spec.env as Record<string, string> };
}

export interface GeneratedToolHandle {
  describe(): Promise<{ name: string; description: string }>;
  call(args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * The minimal shape `wireToolProtocol` needs from a spawned child: write a line to its stdin,
 * subscribe to raw stdout chunks, and kill it. Factored out (rather than typed directly as Node's
 * `ChildProcess`) so the SAME protocol logic that `spawnGeneratedTool` drives over a
 * `SandboxRunner`-spawned child can be exercised in a test against a child spawned some other way,
 * without reimplementing the framing twice.
 */
export interface ToolChildIo {
  writeLine(line: string): void;
  onStdoutData(cb: (chunk: Uint8Array) => void): void;
  kill(): void;
  /** Resolves once the child has actually exited. */
  waitExit(): Promise<void>;
}

function childIoFromChildProcess(child: ChildProcess): ToolChildIo {
  return {
    writeLine: (line) => {
      child.stdin?.write(`${line}\n`);
    },
    onStdoutData: (cb) => {
      child.stdout?.on("data", (chunk: Buffer) => cb(chunk));
    },
    kill: () => {
      child.kill();
    },
    waitExit: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
      }),
  };
}

interface InboundMessage {
  readonly id: string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

/** Parse one line of the wire protocol. Never throws; an unparseable line is simply dropped. */
function parseInboundLine(line: string): InboundMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o["id"] !== "string") return null;
  const out: {
    id: string;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
  } = { id: o["id"] };
  if (typeof o["method"] === "string") out.method = o["method"];
  if ("params" in o) out.params = o["params"];
  if ("result" in o) out.result = o["result"];
  if ("error" in o) out.error = o["error"];
  return out;
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Drive the hand-rolled line-delimited JSON protocol a generated tool speaks, over an already
 * spawned child.
 *
 * Deliberately NOT `@mastra/mcp`, which holds its SDK client PRIVATE and exposes only
 * `setElicitationRequestHandler` — there is no public API there for a custom server->client
 * handler. And deliberately not the official MCP SDK either, on the child side: the emitted script
 * (`emitToolScript`) imports NOTHING, because it runs from a directory with no `node_modules` and a
 * sandbox grant that deliberately does not include one.
 *
 * So both ends speak one protocol: `{id, method, params}` in, `{id, result}` or `{id, error}` out.
 * A message whose `method` equals `BROKERED_FETCH_METHOD` is the tool asking the gateway to make a
 * request — and is the ONLY route out of that process. Named via the constant rather than quoted,
 * so D29(a)'s confinement scan stays a one-file rule. Every other inbound line with no `method` is
 * a reply to one of OUR outbound requests (`describe`/`call`), matched by `id`.
 *
 * Messages crossing this boundary are `unknown` until narrowed here — a compromised or buggy
 * generated tool is exactly the untrusted-input case non-negotiable 7 exists for.
 */
export function wireToolProtocol(
  io: ToolChildIo,
  envelope: ToolgenEnvelope,
  broker: ToolgenBroker,
): GeneratedToolHandle {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let buf = "";
  let closed = false;

  const send = (msg: Record<string, unknown>): void => {
    io.writeLine(JSON.stringify(msg));
  };

  const failAllPending = (reason: string): void => {
    for (const p of pending.values()) p.reject(new Error(reason));
    pending.clear();
  };

  io.onStdoutData((chunk) => {
    buf += Buffer.from(chunk).toString("utf8");
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (line.trim() === "") continue;
      const msg = parseInboundLine(line);
      if (msg === null) continue;

      // The tool asking US to make a request — the only route out of that process.
      if (msg.method === BROKERED_FETCH_METHOD) {
        const id = msg.id;
        void broker
          .handleFetch(envelope.artifact.toolId, msg.params)
          .then((result) => send({ id, result }))
          .catch((err: unknown) => send({ id, error: errorMessageOf(err) }));
        continue;
      }

      // Any other message carrying a `method` is an inbound request we do not recognize —
      // never treated as a reply, so it cannot spuriously resolve a pending call sharing its id.
      if (msg.method !== undefined) continue;

      // A reply to one of OUR requests.
      const p = pending.get(msg.id);
      if (p === undefined) continue;
      pending.delete(msg.id);
      if (msg.error !== undefined) {
        p.reject(new Error(typeof msg.error === "string" ? msg.error : JSON.stringify(msg.error)));
      } else {
        p.resolve(msg.result);
      }
    }
  });

  const request = (method: string, params: unknown): Promise<unknown> => {
    if (closed) return Promise.reject(new Error("generated tool handle is closed"));
    const id = `g${String(++seq)}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });
  };

  return {
    describe: async () => {
      const r = await request("describe", {});
      const o = (r !== null && typeof r === "object" && !Array.isArray(r) ? r : {}) as Record<
        string,
        unknown
      >;
      return {
        name: typeof o["name"] === "string" ? o["name"] : envelope.artifact.toolName,
        description: typeof o["description"] === "string" ? o["description"] : "",
      };
    },
    call: async (args) => await request("call", args),
    close: async () => {
      if (closed) return;
      closed = true;
      failAllPending("generated tool handle was closed");
      io.kill();
      // A generated tool has no signal-handling logic of its own (`emitToolScript` installs none),
      // so SIGTERM is expected to end it promptly. This bound exists only so a hung child cannot
      // make `close()` itself hang forever — and the fallback timer is cleared on the fast path so
      // it never outlives `close()` itself and dangles in a caller's (e.g. a test's) event loop.
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, CLOSE_ESCALATION_MS);
        void io.waitExit().then(finish);
      });
    },
  };
}

/**
 * Spawn a generated tool and serve its brokered-fetch requests until closed.
 *
 * Scope bound (matching I33): the caller supplies the `SandboxRunner`, so confinement rides
 * whatever policy `runner.spawn` enforces for `policyFromManifest(envelope.artifact.manifest)` —
 * this function performs no confinement decision of its own.
 */
export async function spawnGeneratedTool(
  envelope: ToolgenEnvelope,
  broker: ToolgenBroker,
  cwd: string,
  runner: SandboxRunner,
): Promise<GeneratedToolHandle> {
  const spec = buildToolSpawnSpec(envelope, cwd);
  const child = runner.spawn(spec.command, spec.args, {
    policy: policyFromManifest(envelope.artifact.manifest),
    env: spec.env,
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return wireToolProtocol(childIoFromChildProcess(child), envelope, broker);
}
