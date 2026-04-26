import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time SHA-256 hex string equality.
 *
 * S6-F10 / S7-F8 — replaces direct `!==` comparison of hash hex strings,
 * which can leak partial-match timing information across many calls.
 *
 * Returns `false` (not throws) on length mismatch, non-64-char inputs, or
 * malformed hex — invalid hex is rejected before reaching `timingSafeEqual`
 * so the constant-time guarantee only covers the valid-input fast path.
 */
export function sha256HexEqualConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length || a.length !== 64) return false;
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a, "hex");
    bufB = Buffer.from(b, "hex");
  } catch {
    return false;
  }
  if (bufA.length !== 32 || bufB.length !== 32) return false;
  // Buffer.from(hex) silently drops invalid characters and produces a
  // shorter buffer — so the length check above also catches malformed hex.
  return timingSafeEqual(bufA, bufB);
}
