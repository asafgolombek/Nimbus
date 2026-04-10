import { stripTrailingSlashes } from "../string/strip-trailing-slashes.ts";

export { asRecord, stringField } from "./unknown-record.ts";

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
