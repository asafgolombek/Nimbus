import { describe, expect, test } from "bun:test";
import { DRIVE_TIER_COUNTS, driveTracePages } from "./synthetic-drive-trace.ts";

describe("driveTracePages", () => {
  test("small tier produces the expected total item count", () => {
    const pages = driveTracePages("small");
    const total = pages.reduce((s, p) => s + p.files.length, 0);
    expect(total).toBe(DRIVE_TIER_COUNTS.small);
  });

  test("each page except the last carries a nextPageToken", () => {
    const pages = driveTracePages("small");
    for (let i = 0; i < pages.length - 1; i += 1) {
      expect(pages[i]?.nextPageToken).toBeTruthy();
    }
    expect(pages[pages.length - 1]?.nextPageToken).toBeUndefined();
  });

  test("deterministic output: same tier produces identical bytes", () => {
    const a = JSON.stringify(driveTracePages("small"));
    const b = JSON.stringify(driveTracePages("small"));
    expect(a).toBe(b);
  });

  test("each file has the canonical Drive fields", () => {
    const pages = driveTracePages("small");
    const file = pages[0]?.files[0];
    expect(typeof file?.id).toBe("string");
    expect(typeof file?.name).toBe("string");
    expect(typeof file?.mimeType).toBe("string");
    expect(typeof file?.modifiedTime).toBe("string");
  });
});
