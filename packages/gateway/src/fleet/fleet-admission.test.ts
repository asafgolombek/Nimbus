import { expect, test } from "bun:test";
import type { FleetAdmissionConfig } from "./fleet-admission.ts";
import { admitFleetRun } from "./fleet-admission.ts";

const CONFIG: FleetAdmissionConfig = { requireAcPower: true, minIdleSeconds: 900 };

test("on battery with AC required: refused", () => {
  const v = admitFleetRun({ power: "battery", idleMs: 1_200_000, source: "measured" }, CONFIG);
  expect(v).toEqual({ admitted: false, reason: "on_battery" });
});

test("on battery when AC is not required: admitted", () => {
  const v = admitFleetRun(
    { power: "battery", idleMs: 1_200_000, source: "measured" },
    { ...CONFIG, requireAcPower: false },
  );
  expect(v.admitted).toBe(true);
});

test("AC but the user is active: refused", () => {
  const v = admitFleetRun({ power: "ac", idleMs: 300_000, source: "measured" }, CONFIG);
  expect(v).toEqual({ admitted: false, reason: "user_active" });
});

test("AC and idle past the threshold: admitted", () => {
  expect(
    admitFleetRun({ power: "ac", idleMs: 1_200_000, source: "measured" }, CONFIG).admitted,
  ).toBe(true);
});

test("exactly at the threshold admits — the boundary is inclusive", () => {
  // 900 s * 1000. `<` rather than `<=` is deliberate: a host that has been idle for precisely the
  // configured minimum has met the condition the owner wrote.
  expect(admitFleetRun({ power: "ac", idleMs: 900_000, source: "measured" }, CONFIG).admitted).toBe(
    true,
  );
  expect(admitFleetRun({ power: "ac", idleMs: 899_999, source: "measured" }, CONFIG).admitted).toBe(
    false,
  );
});

test("unknown power admits — a desktop or server has no battery to report", () => {
  // The predicate blocks on `battery`, it does not require `ac`. Requiring `ac` would refuse on
  // exactly the hardware this feature is for, and would fail SILENTLY as a fleet that never runs.
  expect(
    admitFleetRun({ power: "unknown", idleMs: null, source: "power_only" }, CONFIG).admitted,
  ).toBe(true);
});

test("unknown power does NOT admit a demonstrably active user — idle still decides", () => {
  // Guards the inverse defect of the one above: `power === "battery"` must be the ONLY power-based
  // refusal, but an `unknown` host must still lose to a measured idle signal below the threshold.
  const v = admitFleetRun({ power: "unknown", idleMs: 10_000, source: "measured" }, CONFIG);
  expect(v).toEqual({ admitted: false, reason: "user_active" });
});

test("an unmeasurable idle signal admits rather than blocking headless Linux", () => {
  expect(admitFleetRun({ power: "ac", idleMs: null, source: "power_only" }, CONFIG).admitted).toBe(
    true,
  );
});

test("a battery refusal outranks an idle refusal — the reason names the durable condition", () => {
  // Both conditions hold. `on_battery` is the one the owner can act on and the one that persists;
  // reporting `user_active` for a laptop on battery would send them to the wrong setting.
  const v = admitFleetRun({ power: "battery", idleMs: 1_000, source: "measured" }, CONFIG);
  expect(v).toEqual({ admitted: false, reason: "on_battery" });
});
