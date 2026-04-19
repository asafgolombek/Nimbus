import { describe, expect, test } from "bun:test";
import { DEFAULT_NIMBUS_UPDATER_TOML, parseNimbusUpdaterToml } from "./nimbus-toml.ts";

describe("parseNimbusUpdaterToml", () => {
  test("returns defaults when [updater] absent", () => {
    expect(parseNimbusUpdaterToml("")).toEqual(DEFAULT_NIMBUS_UPDATER_TOML);
  });

  test("parses overrides", () => {
    const toml = `
[updater]
enabled = false
url = "https://example.com/manifest.json"
check_on_startup = false
auto_apply = false
`;
    const out = parseNimbusUpdaterToml(toml);
    expect(out.enabled).toBe(false);
    expect(out.url).toBe("https://example.com/manifest.json");
    expect(out.checkOnStartup).toBe(false);
  });

  test("NIMBUS_UPDATER_DISABLE=1 env overrides to disabled", () => {
    const prev = process.env["NIMBUS_UPDATER_DISABLE"];
    process.env["NIMBUS_UPDATER_DISABLE"] = "1";
    try {
      const out = parseNimbusUpdaterToml(`[updater]\nenabled = true`);
      expect(out.enabled).toBe(false);
    } finally {
      if (prev === undefined) delete process.env["NIMBUS_UPDATER_DISABLE"];
      else process.env["NIMBUS_UPDATER_DISABLE"] = prev;
    }
  });
});
