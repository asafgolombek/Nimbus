import type { HostActivity, HostActivityProbe, HostPower } from "../host-activity.ts";
import { UNKNOWN_PROBE } from "../host-activity.ts";

const SPAWN_TIMEOUT_MS = 2_000;

async function run(cmd: string[]): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", windowsHide: true });
    const timer = setTimeout(() => proc.kill(), SPAWN_TIMEOUT_MS);
    const text = await new Response(proc.stdout).text();
    clearTimeout(timer);
    return (await proc.exited) === 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export function parseDarwinPower(pmsetOut: string): HostPower {
  if (/Now drawing from 'AC Power'/i.test(pmsetOut)) return "ac";
  if (/Now drawing from 'Battery Power'/i.test(pmsetOut)) return "battery";
  return "unknown";
}

/** `HIDIdleTime` is in NANOseconds. Missing or unparseable means unmeasurable, not zero. */
export function parseDarwinIdleMs(ioregOut: string): number | null {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(ioregOut);
  if (m?.[1] === undefined) return null;
  const ns = Number(m[1]);
  return Number.isFinite(ns) ? Math.floor(ns / 1_000_000) : null;
}

export function createDarwinHostActivity(): HostActivity {
  return {
    probe: async (): Promise<HostActivityProbe> => {
      const pmset = await run(["pmset", "-g", "batt"]);
      if (pmset === undefined) return UNKNOWN_PROBE;
      const power = parseDarwinPower(pmset);
      const ioreg = await run(["ioreg", "-c", "IOHIDSystem", "-d", "1"]);
      const idleMs = ioreg === undefined ? null : parseDarwinIdleMs(ioreg);
      return { power, idleMs, source: idleMs === null ? "power_only" : "measured" };
    },
  };
}
