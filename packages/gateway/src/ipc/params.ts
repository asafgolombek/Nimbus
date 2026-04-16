import type { ZodType } from "zod";

/** Strict JSON-RPC params validation for gateway IPC handlers. */
export function parseParams<T>(raw: unknown, schema: ZodType<T>): T {
  return schema.parse(raw);
}
