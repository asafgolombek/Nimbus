import { asUnknownObjectRecord } from "./json-unknown.ts";

/** Best-effort summary from Google API JSON error bodies (never log raw tokens). */
export function formatGoogleHttpError(status: number, bodyText: string, service: string): string {
  const base = `${service} sync failed: ${String(status)}`;
  const trimmed = bodyText.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    if (trimmed === "") {
      return base;
    }
    const oneLine = trimmed.replace(/\s+/g, " ");
    const max = 160;
    return `${base} — ${oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine}`;
  }
  const top = asUnknownObjectRecord(parsed);
  const errObj = top["error"];
  if (typeof errObj !== "object" || errObj === null || Array.isArray(errObj)) {
    const oneLine = trimmed.replace(/\s+/g, " ");
    const max = 160;
    return oneLine !== ""
      ? `${base} — ${oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine}`
      : base;
  }
  const er = errObj as Record<string, unknown>;
  const msg = er["message"];
  if (typeof msg === "string" && msg.trim() !== "") {
    const oneLine = msg.trim().replace(/\s+/g, " ");
    const max = 240;
    return `${base} — ${oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine}`;
  }
  return base;
}
