import { expect, test } from "bun:test";
import { parseDarwinIdleMs, parseDarwinPower } from "./host-activity/darwin.ts";
import { idleMsFromTicks, powerFromAcLineStatus } from "./host-activity/win32.ts";
import { createHostActivity } from "./host-activity.ts";

test("the real backend for THIS platform returns a well-formed probe", async () => {
  const probe = await (await createHostActivity()).probe();
  expect(["ac", "battery", "unknown"]).toContain(probe.power);
  expect(probe.idleMs === null || probe.idleMs >= 0).toBe(true);
  // The contract that matters: an unmeasured idle must be disclosed, never dressed as measured.
  expect(probe.source).toBe(probe.idleMs === null ? "power_only" : "measured");
});

test("windows tick arithmetic survives the 49.7-day wrap", () => {
  // tick has wrapped to 5; last input was 10 ms before the wrap at 0xFFFFFFFF.
  expect(idleMsFromTicks(5, 0xffffffff - 9)).toBe(15);
  expect(idleMsFromTicks(1000, 400)).toBe(600);
});

test("ACLineStatus maps 0/1/255", () => {
  expect(powerFromAcLineStatus(0)).toBe("battery");
  expect(powerFromAcLineStatus(1)).toBe("ac");
  expect(powerFromAcLineStatus(255)).toBe("unknown");
});

test("darwin parsers handle present and absent signals", () => {
  expect(parseDarwinPower("Now drawing from 'AC Power'")).toBe("ac");
  expect(parseDarwinPower("Now drawing from 'Battery Power'")).toBe("battery");
  expect(parseDarwinPower("")).toBe("unknown");
  expect(parseDarwinIdleMs('"HIDIdleTime" = 5000000000')).toBe(5000);
  expect(parseDarwinIdleMs("no such key")).toBeNull();
});
