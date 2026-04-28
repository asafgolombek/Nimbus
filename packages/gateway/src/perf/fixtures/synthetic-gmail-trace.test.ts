import { describe, expect, test } from "bun:test";
import { GMAIL_TIER_COUNTS, gmailListPages, gmailMessage } from "./synthetic-gmail-trace.ts";

describe("gmailListPages", () => {
  test("small tier produces the expected total id count", () => {
    const pages = gmailListPages("small");
    const total = pages.reduce((s, p) => s + p.messages.length, 0);
    expect(total).toBe(GMAIL_TIER_COUNTS.small);
  });

  test("nextPageToken on every page except the last", () => {
    const pages = gmailListPages("small");
    for (let i = 0; i < pages.length - 1; i += 1) {
      expect(pages[i]?.nextPageToken).toBeTruthy();
    }
    expect(pages.at(-1)?.nextPageToken).toBeUndefined();
  });

  test("each list entry carries id + threadId", () => {
    const pages = gmailListPages("small");
    const m = pages[0]?.messages[0];
    expect(typeof m?.id).toBe("string");
    expect(typeof m?.threadId).toBe("string");
  });

  test("deterministic", () => {
    const a = JSON.stringify(gmailListPages("small"));
    const b = JSON.stringify(gmailListPages("small"));
    expect(a).toBe(b);
  });
});

describe("gmailMessage", () => {
  test("returns a payload with subject + snippet for a known id", () => {
    const pages = gmailListPages("small");
    const id = pages[0]?.messages[0]?.id ?? "";
    const m = gmailMessage(id, "small");
    expect(m?.id).toBe(id);
    expect(typeof m?.snippet).toBe("string");
    expect(m?.payload.headers.find((h) => h.name === "Subject")).toBeDefined();
  });

  test("unknown id returns undefined", () => {
    expect(gmailMessage("nope", "small")).toBeUndefined();
  });
});
