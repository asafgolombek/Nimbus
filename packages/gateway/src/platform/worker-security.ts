/**
 * Security helpers for Bun Workers to satisfy CodeQL origin verification requirements.
 * Bun Workers always have a blank origin ("") when spawned from local files.
 */

function getGlobalOrigin(): string {
  const g = globalThis as typeof globalThis & { origin?: unknown };
  return typeof g.origin === "string" ? g.origin : "";
}

/**
 * Returns true if the message event originates from an acceptable origin for a
 * dedicated worker spawned by the gateway (usually blank or matching self).
 */
export function isAcceptableWorkerOrigin(ev: MessageEvent): boolean {
  const o = ev.origin;
  // In Bun/Node.js, local Workers have a blank or "null" origin.
  if (o === "" || o === "null") {
    return true;
  }
  const selfO = getGlobalOrigin();
  if (selfO === "") {
    return true;
  }
  return o === selfO;
}
