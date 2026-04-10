import type { Database } from "bun:sqlite";

import type { PersonRecord } from "./person-types.ts";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

type PersonRow = {
  id: string;
  display_name: string | null;
  canonical_email: string | null;
  github_login: string | null;
  gitlab_login: string | null;
  slack_handle: string | null;
  linear_member_id: string | null;
  jira_account_id: string | null;
  notion_user_id: string | null;
  linked: number;
  metadata: string | null;
};

function rowToRecord(row: PersonRow): PersonRecord {
  let meta: Record<string, unknown> | null = null;
  if (row.metadata != null && row.metadata !== "") {
    try {
      const p: unknown = JSON.parse(row.metadata);
      if (p !== null && typeof p === "object" && !Array.isArray(p)) {
        meta = p as Record<string, unknown>;
      }
    } catch {
      meta = null;
    }
  }
  return {
    id: row.id,
    displayName: row.display_name,
    canonicalEmail: row.canonical_email,
    githubLogin: row.github_login,
    gitlabLogin: row.gitlab_login,
    slackHandle: row.slack_handle,
    linearMemberId: row.linear_member_id,
    jiraAccountId: row.jira_account_id,
    notionUserId: row.notion_user_id,
    linked: row.linked === 1,
    metadata: meta,
  };
}

export function getPersonById(db: Database, id: string): PersonRecord | null {
  const row = db.query("SELECT * FROM person WHERE id = ?").get(id) as PersonRow | null | undefined;
  if (row === null || row === undefined) {
    return null;
  }
  return rowToRecord(row);
}

export function findPersonByCanonicalEmail(db: Database, email: string): PersonRecord | null {
  const row = db
    .query("SELECT * FROM person WHERE canonical_email = ?")
    .get(email) as PersonRow | null | undefined;
  if (row === null || row === undefined) {
    return null;
  }
  return rowToRecord(row);
}

export function findPersonByGithubLogin(db: Database, login: string): PersonRecord | null {
  const row = db
    .query("SELECT * FROM person WHERE github_login = ?")
    .get(login) as PersonRow | null | undefined;
  if (row === null || row === undefined) {
    return null;
  }
  return rowToRecord(row);
}

export function findPersonByGitlabLogin(db: Database, login: string): PersonRecord | null {
  const row = db
    .query("SELECT * FROM person WHERE gitlab_login = ?")
    .get(login) as PersonRow | null | undefined;
  if (row === null || row === undefined) {
    return null;
  }
  return rowToRecord(row);
}

export function findPersonBySlackHandle(db: Database, handle: string): PersonRecord | null {
  const row = db
    .query("SELECT * FROM person WHERE slack_handle = ?")
    .get(handle) as PersonRow | null | undefined;
  if (row === null || row === undefined) {
    return null;
  }
  return rowToRecord(row);
}

export function findPersonByLinearMemberId(db: Database, memberId: string): PersonRecord | null {
  const row = db
    .query("SELECT * FROM person WHERE linear_member_id = ?")
    .get(memberId) as PersonRow | null | undefined;
  if (row === null || row === undefined) {
    return null;
  }
  return rowToRecord(row);
}

export function findPersonByJiraAccountId(db: Database, accountId: string): PersonRecord | null {
  const row = db
    .query("SELECT * FROM person WHERE jira_account_id = ?")
    .get(accountId) as PersonRow | null | undefined;
  if (row === null || row === undefined) {
    return null;
  }
  return rowToRecord(row);
}

export function findPersonByNotionUserId(db: Database, userId: string): PersonRecord | null {
  const row = db
    .query("SELECT * FROM person WHERE notion_user_id = ?")
    .get(userId) as PersonRow | null | undefined;
  if (row === null || row === undefined) {
    return null;
  }
  return rowToRecord(row);
}

export function insertPerson(
  db: Database,
  row: {
    id: string;
    displayName: string | null;
    canonicalEmail: string | null;
    githubLogin: string | null;
    gitlabLogin: string | null;
    slackHandle: string | null;
    linearMemberId: string | null;
    jiraAccountId: string | null;
    notionUserId: string | null;
    linked: boolean;
    metadata: Record<string, unknown>;
  },
): void {
  const meta = JSON.stringify(row.metadata);
  db.run(
    `INSERT INTO person (
      id, display_name, canonical_email, github_login, gitlab_login, slack_handle,
      linear_member_id, jira_account_id, notion_user_id, linked, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.displayName,
      row.canonicalEmail,
      row.githubLogin,
      row.gitlabLogin,
      row.slackHandle,
      row.linearMemberId,
      row.jiraAccountId,
      row.notionUserId,
      row.linked ? 1 : 0,
      meta,
    ],
  );
}

export function updatePersonHandles(
  db: Database,
  id: string,
  patch: {
    displayName?: string | null;
    canonicalEmail?: string | null;
    githubLogin?: string | null;
    gitlabLogin?: string | null;
    slackHandle?: string | null;
    linearMemberId?: string | null;
    jiraAccountId?: string | null;
    notionUserId?: string | null;
    linked?: boolean;
  },
): void {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (patch.displayName !== undefined) {
    sets.push("display_name = ?");
    params.push(patch.displayName);
  }
  if (patch.canonicalEmail !== undefined) {
    sets.push("canonical_email = ?");
    params.push(patch.canonicalEmail);
  }
  if (patch.githubLogin !== undefined) {
    sets.push("github_login = ?");
    params.push(patch.githubLogin);
  }
  if (patch.gitlabLogin !== undefined) {
    sets.push("gitlab_login = ?");
    params.push(patch.gitlabLogin);
  }
  if (patch.slackHandle !== undefined) {
    sets.push("slack_handle = ?");
    params.push(patch.slackHandle);
  }
  if (patch.linearMemberId !== undefined) {
    sets.push("linear_member_id = ?");
    params.push(patch.linearMemberId);
  }
  if (patch.jiraAccountId !== undefined) {
    sets.push("jira_account_id = ?");
    params.push(patch.jiraAccountId);
  }
  if (patch.notionUserId !== undefined) {
    sets.push("notion_user_id = ?");
    params.push(patch.notionUserId);
  }
  if (patch.linked !== undefined) {
    sets.push("linked = ?");
    params.push(patch.linked ? 1 : 0);
  }
  if (sets.length === 0) {
    return;
  }
  params.push(id);
  db.run(`UPDATE person SET ${sets.join(", ")} WHERE id = ?`, params);
}

export function listPersons(
  db: Database,
  options: { unlinkedOnly?: boolean; limit: number },
): PersonRecord[] {
  const lim = Math.min(500, Math.max(1, options.limit));
  const where =
    options.unlinkedOnly === true ? "WHERE linked = 0" : "";
  const rows = db
    .query(`SELECT * FROM person ${where} ORDER BY id LIMIT ?`)
    .all(lim) as PersonRow[];
  return rows.map(rowToRecord);
}

export function searchPersons(db: Database, query: string, limit: number): PersonRecord[] {
  const lim = Math.min(100, Math.max(1, limit));
  const q = query.trim().toLowerCase();
  if (q === "") {
    return listPersons(db, { limit: lim });
  }
  const rows = db
    .query(
      `SELECT * FROM person WHERE
        instr(lower(coalesce(display_name, '')), ?) > 0 OR
        instr(lower(coalesce(canonical_email, '')), ?) > 0 OR
        instr(lower(coalesce(github_login, '')), ?) > 0 OR
        instr(lower(coalesce(gitlab_login, '')), ?) > 0 OR
        instr(lower(coalesce(slack_handle, '')), ?) > 0 OR
        instr(lower(coalesce(linear_member_id, '')), ?) > 0 OR
        instr(lower(coalesce(jira_account_id, '')), ?) > 0 OR
        instr(lower(coalesce(notion_user_id, '')), ?) > 0
      ORDER BY id LIMIT ?`,
    )
    .all(q, q, q, q, q, q, q, q, lim) as PersonRow[];
  return rows.map(rowToRecord);
}

export function countItemsByAuthor(db: Database, personId: string): number {
  const row = db
    .query("SELECT COUNT(*) as c FROM item WHERE author_id = ?")
    .get(personId) as { c: number } | null | undefined;
  const c = row?.c;
  return typeof c === "number" && Number.isFinite(c) ? Math.floor(c) : 0;
}

export function deletePersonById(db: Database, id: string): void {
  db.run("DELETE FROM person WHERE id = ?", [id]);
}
