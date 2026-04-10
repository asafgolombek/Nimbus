/**
 * Trims whitespace, then removes trailing `/` without regex (avoids ReDoS / Sonar typescript:S5852 on `/+$/`).
 */
export function stripTrailingSlashes(input: string): string {
  let s = input.trim();
  while (s.endsWith("/")) {
    s = s.slice(0, -1);
  }
  return s;
}
