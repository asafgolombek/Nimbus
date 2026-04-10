import type { SyncContext } from "../sync/types.ts";
import { asUnknownObjectRecord } from "./json-unknown.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";

export type MicrosoftGraphDeltaCursorV1 = { v: 1; nextUrl: string | null };

export function encodeMicrosoftGraphDeltaCursor(
  prefix: string,
  cursor: MicrosoftGraphDeltaCursorV1,
): string {
  return encodeNimbusJsonCursor(prefix, cursor);
}

export function decodeMicrosoftGraphDeltaCursor(
  raw: string,
  prefix: string,
): MicrosoftGraphDeltaCursorV1 | undefined {
  const o = decodeNimbusJsonCursorPayload(raw, prefix);
  if (o === null || typeof o !== "object" || Array.isArray(o)) {
    return undefined;
  }
  const r = o as Record<string, unknown>;
  if (r["v"] !== 1) {
    return undefined;
  }
  const nextUrl = r["nextUrl"];
  if (nextUrl !== null && typeof nextUrl !== "string") {
    return undefined;
  }
  return { v: 1, nextUrl };
}

export type ODataDeltaPage = {
  value?: unknown[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

export function parseODataDeltaPage(json: unknown): ODataDeltaPage {
  const o = asUnknownObjectRecord(json);
  const value = o["value"];
  const nextLink = o["@odata.nextLink"];
  const deltaLink = o["@odata.deltaLink"];
  const out: ODataDeltaPage = {};
  if (Array.isArray(value)) {
    out.value = value;
  }
  if (typeof nextLink === "string") {
    out["@odata.nextLink"] = nextLink;
  }
  if (typeof deltaLink === "string") {
    out["@odata.deltaLink"] = deltaLink;
  }
  return out;
}

export function modifiedMsFromIso(iso: string | undefined, fallback: number): number {
  if (typeof iso !== "string" || iso === "") {
    return fallback;
  }
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
}

export function nextCursorFromODataDeltaLinks(
  page: ODataDeltaPage,
  encode: (c: MicrosoftGraphDeltaCursorV1) => string,
): { stored: string | null; hasMore: boolean } {
  const nextLink = page["@odata.nextLink"];
  const deltaLink = page["@odata.deltaLink"];
  if (typeof nextLink === "string" && nextLink !== "") {
    return { stored: encode({ v: 1, nextUrl: nextLink }), hasMore: true };
  }
  if (typeof deltaLink === "string" && deltaLink !== "") {
    return { stored: encode({ v: 1, nextUrl: deltaLink }), hasMore: false };
  }
  return { stored: null, hasMore: false };
}

export async function fetchMicrosoftGraphJson(
  ctx: SyncContext,
  token: string,
  nextUrl: string | null,
  initialUrl: string,
  errorLabel: string,
): Promise<{ json: unknown; bytes: number }> {
  await ctx.rateLimiter.acquire("microsoft");
  const url = nextUrl !== null && nextUrl !== "" ? nextUrl : initialUrl;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  const bytes = Buffer.byteLength(text, "utf8");
  if (!res.ok) {
    throw new Error(`${errorLabel} sync failed: ${String(res.status)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${errorLabel} sync failed: invalid JSON`);
  }
  return { json, bytes };
}
