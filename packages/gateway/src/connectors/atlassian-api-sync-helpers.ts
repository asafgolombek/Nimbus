import { stripTrailingSlashes } from "../string/strip-trailing-slashes.ts";

export function normalizeAtlassianSiteBaseUrl(raw: string): string {
  const t = stripTrailingSlashes(raw);
  if (t === "") {
    return "";
  }
  return t.startsWith("http") ? t : `https://${t}`;
}

export function basicAuthHeader(email: string, token: string): string {
  const cred = `${email}:${token}`;
  const b64 = Buffer.from(cred, "utf8").toString("base64");
  return `Basic ${b64}`;
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

export function stringField(r: Record<string, unknown>, key: string): string | undefined {
  const v = r[key];
  return typeof v === "string" ? v : undefined;
}
