const FENCE = "```";

function isAsciiSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

/**
 * First ``` / ```json fenced block body (linear scan; no backtracking regex — Sonar S5852).
 */
export function extractFirstMarkdownFenceBody(trimmed: string): string | undefined {
  const open = trimmed.indexOf(FENCE);
  if (open < 0) {
    return undefined;
  }
  let i = open + FENCE.length;
  if (trimmed.startsWith("json", i)) {
    i += 4;
  }
  while (i < trimmed.length && isAsciiSpace(trimmed.charCodeAt(i))) {
    i += 1;
  }
  const close = trimmed.indexOf(FENCE, i);
  if (close < 0) {
    return undefined;
  }
  return trimmed.slice(i, close).trim();
}
