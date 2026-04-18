import type { SyncContext } from "../sync/types.ts";
import { UnauthenticatedError } from "../sync/types.ts";
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

/**
 * Shared fetch helper for all Google API connectors.
 * Acquires the "google" rate-limit token, merges the Bearer header, and parses JSON.
 * Throws UnauthenticatedError on 401; uses formatGoogleHttpError for all other non-2xx responses.
 */
export async function fetchGoogleJson(
  ctx: SyncContext,
  token: string,
  url: string,
  service: string,
  init?: RequestInit,
): Promise<{ json: unknown; bytes: number }> {
  await ctx.rateLimiter.acquire("google");
  const merged = new Headers({ Authorization: `Bearer ${token}` });
  if (init?.headers !== undefined) {
    for (const [k, v] of new Headers(init.headers)) {
      merged.set(k, v);
    }
  }
  const res = await fetch(url, { ...init, headers: merged });
  const text = await res.text();
  const bytes = Buffer.byteLength(text, "utf8");
  if (!res.ok) {
    const msg = formatGoogleHttpError(res.status, text, service);
    if (res.status === 401) {
      throw new UnauthenticatedError(msg);
    }
    throw new Error(msg);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${service} sync failed: invalid JSON`);
  }
  return { json, bytes };
}
