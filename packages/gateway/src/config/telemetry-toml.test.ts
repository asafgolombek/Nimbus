import { describe, expect, test } from "bun:test";

import { parseNimbusTomlTelemetrySection } from "./telemetry-toml.ts";

describe("parseNimbusTomlTelemetrySection", () => {
  test("parses telemetry block", () => {
    const raw = `
[telemetry]
enabled = true
endpoint = "https://example.com/ingest"
flush_interval_seconds = 120
`;
    const p = parseNimbusTomlTelemetrySection(raw);
    expect(p.enabled).toBe(true);
    expect(p.endpoint).toBe("https://example.com/ingest");
    expect(p.flushIntervalSeconds).toBe(120);
  });
});
