import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";

export type WatermarkCursorV1 = { v: 1; watermark: string | null };

export function encodeWatermarkCursorV1(prefix: string, c: WatermarkCursorV1): string {
  return encodeNimbusJsonCursor(prefix, c);
}

export function decodeWatermarkCursorV1(
  raw: string | null,
  prefix: string,
): WatermarkCursorV1 | null {
  if (raw === null || raw === "") {
    return null;
  }
  const parsed = decodeNimbusJsonCursorPayload(raw, prefix);
  if (parsed === undefined) {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  if (rec["v"] !== 1) {
    return null;
  }
  const w = rec["watermark"];
  if (w !== null && w !== undefined && typeof w !== "string") {
    return null;
  }
  return { v: 1, watermark: typeof w === "string" ? w : null };
}
