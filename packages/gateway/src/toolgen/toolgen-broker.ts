import type { Database } from "bun:sqlite";
import { recordToolEgress } from "../egress/tool-egress.ts";
import {
  assertAllowedScheme,
  isForbiddenAddress,
  STRIPPED_REQUEST_HEADERS,
} from "./toolgen-address-guard.ts";
import { type ToolCredentialBinding, ToolgenError } from "./toolgen-types.ts";

/**
 * The broker runs INSIDE the gateway, so an unbounded response is an OOM in the gateway rather than
 * in the tool. Same class as I32: a bounds limit whose loss is confined to the attempted operation.
 */
export const MAX_BROKERED_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface BrokeredFetchResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface ToolgenBrokerDeps {
  readonly db: Database;
  readonly now: () => number;
  readonly maxRequestsPerTool: number;
  readonly requestTimeoutMs: number;
  readonly resolveHost: (host: string) => Promise<readonly string[]>;
  readonly readCredential: (toolId: string, host: string) => Promise<ToolCredentialBinding | null>;
  readonly approvedHostsFor: (toolId: string) => readonly string[];
  readonly doFetch: (url: string, init: RequestInit) => Promise<Response>;
}

interface ParsedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string | undefined;
}

function parseParams(params: unknown): ParsedRequest {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new ToolgenError("ERR_TOOLGEN_BAD_REQUEST", "fetch params must be an object");
  }
  const o = params as Record<string, unknown>;
  if (typeof o["url"] !== "string") {
    throw new ToolgenError("ERR_TOOLGEN_BAD_REQUEST", "fetch params.url must be a string");
  }
  const method = typeof o["method"] === "string" ? o["method"].toUpperCase() : "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) {
    throw new ToolgenError("ERR_TOOLGEN_BAD_REQUEST", `unsupported method: ${method}`);
  }
  const headers: Record<string, string> = {};
  const rawHeaders = o["headers"];
  if (rawHeaders !== undefined && rawHeaders !== null) {
    if (typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
      throw new ToolgenError("ERR_TOOLGEN_BAD_REQUEST", "fetch params.headers must be an object");
    }
    for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
      // Silently DROPPED rather than refused: a stripped auth header is the design working, not a
      // caller error, and refusing would tell a hostile body which header names are interesting.
      if (typeof v === "string" && !STRIPPED_REQUEST_HEADERS.has(k.toLowerCase())) headers[k] = v;
    }
  }
  const body = typeof o["body"] === "string" ? o["body"] : undefined;
  return { url: o["url"], method, headers, ...(body === undefined ? {} : { body }) };
}

function applyCredential(headers: Record<string, string>, binding: ToolCredentialBinding): void {
  switch (binding.type) {
    case "bearer":
      headers["Authorization"] = `Bearer ${binding.token}`;
      break;
    case "header":
      headers[binding.headerName] = binding.value;
      break;
    case "basic":
      headers["Authorization"] =
        `Basic ${Buffer.from(`${binding.username}:${binding.password}`).toString("base64")}`;
      break;
  }
}

/**
 * The ONLY site that performs a generated tool's outbound request (invariant I39).
 *
 * Order is load-bearing: parse, then budget, then scheme, then approved-host match, then RESOLVE,
 * then the address check, then attach a credential, then LEDGER, then fetch. Every refusal past
 * URL parsing appends a `blocked` row before throwing, so a refused destination is as visible in
 * `nimbus prove` as a successful one — a tool probing for reachable internal hosts leaves a trail
 * rather than silence. (A malformed URL itself appends nothing — the host isn't known yet, so
 * there is no destination to record.) The authorized row is appended BEFORE the fetch, so an
 * append failure aborts the request and a zero-row window means nothing left the machine.
 *
 * Every check above runs against the INITIAL url only — so the fetch itself is issued with
 * `redirect: "error"`, refusing rather than following any redirect the destination returns. A
 * followed hop would reach a host, scheme or resolved address none of those checks ever saw,
 * silently re-entering the network outside every guarantee this class makes. A redirect refusal
 * appends its OWN `blocked` row (`ERR_TOOLGEN_REDIRECT_REFUSED`), on top of the `authorized` row
 * already appended for the attempt itself — two rows for one call, deliberately: the first records
 * that a real request to the approved host was authorized and attempted, the second that it was
 * then cut short before any response body reached the tool.
 */
export class ToolgenBroker {
  readonly #deps: ToolgenBrokerDeps;
  readonly #spent = new Map<string, number>();

  constructor(deps: ToolgenBrokerDeps) {
    this.#deps = deps;
  }

  async handleFetch(toolId: string, params: unknown): Promise<BrokeredFetchResponse> {
    const req = parseParams(params);
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      // No destination is known yet, so no row is appended — see the class docstring.
      throw new ToolgenError(
        "ERR_TOOLGEN_BAD_REQUEST",
        `fetch params.url is not a valid URL: ${req.url}`,
      );
    }
    const host = url.hostname.toLowerCase();

    const ledger = (resultStatus: "authorized" | "blocked"): void => {
      recordToolEgress(this.#deps.db, {
        toolId,
        destination: host,
        method: "tool.fetch",
        resultStatus,
        now: this.#deps.now(),
        requestMethod: req.method,
        requestBytes: req.body === undefined ? 0 : Buffer.byteLength(req.body),
      });
    };
    const refuse = (code: string, message: string): never => {
      ledger("blocked");
      throw new ToolgenError(code, message);
    };

    const spent = this.#spent.get(toolId) ?? 0;
    if (spent >= this.#deps.maxRequestsPerTool) {
      return refuse(
        "ERR_TOOLGEN_BUDGET_EXHAUSTED",
        `tool ${toolId} has spent its ${this.#deps.maxRequestsPerTool}-request budget`,
      );
    }

    try {
      assertAllowedScheme(url);
    } catch (err) {
      return refuse("ERR_TOOLGEN_HOST_NOT_ALLOWED", (err as Error).message);
    }

    // Exact match only. A suffix match would let `evil-api.example.com` satisfy `api.example.com`.
    if (!this.#deps.approvedHostsFor(toolId).some((h) => h.toLowerCase() === host)) {
      return refuse("ERR_TOOLGEN_HOST_NOT_ALLOWED", `host not on the approved envelope: ${host}`);
    }

    // Validate EVERY address the name answers with, not just the first: a name returning one
    // private record among several public ones must be refused outright.
    //
    // STATED RESIDUAL — this is check-then-connect, not connect-to-checked. `doFetch` is issued
    // against the hostname and the runtime resolves again independently; Bun's fetch exposes no
    // connection-pinning or custom-resolver hook. Someone controlling the DNS for a host the owner
    // ALREADY approved can answer this lookup with a public address and the connection's lookup
    // with loopback. Validating all records narrows that; it does not close it. Closing it needs a
    // custom HTTP client that connects to a pinned address. See the design spec § 6.2.1.
    //
    // The resolve is inside the try because a REJECTION here (ENOTFOUND, offline, a DNS timeout)
    // would otherwise escape `handleFetch` with no row appended — and a resolver lookup is itself
    // traffic the tool caused, so it belongs in the ledger like any other refused destination.
    let addresses: readonly string[];
    try {
      addresses = await this.#deps.resolveHost(host);
    } catch (err) {
      return refuse(
        "ERR_TOOLGEN_HOST_NOT_ALLOWED",
        `failed to resolve ${host}: ${(err as Error).message}`,
      );
    }
    if (addresses.length === 0) {
      return refuse("ERR_TOOLGEN_HOST_NOT_ALLOWED", `${host} resolved to no addresses`);
    }
    const forbidden = addresses.find((a) => isForbiddenAddress(a));
    if (forbidden !== undefined) {
      return refuse(
        "ERR_TOOLGEN_HOST_NOT_ALLOWED",
        `${host} resolves to a forbidden address (${forbidden})`,
      );
    }

    const headers = { ...req.headers };
    const binding = await this.#deps.readCredential(toolId, host);
    if (binding !== null) applyCredential(headers, binding);

    // Ledger BEFORE the request. A throw here aborts without fetching — fail-closed.
    ledger("authorized");
    this.#spent.set(toolId, spent + 1);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#deps.requestTimeoutMs);
    try {
      let res: Response;
      try {
        res = await this.#deps.doFetch(req.url, {
          method: req.method,
          headers,
          signal: controller.signal,
          // Refuse a redirect rather than follow it. Set HERE, in the broker, not in the
          // `doFetch` closure a caller supplies — the guarantee belongs with the checks above,
          // which all ran against the url ABOVE this call, never with one wiring site a second
          // caller could build without it. See I39 § 6.2.1 and `isUnexpectedRedirectError`.
          redirect: "error",
          ...(req.body === undefined ? {} : { body: req.body }),
        });
      } catch (err) {
        if (isUnexpectedRedirectError(err)) {
          return refuse(
            "ERR_TOOLGEN_REDIRECT_REFUSED",
            `${host} responded with a redirect, which is refused rather than followed — a hop is ` +
              `not re-checked against the approved envelope`,
          );
        }
        throw err;
      }
      const bytes = await readBoundedBody(res, controller);
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        outHeaders[k] = v;
      });
      return {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders,
        body: new TextDecoder().decode(bytes),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * `redirect: "error"` (set unconditionally by `handleFetch`, below) makes Bun's `fetch` REJECT
 * rather than follow — every check above (scheme, approved-host, resolved-address) ran on the
 * INITIAL url only, so a followed hop would reach a host, scheme or address none of them ever saw.
 * Bun surfaces this as a plain `Error` carrying `code: "UnexpectedRedirect"` (probed against
 * 1.3.14; see the design spec § 6.2.1) — narrowed here rather than matched on `.message`, which is
 * not a stable contract. **Stated bound:** this is a Bun-runtime-specific error shape, not a
 * WHATWG-standardised one; a future Bun version changing it would make this check silently stop
 * firing, and a redirect would then propagate as an ordinary unhandled fetch failure instead of a
 * ledgered refusal — narrower than a false negative that lets the redirect through, but still a
 * gap worth a comment. Anything else thrown by `doFetch` itself (a genuine network failure, the
 * request timeout) is NOT this and is left to propagate exactly as before.
 */
function isUnexpectedRedirectError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { readonly code?: unknown }).code === "UnexpectedRedirect"
  );
}

/**
 * Reads the response body chunk by chunk and ABORTS the underlying request as soon as the running
 * total crosses `MAX_BROKERED_RESPONSE_BYTES`, rather than buffering the whole body with
 * `res.arrayBuffer()` and discarding it after the fact — the broker runs inside the gateway, so a
 * hostile or oversized upstream response should never sit fully in memory even transiently.
 */
async function readBoundedBody(res: Response, controller: AbortController): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BROKERED_RESPONSE_BYTES) {
        controller.abort();
        throw new ToolgenError(
          "ERR_TOOLGEN_RESPONSE_TOO_LARGE",
          `response exceeded ${MAX_BROKERED_RESPONSE_BYTES} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
