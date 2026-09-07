import type { HostActivityProbe } from "../platform/host-activity.ts";

export interface FleetAdmissionConfig {
  readonly requireAcPower: boolean;
  readonly minIdleSeconds: number;
}

export type AdmissionRefusalReason = "on_battery" | "user_active";

export type AdmissionVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: AdmissionRefusalReason };

/**
 * Blocks on `battery`; does NOT require `ac`.
 *
 * A desktop, a VM or a server answers `unknown` because it has no battery to report. A predicate
 * written `power === "ac"` would refuse to admit on exactly the always-on hardware this feature
 * targets, and the failure would be silent: a fleet that simply never runs, with nothing in any
 * log saying why.
 *
 * A `null` idle signal admits and is disclosed upstream as `host_source: "power_only"`. Refusing
 * instead would make the feature inert on headless Linux — the platform most likely to have
 * genuinely idle compute. The run row records `host_source` either way, so a brief produced
 * without a measured idle signal never claims a check that was not performed.
 */
export function admitFleetRun(
  probe: HostActivityProbe,
  config: FleetAdmissionConfig,
): AdmissionVerdict {
  if (config.requireAcPower && probe.power === "battery") {
    return { admitted: false, reason: "on_battery" };
  }
  if (probe.idleMs !== null && probe.idleMs < config.minIdleSeconds * 1000) {
    return { admitted: false, reason: "user_active" };
  }
  return { admitted: true };
}
