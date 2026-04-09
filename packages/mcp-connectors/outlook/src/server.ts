/**
 * nimbus-mcp-outlook — Microsoft Graph mail, calendar, contacts (read + guarded writes).
 * Access token is injected as MICROSOFT_OAUTH_ACCESS_TOKEN (never logged).
 * Send / calendar mutations require Gateway HITL (email.send, calendar.event.create | delete).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const GRAPH = "https://graph.microsoft.com/v1.0";

function requireAccessToken(): string {
  const t = process.env["MICROSOFT_OAUTH_ACCESS_TOKEN"];
  if (t === undefined || t === "") {
    throw new Error("MICROSOFT_OAUTH_ACCESS_TOKEN is not set");
  }
  return t;
}

type ListResult = { content: Array<{ type: "text"; text: string }> };

async function graphRequest(
  token: string,
  pathOrUrl: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

const server = new McpServer({ name: "nimbus-outlook", version: "0.1.0" });

const registerSimpleTool = server.tool.bind(server) as (
  name: string,
  description: string,
  inputShape: Record<string, z.ZodTypeAny>,
  handler: (args: unknown) => Promise<ListResult>,
) => unknown;

const outlookMailFoldersArgs = z.object({
  top: z.number().int().min(1).max(200).optional(),
  nextLink: z.string().url().optional(),
});

registerSimpleTool(
  "outlook_mail_folders",
  "List mail folders (pagination via nextLink).",
  outlookMailFoldersArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookMailFoldersArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    let path: string;
    if (parsed.data.nextLink !== undefined && parsed.data.nextLink !== "") {
      path = parsed.data.nextLink;
    } else {
      const top = parsed.data.top ?? 50;
      path = `/me/mailFolders?$top=${String(top)}`;
    }
    const r = await graphRequest(token, path);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const outlookMailListArgs = z.object({
  folderId: z.string().min(1).optional(),
  top: z.number().int().min(1).max(100).optional(),
  skip: z.number().int().min(0).optional(),
  nextLink: z.string().url().optional(),
  filter: z.string().max(500).optional(),
});

registerSimpleTool(
  "outlook_mail_list",
  "List mail messages (default folder inbox if folderId omitted). Pagination via nextLink.",
  outlookMailListArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookMailListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const top = parsed.data.top ?? 25;
    let path: string;
    if (parsed.data.nextLink !== undefined && parsed.data.nextLink !== "") {
      path = parsed.data.nextLink;
    } else {
      const fid =
        parsed.data.folderId !== undefined && parsed.data.folderId !== ""
          ? parsed.data.folderId
          : "inbox";
      const skip = parsed.data.skip ?? 0;
      const u = new URL(`${GRAPH}/me/mailFolders/${encodeURIComponent(fid)}/messages`);
      u.searchParams.set("$top", String(top));
      u.searchParams.set("$skip", String(skip));
      u.searchParams.set(
        "$select",
        "id,subject,bodyPreview,receivedDateTime,lastModifiedDateTime,hasAttachments,webLink",
      );
      if (parsed.data.filter !== undefined && parsed.data.filter !== "") {
        u.searchParams.set("$filter", parsed.data.filter);
      }
      path = `${u.pathname}${u.search}`;
    }
    const r = await graphRequest(token, path);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const outlookMailReadArgs = z.object({
  messageId: z.string().min(1),
});

registerSimpleTool(
  "outlook_mail_read",
  "Read a single message (body, headers, attachments metadata).",
  outlookMailReadArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookMailReadArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const r = await graphRequest(
      token,
      `/me/messages/${encodeURIComponent(parsed.data.messageId)}?$expand=attachments`,
    );
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const outlookMailSendArgs = z.object({
  to: z.string().min(1).max(2000),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(1_000_000),
  contentType: z.enum(["text", "html"]).optional(),
  cc: z.string().max(2000).optional(),
});

registerSimpleTool(
  "outlook_mail_send",
  "Send an email via Microsoft Graph. Requires Gateway HITL email.send.",
  outlookMailSendArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookMailSendArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const toList = parsed.data.to
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const message: Record<string, unknown> = {
      subject: parsed.data.subject,
      body: {
        contentType: (parsed.data.contentType ?? "text") === "html" ? "HTML" : "Text",
        content: parsed.data.body,
      },
      toRecipients: toList.map((addr) => ({
        emailAddress: { address: addr },
      })),
    };
    if (parsed.data.cc !== undefined && parsed.data.cc !== "") {
      const ccList = parsed.data.cc
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      message["ccRecipients"] = ccList.map((addr) => ({
        emailAddress: { address: addr },
      }));
    }
    const r = await graphRequest(token, "/me/sendMail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  },
);

const outlookCalendarListArgs = z.object({
  startDateTime: z.string().min(1),
  endDateTime: z.string().min(1),
  top: z.number().int().min(1).max(200).optional(),
  nextLink: z.string().url().optional(),
});

registerSimpleTool(
  "outlook_calendar_list",
  "List calendar events in a time window (ISO 8601 startDateTime / endDateTime).",
  outlookCalendarListArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookCalendarListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    let path: string;
    if (parsed.data.nextLink !== undefined && parsed.data.nextLink !== "") {
      path = parsed.data.nextLink;
    } else {
      const top = parsed.data.top ?? 50;
      const s = encodeURIComponent(parsed.data.startDateTime);
      const e = encodeURIComponent(parsed.data.endDateTime);
      path = `/me/calendarView?startDateTime=${s}&endDateTime=${e}&$top=${String(top)}`;
    }
    const r = await graphRequest(token, path);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const outlookCalendarGetArgs = z.object({
  eventId: z.string().min(1),
});

registerSimpleTool(
  "outlook_calendar_get",
  "Get a single calendar event by id.",
  outlookCalendarGetArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookCalendarGetArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const r = await graphRequest(token, `/me/events/${encodeURIComponent(parsed.data.eventId)}`);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const outlookCalendarCreateArgs = z.object({
  subject: z.string().min(1).max(500),
  startDateTime: z.string().min(1),
  endDateTime: z.string().min(1),
  timeZone: z.string().min(1).max(100).optional(),
  body: z.string().max(50_000).optional(),
  attendees: z.string().max(4000).optional(),
});

registerSimpleTool(
  "outlook_calendar_create",
  "Create a calendar event. Requires Gateway HITL calendar.event.create.",
  outlookCalendarCreateArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookCalendarCreateArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const tz = parsed.data.timeZone ?? "UTC";
    const body: Record<string, unknown> = {
      subject: parsed.data.subject,
      start: { dateTime: parsed.data.startDateTime, timeZone: tz },
      end: { dateTime: parsed.data.endDateTime, timeZone: tz },
    };
    if (parsed.data.body !== undefined && parsed.data.body !== "") {
      body["body"] = { contentType: "Text", content: parsed.data.body };
    }
    if (parsed.data.attendees !== undefined && parsed.data.attendees !== "") {
      const addrs = parsed.data.attendees
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      body["attendees"] = addrs.map((a) => ({
        emailAddress: { address: a },
        type: "required",
      }));
    }
    const r = await graphRequest(token, "/me/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const outlookCalendarDeleteArgs = z.object({
  eventId: z.string().min(1),
});

registerSimpleTool(
  "outlook_calendar_delete",
  "Delete a calendar event. Requires Gateway HITL calendar.event.delete.",
  outlookCalendarDeleteArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookCalendarDeleteArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const r = await graphRequest(token, `/me/events/${encodeURIComponent(parsed.data.eventId)}`, {
      method: "DELETE",
    });
    if (!r.ok && r.status !== 204) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  },
);

const outlookContactListArgs = z.object({
  top: z.number().int().min(1).max(200).optional(),
  skip: z.number().int().min(0).optional(),
  nextLink: z.string().url().optional(),
});

registerSimpleTool(
  "outlook_contact_list",
  "List contacts from the default folder.",
  outlookContactListArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookContactListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    let path: string;
    if (parsed.data.nextLink !== undefined && parsed.data.nextLink !== "") {
      path = parsed.data.nextLink;
    } else {
      const top = parsed.data.top ?? 50;
      const skip = parsed.data.skip ?? 0;
      path = `/me/contacts?$top=${String(top)}&$skip=${String(skip)}`;
    }
    const r = await graphRequest(token, path);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const outlookContactGetArgs = z.object({
  contactId: z.string().min(1),
});

registerSimpleTool(
  "outlook_contact_get",
  "Get a single contact by id.",
  outlookContactGetArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = outlookContactGetArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const r = await graphRequest(
      token,
      `/me/contacts/${encodeURIComponent(parsed.data.contactId)}`,
    );
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

await server.connect(new StdioServerTransport());
