/** Compare ISO 8601 timestamps by parsed millisecond value (sync watermark ordering). */

export function isoMs(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export function maxIso(a: string, b: string): string {
  return isoMs(a) >= isoMs(b) ? a : b;
}
