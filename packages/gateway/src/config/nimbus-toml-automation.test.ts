import { describe, expect, test } from "bun:test";
import { DEFAULT_NIMBUS_AUTOMATION_TOML, parseNimbusAutomationToml } from "./nimbus-toml.ts";

describe("parseNimbusAutomationToml", () => {
  test("returns defaults when [automation] absent", () => {
    expect(parseNimbusAutomationToml("")).toEqual(DEFAULT_NIMBUS_AUTOMATION_TOML);
  });

  test("defaults graph_conditions to true (Section 2 ships enabled for v0.1.0)", () => {
    expect(DEFAULT_NIMBUS_AUTOMATION_TOML.graphConditions).toBe(true);
  });

  test("parses graph_conditions = false", () => {
    const toml = `
[automation]
graph_conditions = false
`;
    const out = parseNimbusAutomationToml(toml);
    expect(out.graphConditions).toBe(false);
  });

  test("parses graph_conditions = true", () => {
    const toml = `
[automation]
graph_conditions = true
`;
    const out = parseNimbusAutomationToml(toml);
    expect(out.graphConditions).toBe(true);
  });

  test("ignores unknown keys in [automation]", () => {
    const toml = `
[automation]
unknown_key = "whatever"
graph_conditions = false
`;
    const out = parseNimbusAutomationToml(toml);
    expect(out.graphConditions).toBe(false);
  });

  test("ignores [automation] keys outside the section", () => {
    const toml = `
[other]
graph_conditions = false
[automation]
`;
    const out = parseNimbusAutomationToml(toml);
    expect(out).toEqual(DEFAULT_NIMBUS_AUTOMATION_TOML);
  });
});
