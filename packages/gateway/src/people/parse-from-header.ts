import { normalizeEmail } from "./person-store.ts";

/**
 * Parse the first mailbox address from a MIME `From` header (e.g. `Name <a@b.com>` or `a@b.com`).
 * Returns normalized lowercase email and optional display name.
 */
export function parseFromHeaderForPerson(raw: string | null | undefined): {
  email?: string;
  displayName?: string;
} {
  if (raw === null || raw === undefined) {
    return {};
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {};
  }
  const namedAngle = /^(.+?)\s*<([^>\s]+@[^>\s]+)>\s*$/.exec(trimmed);
  if (namedAngle !== null) {
    const email = normalizeEmail(namedAngle[2]);
    let displayName = namedAngle[1].replace(/^["']|["']$/g, "").trim();
    if (displayName === "") {
      displayName = email;
    }
    return { email, displayName };
  }
  const angleOnly = /<([^>\s]+@[^>\s]+)>/.exec(trimmed);
  if (angleOnly !== null) {
    return { email: normalizeEmail(angleOnly[1]) };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    const email = normalizeEmail(trimmed);
    return { email, displayName: email };
  }
  return {};
}
