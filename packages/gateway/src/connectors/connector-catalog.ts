import type { OAuthProvider } from "../auth/pkce.ts";

/** Normalised connector `service_id` values (Q2 plan / scheduler_state). */
export const CONNECTOR_SERVICE_IDS = [
  "google_drive",
  "gmail",
  "google_photos",
  "onedrive",
  "outlook",
  "teams",
  "slack",
  "github",
  "github_actions",
  "gitlab",
  "bitbucket",
  "linear",
  "jira",
  "notion",
  "confluence",
  "discord",
  "jenkins",
  "circleci",
  "pagerduty",
] as const;

export type ConnectorServiceId = (typeof CONNECTOR_SERVICE_IDS)[number];

export const GOOGLE_CONNECTOR_SERVICES: ReadonlySet<string> = new Set([
  "google_drive",
  "gmail",
  "google_photos",
]);

export const MICROSOFT_CONNECTOR_SERVICES: ReadonlySet<string> = new Set([
  "onedrive",
  "outlook",
  "teams",
]);

export function normalizeConnectorServiceId(raw: string): ConnectorServiceId | null {
  const s = raw.trim().toLowerCase().replaceAll("-", "_");
  if ((CONNECTOR_SERVICE_IDS as readonly string[]).includes(s)) {
    return s as ConnectorServiceId;
  }
  return null;
}

export function defaultSyncIntervalMsForService(serviceId: ConnectorServiceId): number {
  switch (serviceId) {
    case "google_drive":
    case "onedrive":
      return 30 * 60 * 1000;
    case "gmail":
    case "outlook":
    case "teams":
    case "slack":
    case "notion":
      return 5 * 60 * 1000;
    case "confluence":
      return 10 * 60 * 1000;
    case "google_photos":
      return 6 * 60 * 60 * 1000;
    case "github":
    case "github_actions":
    case "gitlab":
    case "bitbucket":
    case "linear":
    case "jira":
      return 60 * 1000;
    case "discord":
      return 5 * 60 * 1000;
    case "jenkins":
      return 120 * 1000;
    case "circleci":
      return 90 * 1000;
    case "pagerduty":
      return 120 * 1000;
    default: {
      const _exhaustive: never = serviceId;
      return _exhaustive;
    }
  }
}

export type ConnectorOAuthProfile = {
  provider: OAuthProvider;
  defaultScopes: string[];
};

export function oauthProfileForService(serviceId: ConnectorServiceId): ConnectorOAuthProfile {
  switch (serviceId) {
    case "google_drive":
      return {
        provider: "google",
        defaultScopes: ["https://www.googleapis.com/auth/drive.readonly"],
      };
    case "gmail":
      return {
        provider: "google",
        defaultScopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.compose",
        ],
      };
    case "google_photos":
      return {
        provider: "google",
        defaultScopes: ["https://www.googleapis.com/auth/photoslibrary.readonly"],
      };
    case "onedrive":
      return {
        provider: "microsoft",
        defaultScopes: ["Files.Read.All", "offline_access", "openid", "profile"],
      };
    case "outlook":
      return {
        provider: "microsoft",
        defaultScopes: [
          "Mail.Read",
          "Mail.Send",
          "Calendars.Read",
          "Calendars.ReadWrite",
          "Contacts.Read",
          "offline_access",
          "openid",
          "profile",
        ],
      };
    case "teams":
      return {
        provider: "microsoft",
        defaultScopes: [
          "Team.ReadBasic.All",
          "Channel.ReadBasic.All",
          "ChannelMessage.Read.All",
          "ChannelMessage.Send",
          "Chat.Read",
          "ChatMessage.Send",
          "User.Read",
          "offline_access",
          "openid",
          "profile",
        ],
      };
    case "slack":
      return {
        provider: "slack",
        defaultScopes: [
          "channels:read",
          "channels:history",
          "groups:read",
          "groups:history",
          "im:read",
          "im:history",
          "mpim:read",
          "mpim:history",
          "users:read",
          "users:read.email",
          "search:read",
          "chat:write",
        ],
      };
    case "github":
      throw new Error(
        "oauthProfileForService: github uses a PAT (connector.auth personalAccessToken)",
      );
    case "github_actions":
      throw new Error(
        "oauthProfileForService: github_actions uses the same PAT as github (connector.auth github)",
      );
    case "gitlab":
      throw new Error(
        "oauthProfileForService: gitlab uses a PAT (connector.auth personalAccessToken)",
      );
    case "bitbucket":
      throw new Error(
        "oauthProfileForService: bitbucket uses app password (connector.auth username + token)",
      );
    case "linear":
      throw new Error(
        "oauthProfileForService: linear uses an API key (connector.auth personalAccessToken)",
      );
    case "jira":
      throw new Error(
        "oauthProfileForService: jira uses email + API token + base URL (connector.auth)",
      );
    case "notion":
      return { provider: "notion", defaultScopes: [] };
    case "confluence":
      throw new Error(
        "oauthProfileForService: confluence uses email + API token + base URL (connector.auth)",
      );
    case "discord":
      throw new Error(
        "oauthProfileForService: discord uses a bot token + opt-in (connector.auth --enable)",
      );
    case "jenkins":
      throw new Error(
        "oauthProfileForService: jenkins uses base URL + username + API token (connector.auth)",
      );
    case "circleci":
      throw new Error(
        "oauthProfileForService: circleci uses a personal API token (connector.auth circleci)",
      );
    case "pagerduty":
      throw new Error(
        "oauthProfileForService: pagerduty uses a REST API token (connector.auth pagerduty)",
      );
    default: {
      const _never: never = serviceId;
      return _never;
    }
  }
}
