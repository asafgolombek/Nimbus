/** Loose JSON object envelope from HTTP APIs — empty record when not a plain object. */
export function asUnknownObjectRecord(json: unknown): Record<string, unknown> {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return {};
  }
  return json as Record<string, unknown>;
}
