export interface HitlRequest {
  actionId: string;
  summary: string;
  diff?: string;
}

export function isHitlRequest(value: unknown): value is HitlRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const actionId = candidate["actionId"];
  const summary = candidate["summary"];
  const diff = candidate["diff"];
  return (
    typeof actionId === "string" &&
    actionId.length > 0 &&
    typeof summary === "string" &&
    summary.length > 0 &&
    (diff === undefined || typeof diff === "string")
  );
}
