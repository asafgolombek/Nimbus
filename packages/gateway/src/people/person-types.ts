export type PersonRecord = {
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
  metadata: Record<string, unknown> | null;
};

export type PersonSyncHints = {
  displayName?: string;
  canonicalEmail?: string;
  githubLogin?: string;
  gitlabLogin?: string;
  slackHandle?: string;
  linearMemberId?: string;
  jiraAccountId?: string;
  notionUserId?: string;
};
