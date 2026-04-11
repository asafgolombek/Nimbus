/**
 * user_version 4 — `person.linked` (Q2 Phase 6).
 * `linked = 1` when `canonical_email` is known; handle-only identities use `linked = 0`.
 */
export const PERSON_LINKED_V4_ALTER_SQL = `
ALTER TABLE person ADD COLUMN linked INTEGER NOT NULL DEFAULT 1;
`;
