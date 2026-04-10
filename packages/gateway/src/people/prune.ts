import type { Database } from "bun:sqlite";

/**
 * After index rows for a connector are removed: clear that connector's handle column on all
 * people, then delete persons no longer referenced by any `item.author_id`.
 */
export function prunePeopleAfterServiceRemoval(db: Database, serviceId: string): void {
  switch (serviceId) {
    case "github":
      db.run("UPDATE person SET github_login = NULL");
      break;
    case "gitlab":
      db.run("UPDATE person SET gitlab_login = NULL");
      break;
    case "slack":
      db.run("UPDATE person SET slack_handle = NULL");
      break;
    case "linear":
      db.run("UPDATE person SET linear_member_id = NULL");
      break;
    case "jira":
      db.run("UPDATE person SET jira_account_id = NULL");
      break;
    case "notion":
      db.run("UPDATE person SET notion_user_id = NULL");
      break;
    default:
      break;
  }
  db.run(
    `DELETE FROM person WHERE id NOT IN (
      SELECT DISTINCT author_id FROM item WHERE author_id IS NOT NULL
    )`,
  );
}
