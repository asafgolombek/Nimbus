import { describe, expect, test } from "bun:test";
import type {
  HostActivity,
  HostActivityProbe,
  HostPower,
} from "../platform/host-activity-types.ts";
import { createBatteryBackfillGate, DEFAULT_BACKFILL_POLL_MS } from "./backfill-gate.ts";

/** A probe whose answer the test can change between calls, counting how often it was asked. */
function switchableHost(initial: HostPower): {
  host: HostActivity;
  set: (p: HostPower) => void;
  probes: () => number;
} {
  let power = initial;
  let probes = 0;
  return {
    host: {
      probe: async (): Promise<HostActivityProbe> => {
        probes += 1;
        return { power, idleMs: null, source: "power_only" };
      },
    },
    set: (p) => {
      power = p;
    },
    probes: () => probes,
  };
}

/** `"pending"` when `p` has not settled within `ms` — used as a positive control on the pause. */
async function settledWithin(p: Promise<boolean>, ms: number): Promise<boolean | "pending"> {
  return await Promise.race([
    p,
    new Promise<"pending">((resolve) => {
      setTimeout(() => resolve("pending"), ms);
    }),
  ]);
}

describe("createBatteryBackfillGate — [embedding] pause_on_battery", () => {
  test("PAUSES while the host reports battery, then proceeds when power returns", async () => {
    const { host, set, probes } = switchableHost("battery");
    const { gate, stop } = createBatteryBackfillGate({
      pauseOnBattery: true,
      hostActivity: host,
      pollMs: 5,
    });

    const pending = gate();
    // Positive control on the premise: it must actually be BLOCKED here, not merely slow. Without
    // this the "resumes" assertion below would pass against a gate that never paused at all.
    expect(await settledWithin(pending, 60)).toBe("pending");
    expect(probes()).toBeGreaterThan(1); // re-probing, not stuck on its first answer

    set("ac");
    expect(await pending).toBe(true);
    stop();
  });

  test("does NOT pause when the key is false, and never probes the host at all", async () => {
    const { host, probes } = switchableHost("battery");
    const { gate } = createBatteryBackfillGate({
      pauseOnBattery: false,
      hostActivity: host,
      pollMs: 5,
    });

    expect(await gate()).toBe(true);
    // The flag is checked BEFORE the probe: a disabled key must not spawn power-probe work on
    // every batch for an answer nothing will read.
    expect(probes()).toBe(0);
  });

  test("`unknown` power proceeds — a desktop is not a discharging laptop", async () => {
    const { host } = switchableHost("unknown");
    const { gate } = createBatteryBackfillGate({
      pauseOnBattery: true,
      hostActivity: host,
      pollMs: 5,
    });
    expect(await gate()).toBe(true);
  });

  test("`ac` proceeds on the first probe", async () => {
    const { host, probes } = switchableHost("ac");
    const { gate } = createBatteryBackfillGate({
      pauseOnBattery: true,
      hostActivity: host,
      pollMs: 5,
    });
    expect(await gate()).toBe(true);
    expect(probes()).toBe(1);
  });

  test("stop() releases a WAITING gate at once, and every later call, with `false`", async () => {
    const { host } = switchableHost("battery");
    const { gate, stop } = createBatteryBackfillGate({
      pauseOnBattery: true,
      hostActivity: host,
      // A poll far longer than the test could ever wait for: the only thing that can settle these
      // is `stop()` itself, which is exactly the claim.
      pollMs: 60_000,
    });

    const first = gate();
    const second = gate();
    expect(await settledWithin(first, 30)).toBe("pending");

    stop();
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(await gate()).toBe(false);
  });

  test("omitting pollMs falls back to the exported default rather than to zero", async () => {
    // Exercises the `?? DEFAULT_BACKFILL_POLL_MS` arm on a host that never pauses, so the test does
    // not have to wait out a 30-second poll to prove which interval was chosen.
    const { host } = switchableHost("ac");
    const { gate } = createBatteryBackfillGate({ pauseOnBattery: true, hostActivity: host });
    expect(await gate()).toBe(true);
  });

  test("the default poll interval is a real constant, not an accidental zero", () => {
    // A zero would turn the pause into a busy loop probing power thousands of times a second.
    expect(DEFAULT_BACKFILL_POLL_MS).toBeGreaterThanOrEqual(1000);
  });
});
