import { existsSync, readFileSync } from "node:fs";
import {
  isTableHeader,
  parseBool,
  parseIntDec,
  parseString,
  splitKeyValue,
  stripComment,
} from "./toml-primitives.ts";

export interface NimbusFleetToml {
  readonly enabled: boolean;
  readonly allowRemote: boolean;
  readonly remoteCallBudget: number;
  readonly minIdleSeconds: number;
  readonly requireAcPower: boolean;
  readonly retentionDays: number;
}

export type FleetJobParamValue = string | number;

export interface NimbusFleetJobToml {
  readonly name: string;
  readonly agent: string;
  readonly intervalSeconds: number;
  readonly params: Readonly<Record<string, FleetJobParamValue>>;
}

export const DEFAULT_FLEET_CONFIG: NimbusFleetToml = Object.freeze({
  enabled: false,
  allowRemote: false,
  remoteCallBudget: 0,
  minIdleSeconds: 900,
  requireAcPower: true,
  retentionDays: 14,
});

export class FleetConfigError extends Error {}

/** `since_ms` → `sinceMs`. Flat keys only: the parser has no inline-table support. */
function camel(key: string): string {
  return key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

const JOB_RESERVED = new Set(["name", "agent", "interval_seconds"]);

export function parseNimbusTomlFleet(source: string): NimbusFleetToml {
  const out: Record<string, boolean | number> = {};
  let inSection = false;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") continue;
    if (isTableHeader(trimmed)) {
      inSection = trimmed === "[fleet]";
      continue;
    }
    if (!inSection) continue;
    const kv = splitKeyValue(trimmed);
    if (kv === undefined) continue;
    switch (kv.key) {
      case "enabled":
      case "allow_remote":
      case "require_ac_power": {
        const b = parseBool(kv.valRaw);
        if (b !== undefined) out[camel(kv.key)] = b;
        break;
      }
      case "remote_call_budget":
      case "min_idle_seconds":
      case "retention_days": {
        const n = parseIntDec(kv.valRaw);
        if (n !== undefined && n >= 0) out[camel(kv.key)] = n;
        break;
      }
      default:
        break;
    }
  }

  const config: NimbusFleetToml = { ...DEFAULT_FLEET_CONFIG, ...out };
  // Refused rather than silently corrected: `allow_remote` with no budget reads as permission, and
  // shipping it as an unbounded or zero-call grant are both wrong answers to a question the owner
  // clearly meant to answer.
  if (config.allowRemote && config.remoteCallBudget <= 0) {
    throw new FleetConfigError(
      "[fleet] allow_remote = true requires remote_call_budget > 0 (an unbounded overnight " +
        "remote grant must not be expressible)",
    );
  }
  return config;
}

export function parseNimbusTomlFleetJobs(source: string): NimbusFleetJobToml[] {
  const jobs: NimbusFleetJobToml[] = [];
  const seen = new Set<string>();
  let cur:
    | {
        name?: string;
        agent?: string;
        intervalSeconds?: number;
        params: Record<string, FleetJobParamValue>;
      }
    | undefined;

  const flush = (): void => {
    if (cur === undefined) return;
    const { name, agent, intervalSeconds, params } = cur;
    cur = undefined;
    // A block with nothing in it is not a job; an INCOMPLETE one is a job the owner meant to
    // configure. Refuse the second rather than dropping it (they would believe it runs) or
    // defaulting it (a schedule they did not choose).
    if (name === undefined && agent === undefined && intervalSeconds === undefined) return;
    if (name === undefined) throw new FleetConfigError("[[fleet.job]] requires name");
    if (agent === undefined) throw new FleetConfigError(`[[fleet.job]] ${name} requires agent`);
    if (intervalSeconds === undefined || intervalSeconds <= 0) {
      throw new FleetConfigError(`[[fleet.job]] ${name} requires interval_seconds > 0`);
    }
    if (seen.has(name)) {
      throw new FleetConfigError(`[[fleet.job]] duplicate name: ${name}`);
    }
    seen.add(name);
    jobs.push({ name, agent, intervalSeconds, params });
  };

  for (const line of source.split(/\r?\n/)) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") continue;
    if (isTableHeader(trimmed)) {
      flush();
      if (trimmed === "[[fleet.job]]") cur = { params: {} };
      continue;
    }
    if (cur === undefined) continue;
    const kv = splitKeyValue(trimmed);
    if (kv === undefined) continue;
    if (kv.key === "name") cur.name = parseString(kv.valRaw);
    else if (kv.key === "agent") cur.agent = parseString(kv.valRaw);
    else if (kv.key === "interval_seconds") {
      const n = parseIntDec(kv.valRaw);
      if (n !== undefined) cur.intervalSeconds = n;
    } else if (!JOB_RESERVED.has(kv.key)) {
      const n = parseIntDec(kv.valRaw);
      cur.params[camel(kv.key)] = n === undefined ? parseString(kv.valRaw) : n;
    }
  }
  flush();
  return jobs;
}

/**
 * Takes a PATH, not a config dir — and there is deliberately no `…FromConfigDir` variant.
 *
 * `config/nimbus-toml.ts`'s `loadNimbusAgentsFromPath` carries the reason in its own comment: the
 * former `loadNimbusAgentsFromConfigDir` hardcoded `nimbus.toml`, was therefore profile-BLIND, and
 * silently discarded `[agents] synthesis` set in a profile TOML. That variant was DELETED rather
 * than left exported beside the profile-aware one "for someone to reach for by accident". Exporting
 * a config-dir loader here would be reaching for it.
 *
 * Callers pass `resolveNimbusTomlForProfile(configDir)`.
 *
 * A malformed block THROWS rather than falling back to defaults. The CALLER
 * (`platform/assemble.ts`) catches, logs loudly and constructs no scheduler — so the gateway still
 * boots and the fleet is off. Crashing boot over an optional, default-off feature is
 * disproportionate; silently running a half-read config is worse.
 */
export function loadNimbusFleetFromPath(tomlPath: string): {
  config: NimbusFleetToml;
  jobs: NimbusFleetJobToml[];
} {
  if (!existsSync(tomlPath)) return { config: DEFAULT_FLEET_CONFIG, jobs: [] };
  const raw = readFileSync(tomlPath, "utf8");
  return { config: parseNimbusTomlFleet(raw), jobs: parseNimbusTomlFleetJobs(raw) };
}

export { parseBool };
