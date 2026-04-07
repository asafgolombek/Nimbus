import { describe, expect, test } from "bun:test";
import { ENGINE_SUBSYSTEM_ID } from "./index.ts";

describe("engine subsystem", () => {
  test("exports stable subsystem id", () => {
    expect(ENGINE_SUBSYSTEM_ID).toBe("nimbus-engine");
  });
});
