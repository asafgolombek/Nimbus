/** Max bytes per NDJSON line (UTF-8), aligned with IPC protocol limits. */
export const IPC_MAX_LINE_BYTES = 1024 * 1024;

function byteLengthUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

export type NdjsonLineReaderOptions = {
  /** When set, oversized lines throw this type instead of `Error`. */
  lineLimitError?: new (
    message: string,
  ) => Error;
};

/**
 * Buffers UTF-8 chunks and emits complete non-empty lines (trailing `\r` stripped).
 * Shared by Gateway JSON-RPC and the CLI IPC client.
 */
export class NdjsonLineReader {
  private readonly lineLimitCtor: new (
    message: string,
  ) => Error;
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  private pending = "";

  constructor(opts: NdjsonLineReaderOptions = {}) {
    this.lineLimitCtor = opts.lineLimitError ?? Error;
  }

  private throwLineTooLong(message: string): never {
    throw new this.lineLimitCtor(message);
  }

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
        this.throwLineTooLong("Message exceeds 1MB line limit");
      }
      out.push(trimmed);
    }
    if (byteLengthUtf8(this.pending) > IPC_MAX_LINE_BYTES) {
      this.throwLineTooLong("Message exceeds 1MB line limit");
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
      this.throwLineTooLong("Message exceeds 1MB line limit");
    }
    return [rest.endsWith("\r") ? rest.slice(0, -1) : rest];
  }
}
