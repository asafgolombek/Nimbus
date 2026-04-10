/**
 * Trims whitespace, then removes trailing `/` characters without regex (avoids ReDoS audit noise on `/+$/`).
 */
export function stripTrailingSlashes(input: string): string {
  let s = input.trim();
  while (s.endsWith("/")) {
    s = s.slice(0, -1);
  }
  return s;
}
