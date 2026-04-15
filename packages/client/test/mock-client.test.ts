import { describe, expect, test } from "bun:test";

import { MockClient } from "../src/mock-client.ts";

describe("MockClient", () => {
  test("queryItems returns fixture items", async () => {
    const c = new MockClient({
      items: [
        {
          id: "1",
          service: "github",
          itemType: "file",
          name: "Demo",
          modifiedAt: 1,
        },
      ],
    });
    const r = await c.queryItems({});
    expect(r.items.length).toBe(1);
    expect(r.items[0]?.id).toBe("1");
    await c.close();
  });
});
