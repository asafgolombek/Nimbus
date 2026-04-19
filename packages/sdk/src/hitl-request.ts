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
  return (
    typeof candidate["actionId"] === "string" &&
    (candidate["actionId"] as string).length > 0 &&
    typeof candidate["summary"] === "string" &&
    (candidate["summary"] as string).length > 0 &&
    (candidate["diff"] === undefined || typeof candidate["diff"] === "string")
  );
}
