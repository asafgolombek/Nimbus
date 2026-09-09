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
 * Parse an IPv6 address string into an array of 8 hextets (16-bit values).
 * Handles `::` compression, full 8-group form, and trailing dotted-quad for IPv4-mapped/compatible.
 * Returns null if the address is malformed.
 */
function parseIpv6(
  ip: string,
): readonly [number, number, number, number, number, number, number, number] | null {
  // Strip surrounding brackets
  let addr = ip.toLowerCase().replace(/^\[|\]$/g, "");

  // Handle IPv4-mapped (::ffff:x.x.x.x) and IPv4-compatible (::x.x.x.x) forms
  let groups = addr.split(":");
  const lastGroup = groups[groups.length - 1];
  if (lastGroup?.includes(".")) {
    // Parse the dotted-quad
    const v4 = parseIpv4(lastGroup);
    if (v4 === null) return null;
    const [a, b, c, d] = v4 as [number, number, number, number];
    // Replace the last group with its hex representation
    const hexHigh = ((a << 8) | b).toString(16);
    const hexLow = ((c << 8) | d).toString(16);
    groups[groups.length - 1] = hexHigh;
    groups.push(hexLow);
    addr = groups.join(":");
    groups = addr.split(":");
  }

  // Check for more than one `::`
  const doubleColonCount = (addr.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;

  let hextets: number[] = [];

  if (addr.includes("::")) {
    // Handle `::` compression
    const [before, after] = addr.split("::");
    const beforeGroups = before ? before.split(":") : [];
    const afterGroups = after ? after.split(":") : [];

    // Validate before and after groups
    for (const g of [...beforeGroups, ...afterGroups]) {
      if (g && (!/^[0-9a-f]{1,4}$/.test(g) || Number.parseInt(g, 16) > 0xffff)) {
        return null;
      }
    }

    const beforeHex = beforeGroups.map((g) => Number.parseInt(g, 16));
    const afterHex = afterGroups.map((g) => Number.parseInt(g, 16));
    const totalGroups = beforeHex.length + afterHex.length;

    if (totalGroups >= 8) return null; // Can't have 8+ groups with compression

    const zerosPadding = 8 - totalGroups;
    hextets = [...beforeHex, ...Array(zerosPadding).fill(0), ...afterHex];
  } else {
    // Full 8-group form
    if (groups.length !== 8) return null;

    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g) || Number.parseInt(g, 16) > 0xffff) {
        return null;
      }
    }

    hextets = groups.map((g) => Number.parseInt(g, 16));
  }

  if (hextets.length !== 8) return null;
  return hextets as [number, number, number, number, number, number, number, number];
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

  const h = parseIpv6(ip);
  if (h === null) return false; // Unparseable string is not an address we can judge

  // All 8 zero → unspecified `::`
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0 &&
    h[6] === 0 &&
    h[7] === 0
  ) {
    return true;
  }

  // h[0..6] zero and h[7] === 1 → loopback `::1`
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0 &&
    h[6] === 0 &&
    h[7] === 1
  ) {
    return true;
  }

  // (h[0] & 0xffc0) === 0xfe80 → link-local fe80::/10 (fe80–febf)
  if ((h[0] & 0xffc0) === 0xfe80) {
    return true;
  }

  // (h[0] & 0xfe00) === 0xfc00 → unique-local fc00::/7
  if ((h[0] & 0xfe00) === 0xfc00) {
    return true;
  }

  // h[0..4] zero and h[5] === 0xffff → IPv4-mapped ::ffff:x.x.x.x
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const a = (h[6] >> 8) & 0xff;
    const b = h[6] & 0xff;
    const c = (h[7] >> 8) & 0xff;
    const d = h[7] & 0xff;
    return isForbiddenAddress(`${a}.${b}.${c}.${d}`);
  }

  // h[0..5] all zero and not already matched → IPv4-compatible ::x.x.x.x
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    const a = (h[6] >> 8) & 0xff;
    const b = h[6] & 0xff;
    const c = (h[7] >> 8) & 0xff;
    const d = h[7] & 0xff;
    return isForbiddenAddress(`${a}.${b}.${c}.${d}`);
  }

  return false;
}
