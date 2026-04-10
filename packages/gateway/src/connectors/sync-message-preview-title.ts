/**
 * Short display title from a plain-text message preview (Slack / Teams sync).
 * Centralizes truncation so connector modules do not duplicate nested ternaries.
 */
export function shortIndexedMessageTitleFromPreview(
  preview: string,
  whenTrimmedEmpty: string,
): string {
  const t = preview.trim();
  if (t === "") {
    return whenTrimmedEmpty;
  }
  if (t.length > 120) {
    return `${t.slice(0, 117)}…`;
  }
  return t;
}
