import { ToolgenError } from "./toolgen-types.ts";

/**
 * Headers a generated tool may NOT set. The broker attaches credentials itself (spec § 6.3); a tool
 * that could set its own `Authorization` could attach a secret obtained some other way to a host of
 * its choosing. `Cookie` is here for the same reason — it is an auth header wearing a different name.
 *
 * Lowercase, because header names are case-insensitive and the caller lowercases before lookup.
 */
export const STRIPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
]);

/**
 * `https:` only in PR 1. Plain `http:` is refused rather than warned about: a generated tool's
 * traffic carries an owner's credential, and the local-dev escape hatch that would relax this is a
 * deliberate deferral (spec § 13), not an oversight.
 */
export function assertAllowedScheme(url: URL): void {
  if (url.protocol !== "https:") {
    throw new ToolgenError(
      "ERR_TOOLGEN_HOST_NOT_ALLOWED",
      `refusing ${url.protocol} — generated tools may reach https only`,
    );
  }
}

function parseIpv4(ip: string): readonly number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

/**
 * Addresses the broker refuses EVEN WHEN THE OWNER APPROVED THE HOST — the one place this design
 * overrides an owner approval, and deliberately.
 *
 * Spec § 4.3's whole argument is that the sandboxed tool cannot reach the Gateway's own IPC socket
 * or `127.0.0.1` HTTP API (the I13 write surface, the `agents` and `resolve` token scopes). A
 * broker that proxied it there would hand back exactly the reach the empty network set took away.
 * I33 names the same target for the same reason.
 *
 * Called on the RESOLVED address, never the hostname: a name that resolves to `127.0.0.1` defeats
 * a hostname check completely.
 */
export function isForbiddenAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4 !== null) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 127 || a === 0) return true; // loopback + unspecified
    if (a === 10) return true; // RFC 1918
    if (a === 192 && b === 168) return true; // RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918 — 172.16/12, NOT all of 172
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 cloud metadata
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fe80:")) return true; // link-local
  if (/^f[cd]/.test(v6)) return true; // unique-local fc00::/7
  // An IPv4-mapped IPv6 address (::ffff:127.0.0.1) must be judged on its embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped?.[1] !== undefined) return isForbiddenAddress(mapped[1]);
  return false;
}
