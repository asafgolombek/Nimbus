export const URI_SCHEME = "nimbus-item";

export function parseItemUri(uri: string): string | undefined {
  if (!uri.startsWith(`${URI_SCHEME}:`)) return undefined;
  return uri.slice(URI_SCHEME.length + 1);
}

export function formatItemMarkdown(item: Record<string, unknown>): string {
  const name = typeof item.name === "string" && item.name.length > 0 ? item.name : "Untitled";
  const service = typeof item.service === "string" ? item.service : "unknown";
  const type = typeof item.itemType === "string" ? item.itemType : "unknown";
  const id = typeof item.id === "string" ? item.id : "—";
  const modifiedAt =
    typeof item.modifiedAt === "number" ? new Date(item.modifiedAt).toISOString() : "—";

  const lines: string[] = [
    `# ${name}`,
    "",
    `- **Service:** ${service}`,
    `- **Type:** ${type}`,
    `- **ID:** ${id}`,
    `- **Modified:** ${modifiedAt}`,
    "",
    "## Raw fields",
    "",
    "```json",
    JSON.stringify(item, null, 2),
    "```",
  ];
  return lines.join("\n");
}
