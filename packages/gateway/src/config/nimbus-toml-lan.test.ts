import { describe, expect, test } from "bun:test";
import { DEFAULT_NIMBUS_LAN_TOML, parseNimbusLanToml } from "./nimbus-toml.ts";

describe("parseNimbusLanToml", () => {
  test("returns defaults when [lan] absent", () => {
    expect(parseNimbusLanToml("")).toEqual(DEFAULT_NIMBUS_LAN_TOML);
  });

  test("parses overrides", () => {
    const toml = `
[lan]
enabled = true
port = 9999
bind = "127.0.0.1"
pairing_window_seconds = 10
max_failed_attempts = 2
lockout_seconds = 5
`;
    const out = parseNimbusLanToml(toml);
    expect(out.enabled).toBe(true);
    expect(out.port).toBe(9999);
    expect(out.bind).toBe("127.0.0.1");
    expect(out.pairingWindowSeconds).toBe(10);
  });

  test("NIMBUS_LAN_PORT env overrides port", () => {
    const prev = process.env["NIMBUS_LAN_PORT"];
    process.env["NIMBUS_LAN_PORT"] = "12345";
    try {
      const out = parseNimbusLanToml("[lan]\nport = 7475\n");
      expect(out.port).toBe(12345);
    } finally {
      if (prev === undefined) delete process.env["NIMBUS_LAN_PORT"];
      else process.env["NIMBUS_LAN_PORT"] = prev;
    }
  });

  test("DEFAULT_NIMBUS_LAN_TOML bind is loopback, not all-interfaces", () => {
    expect(DEFAULT_NIMBUS_LAN_TOML.bind).toBe("127.0.0.1");
  });
});
