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

  test("output includes PATH baseline var from process.env", () => {
    const e = extensionProcessEnv({});
    expect(e["PATH"]).toBe(process.env["PATH"]);
  });

  test("output excludes ANTHROPIC_API_KEY even when set in process.env", () => {
    const prev = process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "sk-test-secret";
    try {
      const e = extensionProcessEnv({});
      expect(e["ANTHROPIC_API_KEY"]).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env["ANTHROPIC_API_KEY"];
      else process.env["ANTHROPIC_API_KEY"] = prev;
    }
  });

  test("output excludes NIMBUS_DEV_UPDATER_PUBLIC_KEY even when set in process.env", () => {
    const prev = process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"];
    process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"] = "base64keyoverride";
    try {
      const e = extensionProcessEnv({});
      expect(e["NIMBUS_DEV_UPDATER_PUBLIC_KEY"]).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"];
      else process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"] = prev;
    }
  });
});
