import { platform } from "node:os";

/** Mains state. `unknown` is a real answer — a desktop or VM has no battery to report. */
export type HostPower = "ac" | "battery" | "unknown";

/**
 * How much of a probe is real. `power_only` means user-idle could not be measured on this host
 * (headless Linux, a CI runner with no HID) — the fleet still admits, and says so. It never
 * claims a check it did not perform.
 */
export type HostProbeSource = "measured" | "power_only";

export interface HostActivityProbe {
  readonly power: HostPower;
  /** Milliseconds since last user input, or null when genuinely unmeasurable. */
  readonly idleMs: number | null;
  readonly source: HostProbeSource;
}

export interface HostActivity {
  probe(): Promise<HostActivityProbe>;
}

/** The probe returned when a backend cannot answer at all. Never throws upward. */
export const UNKNOWN_PROBE: HostActivityProbe = Object.freeze({
  power: "unknown",
  idleMs: null,
  source: "power_only",
});

/**
 * A shared stub for tests/fixtures that need a `HostActivity` value but do not exercise it.
 * `hostActivity` is a required `PlatformServices` member (never optional — an omitted field must
 * fail typecheck, not go silently inert), so every literal that predates this feature needs one of
 * these to keep compiling.
 */
export const UNKNOWN_HOST_ACTIVITY: HostActivity = {
  probe: async (): Promise<HostActivityProbe> => UNKNOWN_PROBE,
};

/**
 * Each platform answers for its own mechanism, so this knowledge stays in the PAL rather than
 * leaking a `process.platform` branch into the scheduler — the same shape as
 * `platform/sandbox/sandbox-runner.ts`'s `createSandboxRunner`.
 */
export async function createHostActivity(): Promise<HostActivity> {
  switch (platform()) {
    case "linux":
      return (await import("./host-activity/linux.ts")).createLinuxHostActivity();
    case "darwin":
      return (await import("./host-activity/darwin.ts")).createDarwinHostActivity();
    case "win32":
      return (await import("./host-activity/win32.ts")).createWin32HostActivity();
    default:
      return { probe: async (): Promise<HostActivityProbe> => UNKNOWN_PROBE };
  }
}
