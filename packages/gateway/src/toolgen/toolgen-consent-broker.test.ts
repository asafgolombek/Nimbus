import { describe, expect, test } from "bun:test";
import { ToolgenConsentBroker } from "./toolgen-consent-broker.ts";

describe("ToolgenConsentBroker", () => {
  test("broadcasts the VERBATIM body and the host list", async () => {
    const b = new ToolgenConsentBroker();
    let seen: Record<string, unknown> | undefined;
    b.setBroadcast((method, params) => {
      expect(method).toBe("toolgen.approvalRequest");
      seen = params as Record<string, unknown>;
      b.respond(String(seen["requestId"]), true);
    });
    await b.request(
      {
        toolId: "tg_a",
        toolName: "t",
        description: "d",
        body: "VERBATIM-BODY",
        approvedHosts: ["api.example.com"],
        credentialHosts: [],
        initiator: "owner",
      },
      1000,
    );
    expect(seen?.["body"]).toBe("VERBATIM-BODY");
    expect(seen?.["approvedHosts"]).toEqual(["api.example.com"]);
  });

  test("resolves FALSE on TTL expiry — fail-closed", async () => {
    const b = new ToolgenConsentBroker();
    b.setBroadcast(() => {});
    expect(
      await b.request(
        {
          toolId: "tg_a",
          toolName: "t",
          description: "d",
          body: "x",
          approvedHosts: [],
          credentialHosts: [],
          initiator: "owner",
        },
        10,
      ),
    ).toBe(false);
  });
});
