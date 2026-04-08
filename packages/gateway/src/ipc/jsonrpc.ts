/**
 * JSON-RPC 2.0 over newline-delimited JSON (one object per line).
 * @see dev-plan-q1.md §3.1
 */

export const IPC_MAX_LINE_BYTES = 1024 * 1024;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: JsonRpcId;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorBody;
}

export type JsonRpcOutbound = JsonRpcSuccess | JsonRpcErrorResponse | JsonRpcNotification;

export function encodeLine(message: JsonRpcOutbound): string {
  return `${JSON.stringify(message)}\n`;
}

export class JsonRpcParseError extends Error {
  override readonly name = "JsonRpcParseError";
  constructor(message: string) {
    super(message);
  }
}

function byteLengthUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Incrementally buffers UTF-8 chunks and emits complete non-empty lines (trimmed of trailing \r).
 */
export class NdjsonLineReader {
  private decoder = new TextDecoder("utf-8", { fatal: false });
  private pending = "";

  push(chunk: Uint8Array): string[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    const out: string[] = [];
    while (true) {
      const nl = this.pending.indexOf("\n");
      if (nl < 0) {
        break;
      }
      const line = this.pending.slice(0, nl);
      this.pending = this.pending.slice(nl + 1);
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (trimmed.length === 0) {
        continue;
      }
      if (byteLengthUtf8(trimmed) > IPC_MAX_LINE_BYTES) {
        throw new JsonRpcParseError("Message exceeds 1MB line limit");
      }
      out.push(trimmed);
    }
    if (byteLengthUtf8(this.pending) > IPC_MAX_LINE_BYTES) {
      throw new JsonRpcParseError("Message exceeds 1MB line limit");
    }
    return out;
  }

  flush(): string[] {
    const rest = this.pending + this.decoder.decode();
    this.pending = "";
    if (rest.length === 0) {
      return [];
    }
    if (byteLengthUtf8(rest) > IPC_MAX_LINE_BYTES) {
      throw new JsonRpcParseError("Message exceeds 1MB line limit");
    }
    return [rest.endsWith("\r") ? rest.slice(0, -1) : rest];
  }
}

export function parseJsonRpcLine(line: string): JsonRpcRequest | JsonRpcNotification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new JsonRpcParseError("Invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new JsonRpcParseError("JSON-RPC payload must be an object");
  }
  const o = parsed as Record<string, unknown>;
  if (o["jsonrpc"] !== "2.0") {
    throw new JsonRpcParseError('Invalid or missing jsonrpc "2.0" field');
  }
  if (typeof o["method"] !== "string" || o["method"].length === 0) {
    throw new JsonRpcParseError("Invalid or missing method");
  }
  const hasId = Object.hasOwn(o, "id");
  if (hasId) {
    const id = o["id"];
    if (id !== null && typeof id !== "string" && typeof id !== "number") {
      throw new JsonRpcParseError("Invalid id");
    }
    return {
      jsonrpc: "2.0",
      method: o["method"],
      ...(Object.hasOwn(o, "params") ? { params: o["params"] } : {}),
      id: id as JsonRpcId,
    };
  }
  return {
    jsonrpc: "2.0",
    method: o["method"],
    ...(Object.hasOwn(o, "params") ? { params: o["params"] } : {}),
  };
}

export function isRequest(msg: JsonRpcRequest | JsonRpcNotification): msg is JsonRpcRequest {
  return Object.hasOwn(msg, "id");
}

export function errorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}
