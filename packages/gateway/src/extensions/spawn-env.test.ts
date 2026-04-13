import { describe, expect, test } from "bun:test";

import { extensionProcessEnv } from "./spawn-env.ts";

describe("extensionProcessEnv", () => {
  test("returns only injected keys", () => {
    const prev = process.env["NIMBUS_TEST_PARENT_ONLY"];
    process.env["NIMBUS_TEST_PARENT_ONLY"] = "leak";
    try {
      const e = extensionProcessEnv({ FOO: "bar" });
      expect(e["FOO"]).toBe("bar");
      expect(e["NIMBUS_TEST_PARENT_ONLY"]).toBeUndefined();
    } finally {
      if (prev === undefined) {
        delete process.env["NIMBUS_TEST_PARENT_ONLY"];
      } else {
        process.env["NIMBUS_TEST_PARENT_ONLY"] = prev;
      }
    }
  });
});
