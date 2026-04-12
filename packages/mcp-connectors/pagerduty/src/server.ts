/**
 * nimbus-mcp-pagerduty — PagerDuty REST v2 MCP.
 * Mutations require Gateway HITL: pagerduty.incident.* (acknowledge / resolve / escalate).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  createRegisterSimpleTool,
  createZodToolRegistrar,
  mcpJsonResult as jsonResult,
  mcpJsonResultIfOk,
  requireProcessEnv,
} from "../../shared/mcp-tool-kit.ts";

const API = "https://api.pagerduty.com";

async function pdFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = path.startsWith("http") ? path : `${API}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.pagerduty+json;version=2",
      Authorization: `Token token=${token}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
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

const mcp = new McpServer({ name: "nimbus-pagerduty", version: "0.1.0" });
const reg = createZodToolRegistrar(createRegisterSimpleTool(mcp));

reg(
  "pd_incident_list",
  "List PagerDuty incidents (open and recently resolved).",
  z.object({
    statuses: z.array(z.enum(["triggered", "acknowledged", "resolved"])).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async (parsed) => {
    const token = requireProcessEnv("PAGERDUTY_API_TOKEN");
    const u = new URL(`${API}/incidents`);
    u.searchParams.set("limit", String(parsed.limit ?? 25));
    const st = parsed.statuses ?? ["triggered", "acknowledged"];
    for (const s of st) {
      u.searchParams.append("statuses[]", s);
    }
    const res = await pdFetch(token, `${u.pathname}${u.search}`);
    return mcpJsonResultIfOk("PagerDuty", res);
  },
);

reg(
  "pd_incident_get",
  "Get a single incident by id.",
  z.object({ incidentId: z.string().min(1) }),
  async (parsed) => {
    const token = requireProcessEnv("PAGERDUTY_API_TOKEN");
    const res = await pdFetch(token, `/incidents/${encodeURIComponent(parsed.incidentId)}`);
    return mcpJsonResultIfOk("PagerDuty", res);
  },
);

reg(
  "pd_incident_acknowledge",
  "Acknowledge an incident. Requires Gateway HITL.",
  z.object({ incidentId: z.string().min(1) }),
  async (parsed) => {
    const token = requireProcessEnv("PAGERDUTY_API_TOKEN");
    const res = await pdFetch(
      token,
      `/incidents/${encodeURIComponent(parsed.incidentId)}/acknowledge`,
      {
        method: "PUT",
        body: JSON.stringify({ incident: { type: "incident_reference", id: parsed.incidentId } }),
      },
    );
    if (!res.ok) {
      throw new Error(`PagerDuty acknowledge ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json ?? { ok: true });
  },
);

reg(
  "pd_incident_resolve",
  "Resolve an incident. Requires Gateway HITL.",
  z.object({ incidentId: z.string().min(1) }),
  async (parsed) => {
    const token = requireProcessEnv("PAGERDUTY_API_TOKEN");
    const res = await pdFetch(
      token,
      `/incidents/${encodeURIComponent(parsed.incidentId)}/resolve`,
      {
        method: "PUT",
        body: JSON.stringify({ incident: { type: "incident_reference", id: parsed.incidentId } }),
      },
    );
    if (!res.ok) {
      throw new Error(`PagerDuty resolve ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json ?? { ok: true });
  },
);

reg(
  "pd_incident_escalate",
  "Escalate an incident. Requires Gateway HITL.",
  z.object({ incidentId: z.string().min(1) }),
  async (parsed) => {
    const token = requireProcessEnv("PAGERDUTY_API_TOKEN");
    const res = await pdFetch(
      token,
      `/incidents/${encodeURIComponent(parsed.incidentId)}/escalate`,
      {
        method: "PUT",
        body: JSON.stringify({ incident: { type: "incident_reference", id: parsed.incidentId } }),
      },
    );
    if (!res.ok) {
      throw new Error(`PagerDuty escalate ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json ?? { ok: true });
  },
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
