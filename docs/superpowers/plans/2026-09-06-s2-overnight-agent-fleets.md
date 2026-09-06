# Overnight Sub-Agent Fleets (S2, PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a configured set of the existing read-only agents on a schedule, only while the host
is genuinely idle, and persist the briefs so the morning read is instant.

**Architecture:** A new `packages/gateway/src/fleet/` subsystem reaches agents through the existing
`dispatchAgentsRpc` seam (never importing an emitter — D22(d) forbids it), under a new derived
`ClientKind: "fleet"`. A new `HostActivity` PAL capability decides when it may run. A decorator over
`SynthesisRouter` enforces invariant I38 (no remote model without `[fleet] allow_remote` and budget).
Durable state lands in three V60 tables.

**Tech Stack:** Bun v1.2+, TypeScript strict (no `any`), `bun:sqlite`, Biome, `bun test`.

**Spec:** [`docs/superpowers/specs/2026-09-06-s2-overnight-agent-fleets-design.md`](../specs/2026-09-06-s2-overnight-agent-fleets-design.md)
— read it before Task 1. The review folded into it is
[`…-design-review.md`](../specs/2026-09-06-s2-overnight-agent-fleets-design-review.md).

**Reviewed 2026-09-06** — [`…-review.md`](./2026-09-06-s2-overnight-agent-fleets-review.md).
Four real bugs in the first draft are fixed here: no due/interval check (every job would have run
every 60 seconds), no re-entrancy guard (a run outlasting a tick would overlap itself), `getBrief`
written as a 1,000-row scan, and no `jobName` targeting for `nimbus fleet run <job>`. Plus a
profile-blind config loader, an unregistered teardown callback, a per-probe `dlopen` handle leak,
and unbounded `fleet_run` growth. One recommendation was NOT taken as written — see Task 3 on
`interval_seconds`.

## Global Constraints

Every task's requirements implicitly include these.

- **No `any`.** External/JSON data is `unknown` plus a real type guard, never `as`.
- **Default OFF.** `[fleet] enabled = false` and `[fleet] allow_remote = false`. A gateway with no
  `[fleet]` block behaves exactly as today.
- **Refusal ordering (mirrors I33).** Local config disabled → org policy disabled → everything else.
  Both before any work, so a disabled capability never advertises itself.
- **Platform equality (non-negotiable #5).** Windows, macOS and Linux each get defined, tested
  behaviour. A missing signal degrades and is disclosed; it never silently pretends.
- **PAL discipline.** Never import `platform/win32.ts` / `darwin.ts` / `linux.ts` from business
  logic. OS branching lives behind a factory, as `platform/sandbox/sandbox-runner.ts` does it.
- **Cross-platform paths.** `path.join()` / `os.tmpdir()`, never hardcoded separators.
- **`windowsHide: true`** on every `Bun.spawn`, and tests assert the **value**, not the token.
- **Triple rule.** I38's wiring, its `docs/SECURITY-INVARIANTS.md` row and its enforcement test land
  in the SAME commit (Task 11). Same for static rule D28.
- **Preflight before pushing:** `bun run preflight:fast` after every task; `bun run preflight`
  before opening the PR.
- **Branch:** work on `dev/asaf/s2-overnight-agent-fleets`. Never commit on `main`.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `packages/gateway/src/platform/host-activity.ts` | `HostActivity` types + the per-OS factory. |
| `packages/gateway/src/platform/host-activity/{linux,darwin,win32}.ts` | One backend each. |
| `packages/gateway/src/index/fleet-v60-sql.ts` | V60 DDL. |
| `packages/gateway/src/fleet/fleet-admission.ts` | The pure admission predicate. |
| `packages/gateway/src/fleet/fleet-store.ts` | Sole writer of the V60 tables. |
| `packages/gateway/src/fleet/fleet-synthesis-router.ts` | I38 budget/locality decorator. |
| `packages/gateway/src/fleet/fleet-invoker.ts` | Dispatch one job, await its completion. |
| `packages/gateway/src/fleet/fleet-scheduler.ts` | The loop: due → admit → run → record. |
| `packages/gateway/src/config/fleet-toml.ts` | `[fleet]` + `[[fleet.job]]` parsing. |
| `packages/cli/src/commands/fleet.ts` | `nimbus fleet` CLI. |

**Modified**

| File | Change |
|---|---|
| `packages/gateway/src/ipc/server/client-kind.ts` | Add `"fleet"` to `ClientKind`, NOT to `RECOGNISED`. |
| `packages/gateway/src/egress/egress-bearing-kinds.ts` | Add `fleet: null` with its reasoning. |
| `packages/gateway/src/ipc/agents-rpc.ts` | `AgentMethod` type export, `FLEET_ELIGIBILITY`, `resolveFleetAgentMethod`. |
| `packages/gateway/src/config/toml-primitives.ts` | Promote `parseBool` (three private copies today). |
| `packages/gateway/src/index/migrations/runner.ts` | Register V60. |
| `packages/gateway/src/policy/types.ts` | `agent_fleet` → `AI_V2_CAPABILITIES`. |
| `packages/gateway/src/platform/types.ts` | `hostActivity` on `PlatformServices`. |
| `packages/gateway/src/platform/assemble.ts` | Construct + wire the scheduler and probe. |
| `packages/gateway/src/ipc/lan-rpc.ts` | `"fleet"` → `FORBIDDEN_OVER_LAN`. |
| `packages/gateway/src/embedding/create-embedding-runtime.ts` | Wire the dead `pause_on_battery`. |
| `packages/cli/src/index.ts` | Register `fleet: runFleet`. |
| `scripts/structure-audit/check-nimbus-invariants.ts` | D28. |
| `packages/gateway/src/security-invariants.test.ts` | I38. |
| `docs/SECURITY-INVARIANTS.md`, `docs/roadmap.md`, `docs/CHANGELOG.md`, `CLAUDE.md`, `GEMINI.md` | I38/D28/V60, S2 row. |

---

### Task 1: `HostActivity` PAL capability

The probe every later task depends on. Build it first so the scheduler has something real to ask.

**Files:**

- Create: `packages/gateway/src/platform/host-activity.ts`
- Create: `packages/gateway/src/platform/host-activity/{linux,darwin,win32}.ts`
- Test: `packages/gateway/src/platform/host-activity.test.ts`
- Test: `packages/gateway/src/platform/host-activity/linux.test.ts`
- Modify: `packages/gateway/src/platform/types.ts` (add `hostActivity: HostActivity`)

**Interfaces:**

- Consumes: nothing.
- Produces: `HostPower`, `HostProbeSource`, `HostActivityProbe`, `HostActivity`,
  `createHostActivity(): Promise<HostActivity>`, and per-OS
  `createLinuxHostActivity(root?: string)`, `createDarwinHostActivity()`,
  `createWin32HostActivity()`.

- [ ] **Step 1: Write the failing test for the Linux power scan**

`linux.test.ts` — the backend takes a `root` so a temp dir can stand in for `/sys/class/power_supply`.
That is what makes this testable on any OS, and it is why the parameter exists.

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLinuxHostActivity } from "./linux.ts";

function supplyRoot(entries: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "nimbus-power-"));
  for (const [name, files] of Object.entries(entries)) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    for (const [f, v] of Object.entries(files)) writeFileSync(join(dir, f), `${v}\n`);
  }
  return root;
}

describe("createLinuxHostActivity power scan", () => {
  test("ADP1 online reads as ac — a bare AC* glob would miss this name", async () => {
    const root = supplyRoot({ ADP1: { type: "Mains", online: "1" } });
    expect((await createLinuxHostActivity(root).probe()).power).toBe("ac");
  });

  test("a discharging battery wins over an online adapter", async () => {
    const root = supplyRoot({
      ACAD: { type: "Mains", online: "1" },
      BAT0: { type: "Battery", status: "Discharging" },
    });
    expect((await createLinuxHostActivity(root).probe()).power).toBe("battery");
  });

  test("a charging battery beside an online adapter is ac", async () => {
    const root = supplyRoot({
      AC: { type: "Mains", online: "1" },
      BAT0: { type: "Battery", status: "Charging" },
    });
    expect((await createLinuxHostActivity(root).probe()).power).toBe("ac");
  });

  test("a missing directory is unknown, never a throw", async () => {
    const probe = await createLinuxHostActivity(join(tmpdir(), "nimbus-absent-power")).probe();
    expect(probe.power).toBe("unknown");
    expect(probe.idleMs).toBeNull();
    expect(probe.source).toBe("power_only");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test packages/gateway/src/platform/host-activity/linux.test.ts`
Expected: FAIL — `Cannot find module './linux.ts'`.

- [ ] **Step 3: Write `host-activity.ts` (types + factory)**

```ts
// packages/gateway/src/platform/host-activity.ts
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
```

- [ ] **Step 4: Write the Linux backend**

```ts
// packages/gateway/src/platform/host-activity/linux.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostActivity, HostActivityProbe, HostPower } from "../host-activity.ts";
import { UNKNOWN_PROBE } from "../host-activity.ts";

const DEFAULT_ROOT = "/sys/class/power_supply";
const MAINS_TYPES = new Set(["mains", "ac"]);

function read(dir: string, file: string): string | undefined {
  try {
    return readFileSync(join(dir, file), "utf8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Scans every supply entry rather than globbing `AC*`. Mains adapters are named `ADP1`, `ACAD`,
 * `AC`, `Mains` and more depending on distribution and hardware, and a glob that misses the name
 * reports `unknown` forever on a machine that knows perfectly well it is plugged in.
 *
 * `root` is injectable so the scan is testable on any OS without a real sysfs.
 */
export function createLinuxHostActivity(root: string = DEFAULT_ROOT): HostActivity {
  return {
    probe: async (): Promise<HostActivityProbe> => {
      let names: string[];
      try {
        names = readdirSync(root);
      } catch {
        return UNKNOWN_PROBE;
      }

      let sawOnlineMains = false;
      for (const name of names) {
        const dir = join(root, name);
        const type = read(dir, "type")?.toLowerCase();
        if (type === "battery" && read(dir, "status")?.toLowerCase() === "discharging") {
          // A discharging battery is decisive: the machine is running down regardless of what
          // any adapter claims.
          return { power: "battery", idleMs: null, source: "power_only" };
        }
        if (type !== undefined && MAINS_TYPES.has(type) && read(dir, "online") === "1") {
          sawOnlineMains = true;
        }
      }

      const power: HostPower = sawOnlineMains ? "ac" : "unknown";
      // Idle is deliberately unmeasured on Linux: X11, Wayland and headless each answer
      // differently and a server has no session to be idle from. Stated, not faked.
      return { power, idleMs: null, source: "power_only" };
    },
  };
}
```

- [ ] **Step 5: Run the Linux tests**

Run: `bun test packages/gateway/src/platform/host-activity/linux.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the macOS backend**

`pmset` and `ioreg` are spawned, never FFI'd. `windowsHide` is set even here — the option is inert
on darwin, and setting it unconditionally means nobody has to remember which spawns are
Windows-reachable.

```ts
// packages/gateway/src/platform/host-activity/darwin.ts
import type { HostActivity, HostActivityProbe, HostPower } from "../host-activity.ts";
import { UNKNOWN_PROBE } from "../host-activity.ts";

const SPAWN_TIMEOUT_MS = 2_000;

async function run(cmd: readonly string[]): Promise<string | undefined> {
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
```

- [ ] **Step 7: Write the Windows backend**

The one place FFI is used, because `GetSystemPowerStatus` and `GetLastInputInfo` have no file
equivalent. Both return in microseconds, so the event-loop freeze that makes `bun:ffi` dangerous for
long calls does not apply.

```ts
// packages/gateway/src/platform/host-activity/win32.ts
import { dlopen, FFIType, ptr } from "bun:ffi";
import type { HostActivity, HostActivityProbe, HostPower } from "../host-activity.ts";
import { UNKNOWN_PROBE } from "../host-activity.ts";

/**
 * `GetTickCount` and `LASTINPUTINFO.dwTime` are both 32-bit unsigned millisecond counters that
 * wrap every 49.7 days. Signed subtraction goes negative or absurd after a wrap — which would
 * either freeze admission permanently or admit falsely, on exactly the long-uptime workstation
 * this feature targets. `>>> 0` restores unsigned 32-bit semantics.
 */
export function idleMsFromTicks(tick: number, lastInput: number): number {
  return (tick - lastInput) >>> 0;
}

export function powerFromAcLineStatus(status: number): HostPower {
  if (status === 0) return "battery";
  if (status === 1) return "ac";
  return "unknown"; // 255 = unknown, and anything else is not a documented value.
}

/**
 * `dlopen` ONCE at construction, not per probe. The scheduler probes on a 60-second tick and again
 * between every job, so a per-call `dlopen` would re-resolve the symbol tables thousands of times
 * a night and — since nothing ever calls `.close()` on the returned library — accumulate handles
 * for the life of the gateway. That makes it a leak, not just waste.
 *
 * A `dlopen` failure at construction is permanent and returns an always-unknown probe. That is the
 * right shape: if kernel32 cannot be opened once it will not open on the next tick either, and a
 * deterministic answer beats a per-call retry that re-throws forever.
 */
export function createWin32HostActivity(): HostActivity {
  let k32: ReturnType<typeof dlopen> | undefined;
  let u32: ReturnType<typeof dlopen> | undefined;
  try {
    k32 = dlopen("kernel32.dll", {
      GetSystemPowerStatus: { args: [FFIType.ptr], returns: FFIType.i32 },
      GetTickCount: { args: [], returns: FFIType.u32 },
    });
    u32 = dlopen("user32.dll", {
      GetLastInputInfo: { args: [FFIType.ptr], returns: FFIType.i32 },
    });
  } catch {
    return { probe: async (): Promise<HostActivityProbe> => UNKNOWN_PROBE };
  }
  const kernel = k32;
  const user = u32;

  // SYSTEM_POWER_STATUS: 4 BYTEs then 3 DWORDs. Only ACLineStatus (byte 0) is read.
  const sps = new Uint8Array(16);
  // LASTINPUTINFO: { cbSize: DWORD, dwTime: DWORD }. cbSize MUST be set before the call, and is
  // set once here because it never changes. Reused across probes: single-threaded, one call at a
  // time, and the kernel overwrites dwTime on every successful call.
  const lii = new Uint32Array(2);
  lii[0] = 8;

  return {
    probe: async (): Promise<HostActivityProbe> => {
      try {
        const power =
          kernel.symbols.GetSystemPowerStatus(ptr(sps)) === 0
            ? "unknown"
            : powerFromAcLineStatus(sps[0] ?? 255);

        let idleMs: number | null = null;
        if (user.symbols.GetLastInputInfo(ptr(lii)) !== 0) {
          idleMs = idleMsFromTicks(kernel.symbols.GetTickCount(), lii[1] ?? 0);
        }
        return { power, idleMs, source: idleMs === null ? "power_only" : "measured" };
      } catch {
        return UNKNOWN_PROBE;
      }
    },
  };
}
```

- [ ] **Step 8: Write the self-validating cross-platform test**

Not `skipIf`. A platform-skipped test never runs on the author's machine, so CI is its first
execution — and a skip whose condition is silently always-true passes vacuously forever. This
asserts the CONTRACT on whatever OS it runs on, and separately asserts the pure helpers everywhere.

```ts
// packages/gateway/src/platform/host-activity.test.ts
import { expect, test } from "bun:test";
import { createHostActivity } from "./host-activity.ts";
import { idleMsFromTicks, powerFromAcLineStatus } from "./host-activity/win32.ts";
import { parseDarwinIdleMs, parseDarwinPower } from "./host-activity/darwin.ts";

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
```

- [ ] **Step 9: Add `hostActivity` to `PlatformServices`**

In `packages/gateway/src/platform/types.ts`, import the type and add the member:

```ts
  /** Host power/idle state, used by the fleet scheduler and by `[embedding] pause_on_battery`. */
  hostActivity: HostActivity;
```

Then construct it in `platform/assemble.ts` alongside `sandboxRunner`
(`hostActivity: await createHostActivity(),`) and fix every `PlatformServices` literal in tests that
now fails typecheck by supplying a stub `{ probe: async () => UNKNOWN_PROBE }`.

- [ ] **Step 10: Run the suite and typecheck**

Run: `bun test packages/gateway/src/platform && bun run typecheck && bun run typecheck:tests`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/gateway/src/platform
git commit -m "feat(platform): add the HostActivity power and idle probe"
```

---

### Task 2: V60 schema and `FleetStore`

**Files:**

- Create: `packages/gateway/src/index/fleet-v60-sql.ts`
- Create: `packages/gateway/src/fleet/fleet-store.ts`
- Test: `packages/gateway/src/fleet/fleet-store.test.ts`
- Modify: `packages/gateway/src/index/migrations/runner.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `FLEET_V60_SQL`; `FleetStore` with `openRun`, `closeRun`, `recordBrief`,
  `loadJobState`, `recordJobSuccess`, `recordJobFailure`, `listBriefs`, `getBrief`, `pruneBriefs`;
  types `FleetRunOutcome`, `FleetJobState`, `FleetBriefRow`.

- [ ] **Step 1: Write the failing store test**

```ts
// packages/gateway/src/fleet/fleet-store.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { FLEET_V60_SQL } from "../index/fleet-v60-sql.ts";
import { FleetStore } from "./fleet-store.ts";

let db: Database;
let store: FleetStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.exec(FLEET_V60_SQL);
  store = new FleetStore(db);
});

describe("FleetStore", () => {
  test("records a run and its briefs", () => {
    const runId = store.openRun({
      startedAt: 1000,
      hostPower: "ac",
      hostIdleMs: 900_000,
      hostSource: "measured",
      remoteCallBudget: 0,
    });
    store.recordBrief({
      runId,
      jobId: "morning_catchup",
      agentMethod: "agents.catchup",
      briefMarkdown: "# Catchup",
      findingsJson: "{}",
      synthesisJson: null,
      createdAt: 1100,
      expiresAt: 1100 + 86_400_000,
    });
    store.closeRun(runId, {
      endedAt: 2000,
      outcome: "completed",
      jobsAttempted: 1,
      jobsCompleted: 1,
      remoteCallsMade: 0,
    });

    const briefs = store.listBriefs({ limit: 10 });
    expect(briefs).toHaveLength(1);
    expect(briefs[0]?.agentMethod).toBe("agents.catchup");
  });

  test("deleting a run cascades to its briefs — the cascade is live, not decorative", () => {
    const runId = store.openRun({
      startedAt: 1,
      hostPower: "unknown",
      hostIdleMs: null,
      hostSource: "power_only",
      remoteCallBudget: 0,
    });
    store.recordBrief({
      runId,
      jobId: "j",
      agentMethod: "agents.catchup",
      briefMarkdown: "x",
      findingsJson: "{}",
      synthesisJson: null,
      createdAt: 1,
      expiresAt: 2,
    });
    db.run("DELETE FROM fleet_run WHERE id = ?", [runId]);
    expect(store.listBriefs({ limit: 10 })).toHaveLength(0);
  });

  test("failure backoff is exponential and capped at 24h", () => {
    for (let i = 0; i < 8; i++) store.recordJobFailure("j", 0, "boom");
    const state = store.loadJobState("j");
    expect(state?.consecutiveFailures).toBe(8);
    expect(state?.backoffUntil).toBe(24 * 60 * 60 * 1000);
    expect(state?.lastError).toBe("boom");
  });

  test("a success clears the backoff", () => {
    store.recordJobFailure("j", 0, "boom");
    store.recordJobSuccess("j", 500);
    const state = store.loadJobState("j");
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.backoffUntil).toBeNull();
  });

  test("prune removes only expired briefs", () => {
    const runId = store.openRun({
      startedAt: 0,
      hostPower: "ac",
      hostIdleMs: 0,
      hostSource: "measured",
      remoteCallBudget: 0,
    });
    for (const [id, exp] of [
      ["old", 100],
      ["new", 10_000],
    ] as const) {
      store.recordBrief({
        runId,
        jobId: id,
        agentMethod: "agents.catchup",
        briefMarkdown: "x",
        findingsJson: "{}",
        synthesisJson: null,
        createdAt: 0,
        expiresAt: exp,
      });
    }
    expect(store.pruneBriefs(500)).toBe(1);
    expect(store.listBriefs({ limit: 10 })).toHaveLength(1);
  });

  test("getBrief is a point lookup that finds a brief beyond any list page", () => {
    const runId = store.openRun({
      startedAt: 0,
      hostPower: "ac",
      hostIdleMs: 0,
      hostSource: "measured",
      remoteCallBudget: 0,
    });
    let target = "";
    // More than any plausible list limit: a scan-and-find implementation returns undefined here.
    for (let i = 0; i < 1_200; i++) {
      const id = store.recordBrief({
        runId,
        jobId: `j${i}`,
        agentMethod: "agents.catchup",
        briefMarkdown: "x",
        findingsJson: "{}",
        synthesisJson: null,
        createdAt: i,
        expiresAt: 10_000_000,
      });
      if (i === 0) target = id; // the OLDEST, so it sorts last by created_at DESC
    }
    expect(store.getBrief(target)?.jobId).toBe("j0");
    expect(store.getBrief("no-such-id")).toBeUndefined();
  });

  test("pruning a run cascades its briefs away", () => {
    const runId = store.openRun({
      startedAt: 100,
      hostPower: "ac",
      hostIdleMs: 0,
      hostSource: "measured",
      remoteCallBudget: 0,
    });
    store.recordBrief({
      runId,
      jobId: "j",
      agentMethod: "agents.catchup",
      briefMarkdown: "x",
      findingsJson: "{}",
      synthesisJson: null,
      createdAt: 100,
      // Deliberately far in the future: the RUN's age is what retires it, and the cascade is
      // what removes the brief. Without pruneRuns, fleet_run grows one row per tick forever.
      expiresAt: 10_000_000,
    });
    expect(store.pruneRuns(500)).toBe(1);
    expect(store.listBriefs({ limit: 10 })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test packages/gateway/src/fleet/fleet-store.test.ts`
Expected: FAIL — `Cannot find module '../index/fleet-v60-sql.ts'`.

- [ ] **Step 3: Write the DDL**

```ts
// packages/gateway/src/index/fleet-v60-sql.ts
/**
 * V60 — overnight agent fleet scheduling (spec § 9).
 *
 * `fleet_job_state` holds ONLY what config cannot: config remains the source of truth for job
 * definitions, this table for what happened to them. Same split as
 * `sync/scheduler-state-repository.ts`.
 *
 * `fleet_brief.run_id`'s cascade is live rather than decorative: `index/local-index.ts` runs
 * `PRAGMA foreign_keys = ON`. SQLite defaults them OFF, and a cascade written against a database
 * that never enabled them is a silent no-op that leaves orphans forever — hence the explicit note
 * and the test that deletes a parent row.
 */
export const FLEET_V60_SQL = `
CREATE TABLE IF NOT EXISTS fleet_job_state (
  job_id                TEXT PRIMARY KEY,
  last_attempt_at       INTEGER,
  last_success_at       INTEGER,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  backoff_until         INTEGER,
  last_error            TEXT
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS fleet_run (
  id                    TEXT PRIMARY KEY,
  started_at            INTEGER NOT NULL,
  ended_at              INTEGER,
  host_power            TEXT NOT NULL CHECK (host_power IN ('ac', 'battery', 'unknown')),
  host_idle_ms          INTEGER,
  host_source           TEXT NOT NULL CHECK (host_source IN ('measured', 'power_only')),
  outcome               TEXT CHECK (outcome IN ('completed', 'yielded', 'deferred', 'failed')),
  jobs_attempted        INTEGER NOT NULL DEFAULT 0,
  jobs_completed        INTEGER NOT NULL DEFAULT 0,
  remote_calls_made     INTEGER NOT NULL DEFAULT 0,
  remote_call_budget    INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS fleet_brief (
  id                    TEXT PRIMARY KEY,
  run_id                TEXT NOT NULL REFERENCES fleet_run(id) ON DELETE CASCADE,
  job_id                TEXT NOT NULL,
  agent_method          TEXT NOT NULL,
  brief_markdown        TEXT,
  findings_json         TEXT NOT NULL,
  synthesis_json        TEXT,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_fleet_brief_run ON fleet_brief (run_id);
CREATE INDEX IF NOT EXISTS idx_fleet_brief_job ON fleet_brief (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_brief_expires ON fleet_brief (expires_at);
CREATE INDEX IF NOT EXISTS idx_fleet_run_started ON fleet_run (started_at DESC);
`;
```

- [ ] **Step 4: Register the migration**

In `packages/gateway/src/index/migrations/runner.ts`, import `FLEET_V60_SQL` beside the V59 import
and append to the step list, after `simpleStep(58, 59, …)`:

```ts
  simpleStep(59, 60, "agent fleet scheduling", FLEET_V60_SQL),
```

- [ ] **Step 5: Write `FleetStore`**

All writes go through `dbRun`/`dbStmtRun` (I14/D12) and every parameter is bound (I9).

```ts
// packages/gateway/src/fleet/fleet-store.ts
import type { Database } from "bun:sqlite";
import { dbRun } from "../db/write.ts";
import type { HostPower, HostProbeSource } from "../platform/host-activity.ts";

export type FleetRunOutcome = "completed" | "yielded" | "deferred" | "failed";

export interface FleetJobState {
  readonly jobId: string;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly consecutiveFailures: number;
  readonly backoffUntil: number | null;
  readonly lastError: string | null;
}

export interface FleetBriefRow {
  readonly id: string;
  readonly runId: string;
  readonly jobId: string;
  readonly agentMethod: string;
  readonly briefMarkdown: string | null;
  readonly findingsJson: string;
  readonly synthesisJson: string | null;
  readonly createdAt: number;
}

/** 1h, 2h, 4h … capped at 24h. Capped because an uncapped doubling silently retires a job. */
const BACKOFF_BASE_MS = 60 * 60 * 1000;
const BACKOFF_CAP_MS = 24 * BACKOFF_BASE_MS;

export function backoffMsForFailures(consecutiveFailures: number): number {
  const exp = BACKOFF_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1);
  return Math.min(exp, BACKOFF_CAP_MS);
}

export class FleetStore {
  constructor(private readonly db: Database) {}

  openRun(r: {
    startedAt: number;
    hostPower: HostPower;
    hostIdleMs: number | null;
    hostSource: HostProbeSource;
    remoteCallBudget: number;
  }): string {
    const id = crypto.randomUUID();
    dbRun(
      this.db,
      `INSERT INTO fleet_run
         (id, started_at, host_power, host_idle_ms, host_source, remote_call_budget)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, r.startedAt, r.hostPower, r.hostIdleMs, r.hostSource, r.remoteCallBudget],
    );
    return id;
  }

  closeRun(
    runId: string,
    r: {
      endedAt: number;
      outcome: FleetRunOutcome;
      jobsAttempted: number;
      jobsCompleted: number;
      remoteCallsMade: number;
    },
  ): void {
    dbRun(
      this.db,
      `UPDATE fleet_run
          SET ended_at = ?, outcome = ?, jobs_attempted = ?, jobs_completed = ?,
              remote_calls_made = ?
        WHERE id = ?`,
      [r.endedAt, r.outcome, r.jobsAttempted, r.jobsCompleted, r.remoteCallsMade, runId],
    );
  }

  recordBrief(b: {
    runId: string;
    jobId: string;
    agentMethod: string;
    briefMarkdown: string | null;
    findingsJson: string;
    synthesisJson: string | null;
    createdAt: number;
    expiresAt: number;
  }): string {
    const id = crypto.randomUUID();
    dbRun(
      this.db,
      `INSERT INTO fleet_brief
         (id, run_id, job_id, agent_method, brief_markdown, findings_json, synthesis_json,
          created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        b.runId,
        b.jobId,
        b.agentMethod,
        b.briefMarkdown,
        b.findingsJson,
        b.synthesisJson,
        b.createdAt,
        b.expiresAt,
      ],
    );
    return id;
  }

  loadJobState(jobId: string): FleetJobState | undefined {
    const row = this.db
      .query(
        `SELECT job_id, last_attempt_at, last_success_at, consecutive_failures,
                backoff_until, last_error
           FROM fleet_job_state WHERE job_id = ?`,
      )
      .get(jobId) as
      | {
          job_id: string;
          last_attempt_at: number | null;
          last_success_at: number | null;
          consecutive_failures: number;
          backoff_until: number | null;
          last_error: string | null;
        }
      | null;
    if (row === null) return undefined;
    return {
      jobId: row.job_id,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      consecutiveFailures: row.consecutive_failures,
      backoffUntil: row.backoff_until,
      lastError: row.last_error,
    };
  }

  recordJobSuccess(jobId: string, now: number): void {
    dbRun(
      this.db,
      `INSERT INTO fleet_job_state
         (job_id, last_attempt_at, last_success_at, consecutive_failures, backoff_until, last_error)
       VALUES (?, ?, ?, 0, NULL, NULL)
       ON CONFLICT(job_id) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at,
         consecutive_failures = 0, backoff_until = NULL, last_error = NULL`,
      [jobId, now, now],
    );
  }

  recordJobFailure(jobId: string, now: number, error: string): void {
    const failures = (this.loadJobState(jobId)?.consecutiveFailures ?? 0) + 1;
    dbRun(
      this.db,
      `INSERT INTO fleet_job_state
         (job_id, last_attempt_at, last_success_at, consecutive_failures, backoff_until, last_error)
       VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         consecutive_failures = excluded.consecutive_failures,
         backoff_until = excluded.backoff_until,
         last_error = excluded.last_error`,
      [jobId, now, failures, now + backoffMsForFailures(failures), error],
    );
  }

  listBriefs(q: { limit: number; jobId?: string }): FleetBriefRow[] {
    const rows = (
      q.jobId === undefined
        ? this.db
            .query(
              `SELECT id, run_id, job_id, agent_method, brief_markdown, findings_json,
                      synthesis_json, created_at
                 FROM fleet_brief ORDER BY created_at DESC LIMIT ?`,
            )
            .all(q.limit)
        : this.db
            .query(
              `SELECT id, run_id, job_id, agent_method, brief_markdown, findings_json,
                      synthesis_json, created_at
                 FROM fleet_brief WHERE job_id = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .all(q.jobId, q.limit)
    ) as ReadonlyArray<{
      id: string;
      run_id: string;
      job_id: string;
      agent_method: string;
      brief_markdown: string | null;
      findings_json: string;
      synthesis_json: string | null;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      jobId: r.job_id,
      agentMethod: r.agent_method,
      briefMarkdown: r.brief_markdown,
      findingsJson: r.findings_json,
      synthesisJson: r.synthesis_json,
      createdAt: r.created_at,
    }));
  }

  /** A point lookup on the primary key — never a scan. `brief_markdown` can be tens of KB. */
  getBrief(id: string): FleetBriefRow | undefined {
    const row = this.db
      .query(
        `SELECT id, run_id, job_id, agent_method, brief_markdown, findings_json,
                synthesis_json, created_at
           FROM fleet_brief WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          run_id: string;
          job_id: string;
          agent_method: string;
          brief_markdown: string | null;
          findings_json: string;
          synthesis_json: string | null;
          created_at: number;
        }
      | null;
    if (row === null) return undefined;
    return {
      id: row.id,
      runId: row.run_id,
      jobId: row.job_id,
      agentMethod: row.agent_method,
      briefMarkdown: row.brief_markdown,
      findingsJson: row.findings_json,
      synthesisJson: row.synthesis_json,
      createdAt: row.created_at,
    };
  }

  /** Deletes briefs whose `expires_at` is at or before `now`. Returns the count removed. */
  pruneBriefs(now: number): number {
    const before = this.db.query(`SELECT COUNT(*) AS n FROM fleet_brief`).get() as { n: number };
    dbRun(this.db, `DELETE FROM fleet_brief WHERE expires_at <= ?`, [now]);
    const after = this.db.query(`SELECT COUNT(*) AS n FROM fleet_brief`).get() as { n: number };
    return before.n - after.n;
  }

  /**
   * Deletes runs started at or before `cutoff`. Their briefs go with them via the FK cascade —
   * which is why this exists: pruning only `fleet_brief` would leave one `fleet_run` row per
   * tick accumulating forever, and at a 60-second tick that is ~525k rows a year.
   */
  pruneRuns(cutoff: number): number {
    const before = this.db.query(`SELECT COUNT(*) AS n FROM fleet_run`).get() as { n: number };
    dbRun(this.db, `DELETE FROM fleet_run WHERE started_at <= ?`, [cutoff]);
    const after = this.db.query(`SELECT COUNT(*) AS n FROM fleet_run`).get() as { n: number };
    return before.n - after.n;
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `bun test packages/gateway/src/fleet/fleet-store.test.ts && bun test packages/gateway/src/index/migrations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/index/fleet-v60-sql.ts packages/gateway/src/index/migrations/runner.ts packages/gateway/src/fleet
git commit -m "feat(fleet): add the V60 fleet tables and FleetStore"
```

---

### Task 3: `[fleet]` and `[[fleet.job]]` config

**Files:**

- Create: `packages/gateway/src/config/fleet-toml.ts`
- Test: `packages/gateway/src/config/fleet-toml.test.ts`
- Modify: `packages/gateway/src/config/toml-primitives.ts` (promote `parseBool`)
- Modify: `packages/gateway/src/config/{filesystem,nimbus,telemetry}-toml.ts` (use the promoted one)

**Interfaces:**

- Consumes: `stripComment`, `isTableHeader`, `splitKeyValue`, `parseString`, `parseIntDec` from
  `toml-primitives.ts`.
- Produces: `NimbusFleetToml`, `NimbusFleetJobToml`, `DEFAULT_FLEET_CONFIG`,
  `parseNimbusTomlFleet(source): NimbusFleetToml`,
  `parseNimbusTomlFleetJobs(source): NimbusFleetJobToml[]`,
  `loadNimbusFleetFromPath(tomlPath): { config: NimbusFleetToml; jobs: NimbusFleetJobToml[] }`
  (a PATH — there is deliberately no config-dir variant; see the doc comment in Step 4),
  `FleetConfigError`,
  and `parseBool` re-exported from `toml-primitives.ts`.

- [ ] **Step 1: Write the failing config test**

```ts
// packages/gateway/src/config/fleet-toml.test.ts
import { expect, test } from "bun:test";
import { parseNimbusTomlFleet, parseNimbusTomlFleetJobs } from "./fleet-toml.ts";

test("an absent [fleet] block is disabled with safe defaults", () => {
  const c = parseNimbusTomlFleet("");
  expect(c.enabled).toBe(false);
  expect(c.allowRemote).toBe(false);
  expect(c.remoteCallBudget).toBe(0);
  expect(c.minIdleSeconds).toBe(900);
  expect(c.requireAcPower).toBe(true);
  expect(c.retentionDays).toBe(14);
});

test("parses a full [fleet] block", () => {
  const c = parseNimbusTomlFleet(
    [
      "[fleet]",
      "enabled = true",
      "allow_remote = true",
      "remote_call_budget = 5",
      "min_idle_seconds = 60",
      "require_ac_power = false",
      "retention_days = 30",
    ].join("\n"),
  );
  expect(c).toEqual({
    enabled: true,
    allowRemote: true,
    remoteCallBudget: 5,
    minIdleSeconds: 60,
    requireAcPower: false,
    retentionDays: 30,
  });
});

test("allow_remote with a zero budget is refused, not silently allowed", () => {
  expect(() =>
    parseNimbusTomlFleet(["[fleet]", "allow_remote = true", "remote_call_budget = 0"].join("\n")),
  ).toThrow(/remote_call_budget/);
});

test("keys after a following table header do not leak into [fleet]", () => {
  const c = parseNimbusTomlFleet(["[fleet]", "enabled = true", "[other]", "enabled = false"].join("\n"));
  expect(c.enabled).toBe(true);
});

test("parses multiple [[fleet.job]] blocks with flat params", () => {
  const jobs = parseNimbusTomlFleetJobs(
    [
      "[[fleet.job]]",
      'name = "morning_catchup"',
      'agent = "catchup"',
      "interval_seconds = 86400",
      "since_ms = 86400000",
      'service = "github"',
      "",
      "[[fleet.job]]",
      'name = "weekly_ownership"',
      'agent = "ownership"',
      "interval_seconds = 604800",
    ].join("\n"),
  );
  expect(jobs).toHaveLength(2);
  expect(jobs[0]).toEqual({
    name: "morning_catchup",
    agent: "catchup",
    intervalSeconds: 86400,
    params: { sinceMs: 86400000, service: "github" },
  });
  expect(jobs[1]?.params).toEqual({});
});

test("a block with no name and no agent is not a job at all — ignored", () => {
  expect(parseNimbusTomlFleetJobs(["[[fleet.job]]"].join("\n"))).toEqual([]);
});

test("a job missing a required key is REFUSED, never silently dropped or defaulted", () => {
  // Dropping it leaves the owner believing a job is configured that will never run. Defaulting
  // interval_seconds to a day guesses a schedule they did not choose. Both fail silently; a
  // throw is the only outcome they can see.
  expect(() =>
    parseNimbusTomlFleetJobs(["[[fleet.job]]", 'name = "x"', 'agent = "catchup"'].join("\n")),
  ).toThrow(/interval_seconds/);
  expect(() =>
    parseNimbusTomlFleetJobs(["[[fleet.job]]", 'name = "x"', "interval_seconds = 10"].join("\n")),
  ).toThrow(/agent/);
});

test("duplicate job names are refused — the name is the job_id primary key", () => {
  expect(() =>
    parseNimbusTomlFleetJobs(
      [
        "[[fleet.job]]",
        'name = "dup"',
        'agent = "catchup"',
        "interval_seconds = 1",
        "[[fleet.job]]",
        'name = "dup"',
        'agent = "ownership"',
        "interval_seconds = 1",
      ].join("\n"),
    ),
  ).toThrow(/duplicate/i);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test packages/gateway/src/config/fleet-toml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Promote `parseBool` to `toml-primitives.ts`**

Append to `packages/gateway/src/config/toml-primitives.ts`:

```ts
/** TOML booleans. `undefined` for anything else, so a malformed value leaves the default alone. */
export function parseBool(raw: string): boolean | undefined {
  const s = raw.trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return undefined;
}
```

Delete the three private copies in `filesystem-toml.ts`, `nimbus-toml.ts` and `telemetry-toml.ts`,
importing the shared one instead. A fourth copy would trip the `duplication (jscpd)` preflight gate.

- [ ] **Step 4: Write `fleet-toml.ts`**

Note the `isTableHeader` reset, which `filesystem-toml.ts` does not do: without it any later
`key = value` in the file keeps applying to the last block.

```ts
// packages/gateway/src/config/fleet-toml.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isTableHeader, parseBool, parseIntDec, parseString, splitKeyValue, stripComment } from "./toml-primitives.ts";

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
  let cur: { name?: string; agent?: string; intervalSeconds?: number; params: Record<string, FleetJobParamValue> } | undefined;

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
    else if (kv.key === "interval_seconds") cur.intervalSeconds = parseIntDec(kv.valRaw);
    else if (!JOB_RESERVED.has(kv.key)) {
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
```

- [ ] **Step 5: Run the tests**

Run: `bun test packages/gateway/src/config && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/config
git commit -m "feat(config): parse [fleet] and [[fleet.job]]; promote parseBool to toml-primitives"
```

---

### Task 4: The `fleet` client kind, eligibility, and static rule D28

The security seam. Adding the `ClientKind` member will not compile until the egress map is updated —
that is the mechanism working, not an obstacle.

**Files:**

- Modify: `packages/gateway/src/ipc/server/client-kind.ts`
- Modify: `packages/gateway/src/egress/egress-bearing-kinds.ts`
- Modify: `packages/gateway/src/ipc/agents-rpc.ts`
- Modify: `scripts/structure-audit/check-nimbus-invariants.ts`
- Test: `packages/gateway/src/ipc/agents-rpc-fleet-eligibility.test.ts`
- Test: `packages/gateway/src/egress/egress-bearing-kinds.test.ts` (extend)

**Interfaces:**

- Consumes: nothing.
- Produces: `ClientKind` gains `"fleet"`; `export type AgentMethod = keyof typeof AGENTS_RPC_HANDLERS`;
  `FleetEligibility`; `FLEET_ELIGIBILITY: Readonly<Record<AgentMethod, FleetEligibility>>`;
  `resolveFleetAgentMethod(agent: string): string | null`;
  `checkFleetClientKindConfinement(files): Violation[]`.

- [ ] **Step 1: Write the failing eligibility test**

```ts
// packages/gateway/src/ipc/agents-rpc-fleet-eligibility.test.ts
import { describe, expect, test } from "bun:test";
import { FLEET_ELIGIBILITY, resolveFleetAgentMethod } from "./agents-rpc.ts";

describe("fleet eligibility", () => {
  test("agents with owner-machine side effects are excluded", () => {
    // preflight queues HITL consent prompts; premortem writes paused watcher rows.
    expect(FLEET_ELIGIBILITY["agents.preflight"]).toBe("excluded_side_effects");
    expect(FLEET_ELIGIBILITY["agents.premortem"]).toBe("excluded_side_effects");
  });

  test("whyPeek is excluded on SHAPE — it is synchronous and never notifies", () => {
    expect(FLEET_ELIGIBILITY["agents.whyPeek"]).toBe("excluded_shape");
  });

  test("negotiate is deferred to PR 2, an explicit value rather than an absence", () => {
    expect(FLEET_ELIGIBILITY["agents.negotiate"]).toBe("deferred");
  });

  test("the pure-read agents are eligible", () => {
    for (const m of [
      "agents.catchup",
      "agents.huddle",
      "agents.glossary",
      "agents.decisions",
      "agents.ownership",
      "agents.why",
      "agents.ghost",
      "agents.conflicts",
      "agents.impact",
      "agents.expert",
      "agents.janitor",
    ] as const) {
      expect(FLEET_ELIGIBILITY[m]).toBe("eligible");
    }
  });

  test("resolveFleetAgentMethod returns null for every non-eligible classification", () => {
    expect(resolveFleetAgentMethod("catchup")).toBe("agents.catchup");
    expect(resolveFleetAgentMethod("preflight")).toBeNull();
    expect(resolveFleetAgentMethod("premortem")).toBeNull();
    expect(resolveFleetAgentMethod("whyPeek")).toBeNull();
    expect(resolveFleetAgentMethod("negotiate")).toBeNull();
    expect(resolveFleetAgentMethod("nope")).toBeNull();
    // Prototype keys are caller-supplied strings, not methods.
    expect(resolveFleetAgentMethod("constructor")).toBeNull();
  });
});
```

- [ ] **Step 2: Extend the egress-map test**

Append to `packages/gateway/src/egress/egress-bearing-kinds.test.ts`:

```ts
test("a fleet brief appends nothing — it never leaves the machine", () => {
  expect(egressSourceTypeForClientKind("fleet")).toBeNull();
});
```

- [ ] **Step 3: Run both and confirm they fail**

Run: `bun test packages/gateway/src/ipc/agents-rpc-fleet-eligibility.test.ts packages/gateway/src/egress/egress-bearing-kinds.test.ts`
Expected: FAIL — `FLEET_ELIGIBILITY` is not exported; `"fleet"` is not a `ClientKind`.

- [ ] **Step 4: Add `fleet` to `ClientKind` (not to `RECOGNISED`)**

In `packages/gateway/src/ipc/server/client-kind.ts`:

```ts
export type ClientKind = "cli" | "mcp" | "ui" | "http" | "chatops" | "fleet" | "unknown";
```

and extend the existing doc comment above `RECOGNISED`:

```ts
 * `fleet` is likewise DERIVED and deliberately absent from RECOGNISED: it is set by the gateway's
 * own scheduler, so its attribution is a fact rather than a client's word. Admitting it here would
 * let any local process on the socket file its briefs as unattended fleet work.
```

- [ ] **Step 5: Add the egress classification**

In `packages/gateway/src/egress/egress-bearing-kinds.ts`, inside the frozen record:

```ts
  // The SAME `null` as `cli`/`ui`, for the same reason. I29's second append path covers a brief
  // handed to a model the CALLING CLIENT uses; a fleet brief is written to local SQLite and read
  // by the owner on this machine. Unattendedness is not egress — egress is bytes crossing the
  // boundary, not whether someone was watching them not cross it. A fleet run's REMOTE synthesis,
  // when `[fleet] allow_remote` grants it, is ledgered by the `model` class at the provider
  // (`egress/model-egress.ts`), which is where the bytes actually leave.
  fleet: null,
```

- [ ] **Step 6: Add the eligibility map and resolver**

In `packages/gateway/src/ipc/agents-rpc.ts`, immediately after `EXTERNAL_EXCLUDED_AGENT_METHODS`:

```ts
/**
 * The served agent methods, as a TYPE. `AGENTS_RPC_HANDLERS` itself stays unexported — handing the
 * map out would let another file invoke an agent directly, a bypass D22(d) cannot see. A type
 * export carries no runtime value, so it grants no such ability while still letting
 * `FLEET_ELIGIBILITY` be total over exactly this set.
 */
export type AgentMethod = keyof typeof AGENTS_RPC_HANDLERS;

export type FleetEligibility = "eligible" | "excluded_side_effects" | "excluded_shape" | "deferred";

/**
 * Which agents an UNATTENDED, owner-configured fleet run may invoke.
 *
 * TOTAL over `AgentMethod` on purpose: a sixteenth agent does not compile until someone classifies
 * it. An exclusion `Set` fails OPEN — a new agent would silently become fleet-eligible.
 *
 * NOT `EXTERNAL_EXCLUDED_AGENT_METHODS`. That set was reasoned about for an ARBITRARY NETWORK
 * CALLER; a fleet is a different principal — owner-configured in advance, absent when it fires.
 * The overlap is large and the justification is not transferable.
 */
export const FLEET_ELIGIBILITY: Readonly<Record<AgentMethod, FleetEligibility>> = Object.freeze({
  // Queues HITL consent prompts on the owner's machine (I24). At 03:00 that is a prompt nobody
  // is there to answer — worse than the HTTP case it is already excluded for.
  "agents.preflight": "excluded_side_effects",
  // NOT a pure read: `runPremortem` writes paused `watcher` rows and a proposal tombstone, and
  // `repropose: true` deletes tombstones. Nightly, that accumulates state nobody asked for.
  "agents.premortem": "excluded_side_effects",
  // Synchronous: returns its payload directly and never calls `notify`, so it cannot settle the
  // completion promise the invoker waits on.
  "agents.whyPeek": "excluded_shape",
  // No side effects and the shape fits — but `--person` makes it a dossier builder, and SCHEDULED
  // dossier-building is a different proposition from an owner running it once. Revisit in PR 2
  // alongside subject enumeration.
  "agents.negotiate": "deferred",
  "agents.catchup": "eligible",
  "agents.huddle": "eligible",
  "agents.glossary": "eligible",
  "agents.decisions": "eligible",
  "agents.ownership": "eligible",
  "agents.why": "eligible",
  "agents.ghost": "eligible",
  "agents.conflicts": "eligible",
  "agents.impact": "eligible",
  "agents.expert": "eligible",
  "agents.janitor": "eligible",
});

/**
 * The `agents.*` method a fleet job may invoke for a config-supplied agent name, or null.
 *
 * `Object.hasOwn`, never `in` — the name comes from `nimbus.toml` and `in` would resolve
 * `"constructor"` against the prototype. Same reasoning as `resolveExternalAgentMethod`.
 */
export function resolveFleetAgentMethod(agent: string): string | null {
  const method = `${AGENTS_METHOD_PREFIX}${agent}`;
  if (!Object.hasOwn(AGENTS_RPC_HANDLERS, method)) return null;
  return FLEET_ELIGIBILITY[method as AgentMethod] === "eligible" ? method : null;
}
```

- [ ] **Step 7: Add static rule D28**

In `scripts/structure-audit/check-nimbus-invariants.ts`, beside the D23 rule:

```ts
// D28 (I38): the `fleet` ClientKind literal — the attribution that marks a call as unattended,
// owner-configured fleet work — may appear only where it is DEFINED, where its egress status is
// DECIDED, and in the one invoker that legitimately wears it. A second file naming it would be a
// second path able to file briefs under that attribution without passing the scheduler's config,
// policy, admission and I38 budget checks. Mirrors D23's runConfined confinement. Tests exempt.
const D28_FLEET_KIND_ALLOWED = [
  "packages/gateway/src/ipc/server/client-kind.ts",
  "packages/gateway/src/egress/egress-bearing-kinds.ts",
  "packages/gateway/src/fleet/fleet-invoker.ts",
];
const D28_FLEET_KIND_RE = /kind:\s*"fleet"|"fleet"\s*:\s*(?:null|")/;

export function checkFleetClientKindConfinement(files: readonly FileEntry[]): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    if (f.relPath.endsWith(".test.ts")) continue;
    if (D28_FLEET_KIND_ALLOWED.includes(f.relPath)) continue;
    const stripped = stripComments(f.contents).split("\n");
    const original = f.contents.split("\n");
    for (let i = 0; i < stripped.length; i++) {
      if (D28_FLEET_KIND_RE.test(stripped[i] ?? "")) {
        out.push({
          rule: "D28-fleet-client-kind",
          file: f.relPath,
          line: i + 1,
          snippet: (original[i] ?? "").trim(),
        });
      }
    }
  }
  return out;
}
```

Register it in the runner beside the `checkRunConfinedConfinement` block (near line 2064), following
the identical shape and emitting a `::error file=…::D28 fleet ClientKind breach` line.

- [ ] **Step 8: Run everything**

Run: `bun test packages/gateway/src/ipc packages/gateway/src/egress && bun run audit:nimbus-invariants && bun run typecheck`
Expected: PASS. Confirm the compiler forced the egress-map entry by temporarily deleting
`fleet: null` and seeing `typecheck` fail; restore it.

- [ ] **Step 9: Commit**

```bash
git add packages/gateway/src/ipc packages/gateway/src/egress scripts/structure-audit
git commit -m "feat(fleet): add the derived fleet ClientKind, eligibility map and static rule D28"
```

---

### Task 5: `fleet-synthesis-router.ts` — the I38 decorator

**Files:**

- Create: `packages/gateway/src/fleet/fleet-synthesis-router.ts`
- Test: `packages/gateway/src/fleet/fleet-synthesis-router.test.ts`

**Interfaces:**

- Consumes: `SynthesisRouter`, `ResolvedSynthesisProvider` from
  `agents/_lib/synthesis-llm.ts` and `llm/router.ts`.
- Produces: `FleetRemoteBudget`, `createFleetRemoteBudget(allowRemote, budget)`,
  `wrapFleetSynthesisRouter(inner, budget): SynthesisRouter`, `FleetRemoteRefusedError`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/src/fleet/fleet-synthesis-router.test.ts
import { describe, expect, test } from "bun:test";
import type { ResolvedSynthesisProvider } from "../llm/router.ts";
import type { SynthesisRouter } from "../agents/_lib/synthesis-llm.ts";
import { createFleetRemoteBudget, wrapFleetSynthesisRouter } from "./fleet-synthesis-router.ts";

const LOCAL: ResolvedSynthesisProvider = { providerId: "ollama", modelName: "qwen", isLocal: true };
const REMOTE: ResolvedSynthesisProvider = { providerId: "anthropic", modelName: "opus", isLocal: false };

function fakeRouter(resolve: ResolvedSynthesisProvider | undefined, calls: string[]): SynthesisRouter {
  return {
    resolveForSynthesis: async () => resolve,
    generateMarkdown: async (_p, provider) => {
      calls.push(provider.providerId);
      return "md";
    },
  };
}

describe("wrapFleetSynthesisRouter (I38)", () => {
  test("a LOCAL provider passes through untouched", async () => {
    const calls: string[] = [];
    const r = wrapFleetSynthesisRouter(fakeRouter(LOCAL, calls), createFleetRemoteBudget(false, 0));
    expect(await r.resolveForSynthesis(true)).toEqual(LOCAL);
    await r.generateMarkdown("p", LOCAL);
    expect(calls).toEqual(["ollama"]);
  });

  test("without allow_remote a remote provider is withheld — resolve returns undefined", async () => {
    const calls: string[] = [];
    const r = wrapFleetSynthesisRouter(fakeRouter(REMOTE, calls), createFleetRemoteBudget(false, 0));
    expect(await r.resolveForSynthesis(true)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("generateMarkdown REFUSES a remote provider handed to it directly", async () => {
    const calls: string[] = [];
    const r = wrapFleetSynthesisRouter(fakeRouter(REMOTE, calls), createFleetRemoteBudget(false, 0));
    // The second door: a caller that already holds a remote provider must not get through either.
    await expect(r.generateMarkdown("p", REMOTE)).rejects.toThrow(/allow_remote/);
    expect(calls).toEqual([]);
  });

  test("with allow_remote and budget 1, exactly one remote call is permitted", async () => {
    const calls: string[] = [];
    const budget = createFleetRemoteBudget(true, 1);
    const r = wrapFleetSynthesisRouter(fakeRouter(REMOTE, calls), budget);
    await r.generateMarkdown("p", REMOTE);
    expect(budget.spent()).toBe(1);
    await expect(r.generateMarkdown("p", REMOTE)).rejects.toThrow(/budget/);
    expect(calls).toEqual(["anthropic"]);
    expect(budget.exhausted()).toBe(true);
  });

  test("an exhausted budget withholds the remote provider at resolve time too", async () => {
    const budget = createFleetRemoteBudget(true, 1);
    budget.consume();
    const r = wrapFleetSynthesisRouter(fakeRouter(REMOTE, []), budget);
    expect(await r.resolveForSynthesis(true)).toBeUndefined();
  });

  test("locality is read off the provider, never recomputed from a vendor id", async () => {
    // A provider whose id LOOKS remote but declares isLocal (I34 is the single source) passes.
    const looksRemote: ResolvedSynthesisProvider = {
      providerId: "anthropic",
      modelName: "m",
      isLocal: true,
    };
    const calls: string[] = [];
    const r = wrapFleetSynthesisRouter(fakeRouter(looksRemote, calls), createFleetRemoteBudget(false, 0));
    await r.generateMarkdown("p", looksRemote);
    expect(calls).toEqual(["anthropic"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test packages/gateway/src/fleet/fleet-synthesis-router.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/gateway/src/fleet/fleet-synthesis-router.ts
import type { SynthesisRouter } from "../agents/_lib/synthesis-llm.ts";
import type { ResolvedSynthesisProvider } from "../llm/router.ts";

export class FleetRemoteRefusedError extends Error {}

export interface FleetRemoteBudget {
  readonly allowRemote: boolean;
  remaining(): number;
  spent(): number;
  exhausted(): boolean;
  /** Reserves one remote call. Returns false when none is left. */
  consume(): boolean;
}

export function createFleetRemoteBudget(allowRemote: boolean, budget: number): FleetRemoteBudget {
  let used = 0;
  const cap = allowRemote ? Math.max(0, budget) : 0;
  return {
    allowRemote,
    remaining: () => cap - used,
    spent: () => used,
    exhausted: () => used >= cap,
    consume: () => {
      if (used >= cap) return false;
      used += 1;
      return true;
    },
  };
}

/**
 * I38 — a fleet run reaches a NON-LOCAL model only when `[fleet] allow_remote` is set AND the run's
 * remaining budget covers the call.
 *
 * A DECORATOR over `SynthesisRouter`, not a call-site check, for the reason `wrapLedgeredProvider`
 * (I29), `wrapServerSpec` (I15) and `wrapLedgeredVlm` (D22(g)) are decorators: it covers every
 * caller including ones written later, without their cooperation.
 *
 * BOTH methods are guarded, which is not redundant. `resolveForSynthesis` withholding a remote
 * provider is the normal path and degrades gracefully — `undefined` means the runner falls back to
 * the deterministic render, exactly as `[agents] synthesis = "off"` would. `generateMarkdown`
 * refusing is the second door, for a caller that obtained a provider some other way; fixing one
 * door and leaving the adjacent one open is a defect shape this repo has shipped before.
 *
 * Locality is DERIVED from `provider.isLocal` (I34's single source), never recomputed from a
 * vendor id — a wrong `true` would fail silently in both directions at once.
 *
 * Rejected alternatives: `LlmRouter.setTaskPin` mutates a router-wide map shared with a concurrent
 * interactive `nimbus ask`, so a fleet pin would silently re-route the user's own question and
 * un-setting it races; `enforce_air_gap` is gateway-wide and would disable remote for everything.
 */
export function wrapFleetSynthesisRouter(
  inner: SynthesisRouter,
  budget: FleetRemoteBudget,
): SynthesisRouter {
  const remoteAllowedNow = (): boolean => budget.allowRemote && budget.remaining() > 0;

  return {
    async resolveForSynthesis(preferLocal?: boolean): Promise<ResolvedSynthesisProvider | undefined> {
      const resolved = await inner.resolveForSynthesis(preferLocal);
      if (resolved === undefined || resolved.isLocal) return resolved;
      return remoteAllowedNow() ? resolved : undefined;
    },

    async generateMarkdown(
      prompt: string,
      provider: ResolvedSynthesisProvider,
      egressMethod?: string,
    ): Promise<string> {
      if (!provider.isLocal) {
        if (!budget.allowRemote) {
          throw new FleetRemoteRefusedError(
            "fleet run may not use a remote model: [fleet] allow_remote is false",
          );
        }
        if (!budget.consume()) {
          throw new FleetRemoteRefusedError(
            `fleet run exhausted its remote_call_budget after ${budget.spent()} call(s)`,
          );
        }
      }
      return inner.generateMarkdown(prompt, provider, egressMethod);
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/fleet/fleet-synthesis-router.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/fleet/fleet-synthesis-router.ts packages/gateway/src/fleet/fleet-synthesis-router.test.ts
git commit -m "feat(fleet): add the I38 synthesis budget and locality decorator"
```

---

### Task 6: `fleet-invoker.ts` — dispatch and await completion

The spec's § 5.1.1. `dispatchAgentsRpc` returns before the brief exists, so this task is what makes
sequential scheduling possible at all.

**Files:**

- Create: `packages/gateway/src/fleet/fleet-invoker.ts`
- Test: `packages/gateway/src/fleet/fleet-invoker.test.ts`

**Interfaces:**

- Consumes: `resolveFleetAgentMethod` (Task 4), `wrapFleetSynthesisRouter` + `FleetRemoteBudget`
  (Task 5), `NimbusFleetJobToml` (Task 3).
- Produces: `FleetJobOutcome`, `FleetInvokerDeps`, `FleetInvoker`,
  `buildFleetInvoker(deps): FleetInvoker`, `DEFAULT_JOB_TIMEOUT_MS`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/src/fleet/fleet-invoker.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { buildFleetInvoker } from "./fleet-invoker.ts";
import { createFleetRemoteBudget } from "./fleet-synthesis-router.ts";

function deps(dispatch: FleetInvokerTestDispatch) {
  return {
    db: new Database(":memory:"),
    router: undefined,
    budget: createFleetRemoteBudget(false, 0),
    timeoutMs: 50,
    dispatch,
  };
}

type FleetInvokerTestDispatch = (
  method: string,
  params: unknown,
  ctx: { notify: (m: string, p: unknown) => void; caller?: { clientId: string; kind: string } },
) => Promise<unknown>;

const JOB = { name: "j", agent: "catchup", intervalSeconds: 1, params: {} };

describe("buildFleetInvoker", () => {
  test("resolves only after briefReady, not when dispatch returns", async () => {
    const order: string[] = [];
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        order.push("dispatch-returned");
        setTimeout(() => {
          ctx.notify("catchup.briefReady", {
            sessionId: "s1",
            brief: "# hi",
            findings: { a: 1 },
            synthesis: null,
          });
        }, 5);
        return { sessionId: "s1" };
      }),
    );
    const out = await invoke(JOB);
    order.push("invoke-resolved");
    // The whole point: dispatch returning is NOT the job finishing.
    expect(order).toEqual(["dispatch-returned", "invoke-resolved"]);
    expect(out).toEqual({
      status: "done",
      briefMarkdown: "# hi",
      findingsJson: JSON.stringify({ a: 1 }),
      synthesisJson: null,
    });
  });

  test("briefError settles as failed", async () => {
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        ctx.notify("catchup.briefError", { sessionId: "s1", error: "boom" });
        return { sessionId: "s1" };
      }),
    );
    expect(await invoke(JOB)).toEqual({ status: "failed", error: "boom" });
  });

  test("a brief that never arrives times out rather than wedging the fleet", async () => {
    const invoke = buildFleetInvoker(deps(async () => ({ sessionId: "s1" })));
    const out = await invoke(JOB);
    expect(out.status).toBe("failed");
    expect("error" in out && out.error).toMatch(/timed out/);
  });

  test("a notification for a DIFFERENT sessionId is ignored", async () => {
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        ctx.notify("catchup.briefReady", { sessionId: "other", brief: "x", findings: {} });
        return { sessionId: "s1" };
      }),
    );
    expect((await invoke(JOB)).status).toBe("failed"); // times out; the stray notify did not settle it
  });

  test("an ineligible agent is refused before any dispatch", async () => {
    let dispatched = false;
    const invoke = buildFleetInvoker(
      deps(async () => {
        dispatched = true;
        return { sessionId: "s" };
      }),
    );
    const out = await invoke({ ...JOB, agent: "premortem" });
    expect(out).toEqual({ status: "failed", error: "agent not fleet-eligible: premortem" });
    expect(dispatched).toBe(false);
  });

  test("the caller kind is fleet and the clientId is the job name", async () => {
    let seen: { clientId: string; kind: string } | undefined;
    const invoke = buildFleetInvoker(
      deps(async (_m, _p, ctx) => {
        seen = ctx.caller;
        ctx.notify("catchup.briefReady", { sessionId: "s1", brief: "x", findings: {} });
        return { sessionId: "s1" };
      }),
    );
    await invoke(JOB);
    expect(seen).toEqual({ clientId: "j", kind: "fleet" });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test packages/gateway/src/fleet/fleet-invoker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/gateway/src/fleet/fleet-invoker.ts
import type { Database } from "bun:sqlite";
import { buildAgentSynthesisRunner } from "../agents/_lib/agent-synthesis-runner.ts";
import type { SynthesisRouter } from "../agents/_lib/synthesis-llm.ts";
import type { LocalIndex } from "../index/local-index.ts";
import { AgentsRpcError, dispatchAgentsRpc, resolveFleetAgentMethod } from "../ipc/agents-rpc.ts";
import type { FleetRemoteBudget } from "./fleet-synthesis-router.ts";
import { wrapFleetSynthesisRouter } from "./fleet-synthesis-router.ts";
import type { NimbusFleetJobToml } from "../config/fleet-toml.ts";

/** Generous: a cold `impact` on a large index is slow. Bounded because unbounded wedges the fleet. */
export const DEFAULT_JOB_TIMEOUT_MS = 10 * 60_000;

export type FleetJobOutcome =
  | {
      readonly status: "done";
      readonly briefMarkdown: string | null;
      readonly findingsJson: string;
      readonly synthesisJson: string | null;
    }
  | { readonly status: "failed"; readonly error: string };

/** The dispatch seam, injected so the invoker is testable without a live agent stack. */
export type FleetDispatch = (
  method: string,
  params: unknown,
  ctx: {
    db: Database;
    notify: (m: string, p: unknown) => void;
    index?: LocalIndex;
    configDir?: string;
    runner?: ReturnType<typeof buildAgentSynthesisRunner>;
    caller?: { clientId: string; kind: "fleet" };
  },
) => Promise<unknown>;

export interface FleetInvokerDeps {
  readonly db: Database;
  readonly router: SynthesisRouter | undefined;
  readonly budget: FleetRemoteBudget;
  readonly index?: LocalIndex;
  readonly configDir?: string;
  readonly timeoutMs?: number;
  /** Defaults to the real `dispatchAgentsRpc`. */
  readonly dispatch?: FleetDispatch;
}

export type FleetInvoker = (job: NimbusFleetJobToml) => Promise<FleetJobOutcome>;

function sessionIdOf(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as { sessionId?: unknown };
  return typeof v.sessionId === "string" && v.sessionId !== "" ? v.sessionId : undefined;
}

function readReady(p: unknown): { brief: string | null; findings: unknown; synthesis: unknown } {
  const v = (p ?? {}) as { brief?: unknown; findings?: unknown; synthesis?: unknown };
  return {
    brief: typeof v.brief === "string" ? v.brief : null,
    findings: v.findings ?? {},
    synthesis: v.synthesis ?? null,
  };
}

/**
 * Runs ONE fleet job to completion.
 *
 * `agents/_lib/emit-brief.ts` builds and synthesises on a DETACHED promise and returns
 * `{ sessionId }` immediately, so awaiting `dispatchAgentsRpc` awaits the SCHEDULING of the work,
 * not the work. A scheduler looping over that would launch every job concurrently — saturating the
 * machine it was meant to use gently, and making both the between-jobs re-probe and
 * yield-at-job-boundary unreachable. So this settles on the completion NOTIFICATION instead.
 */
export function buildFleetInvoker(deps: FleetInvokerDeps): FleetInvoker {
  const dispatch: FleetDispatch = deps.dispatch ?? (dispatchAgentsRpc as unknown as FleetDispatch);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;

  return async (job) => {
    const method = resolveFleetAgentMethod(job.agent);
    if (method === null) {
      return { status: "failed", error: `agent not fleet-eligible: ${job.agent}` };
    }

    const baseRunner = buildAgentSynthesisRunner({
      db: deps.db,
      method,
      ...(deps.configDir === undefined ? {} : { configDir: deps.configDir }),
      // I38: the router the runner sees is always the wrapped one.
      router: deps.router === undefined ? undefined : wrapFleetSynthesisRouter(deps.router, deps.budget),
    });

    return await new Promise<FleetJobOutcome>((resolve) => {
      let settled = false;
      let expected: string | undefined;
      const pending: Array<{ m: string; p: unknown }> = [];

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ status: "failed", error: `job ${job.name} timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      const settle = (outcome: FleetJobOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      const consider = (m: string, p: unknown): void => {
        // The notification can arrive BEFORE dispatch returns (a synchronous emitter), so the
        // sessionId may not be known yet. Queue until it is rather than dropping the answer.
        if (expected === undefined) {
          pending.push({ m, p });
          return;
        }
        if (sessionIdOf(p) !== expected) return;
        if (m.endsWith(".briefReady")) {
          const r = readReady(p);
          settle({
            status: "done",
            briefMarkdown: r.brief,
            findingsJson: JSON.stringify(r.findings),
            synthesisJson: r.synthesis === null ? null : JSON.stringify(r.synthesis),
          });
        } else if (m.endsWith(".briefError")) {
          const e = (p ?? {}) as { error?: unknown };
          settle({ status: "failed", error: typeof e.error === "string" ? e.error : "unknown error" });
        }
      };

      void (async () => {
        try {
          const out = await dispatch(method, job.params, {
            db: deps.db,
            notify: consider,
            ...(deps.index === undefined ? {} : { index: deps.index }),
            ...(deps.configDir === undefined ? {} : { configDir: deps.configDir }),
            ...(baseRunner === undefined ? {} : { runner: baseRunner }),
            // Server-derived on both fields: the gateway's own scheduler is calling, so this is a
            // fact, not a client's claim (D28 confines this literal to this file).
            caller: { clientId: job.name, kind: "fleet" },
          });
          expected = sessionIdOf(out);
          if (expected === undefined) {
            settle({ status: "failed", error: `agent ${job.agent} returned no sessionId` });
            return;
          }
          for (const q of pending.splice(0)) consider(q.m, q.p);
        } catch (e) {
          settle({
            status: "failed",
            error: e instanceof AgentsRpcError ? e.message : String(e),
          });
        }
      })();
    });
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/fleet/fleet-invoker.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Red-prove the sequencing guarantee**

Temporarily replace the promise body with a bare `await dispatch(...)` returning `{status:"done"}`.
Run the suite: the first test MUST fail on `order`. Restore. This is the check that the test can
actually fail — a green test that cannot go red proves nothing.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/fleet/fleet-invoker.ts packages/gateway/src/fleet/fleet-invoker.test.ts
git commit -m "feat(fleet): dispatch a job and await its completion notification"
```

---

### Task 7: `fleet-admission.ts` and `fleet-scheduler.ts`

**Files:**

- Create: `packages/gateway/src/fleet/fleet-admission.ts`
- Create: `packages/gateway/src/fleet/fleet-scheduler.ts`
- Test: `packages/gateway/src/fleet/fleet-admission.test.ts`
- Test: `packages/gateway/src/fleet/fleet-scheduler.test.ts`

**Interfaces:**

- Consumes: `HostActivity`/`HostActivityProbe` (Task 1), `FleetStore` (Task 2),
  `NimbusFleetToml`/`NimbusFleetJobToml` (Task 3), `FleetInvoker` (Task 6),
  `FleetRemoteBudget` (Task 5).
- Produces: `admitFleetRun(probe, config): AdmissionVerdict`, `FleetScheduler` with
  `runOnce(opts?): Promise<FleetRunSummary>`, `start()`, `stop()`; type `FleetRunSummary`.

- [ ] **Step 1: Write the failing admission test**

```ts
// packages/gateway/src/fleet/fleet-admission.test.ts
import { expect, test } from "bun:test";
import { admitFleetRun } from "./fleet-admission.ts";

const CONFIG = { requireAcPower: true, minIdleSeconds: 900 };

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
  expect(admitFleetRun({ power: "ac", idleMs: 1_200_000, source: "measured" }, CONFIG).admitted).toBe(true);
});

test("unknown power admits — a desktop or server has no battery to report", () => {
  // The predicate blocks on `battery`, it does not require `ac`. Requiring `ac` would refuse on
  // exactly the hardware this feature is for, and would fail SILENTLY as a fleet that never runs.
  expect(admitFleetRun({ power: "unknown", idleMs: null, source: "power_only" }, CONFIG).admitted).toBe(true);
});

test("an unmeasurable idle signal admits rather than blocking headless Linux", () => {
  expect(admitFleetRun({ power: "ac", idleMs: null, source: "power_only" }, CONFIG).admitted).toBe(true);
});
```

- [ ] **Step 2: Run it, confirm failure, implement admission**

Run: `bun test packages/gateway/src/fleet/fleet-admission.test.ts` → FAIL.

```ts
// packages/gateway/src/fleet/fleet-admission.ts
import type { HostActivityProbe } from "../platform/host-activity.ts";

export interface FleetAdmissionConfig {
  readonly requireAcPower: boolean;
  readonly minIdleSeconds: number;
}

export type AdmissionVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: "on_battery" | "user_active" };

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
 * genuinely idle compute.
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
```

Run again: PASS (6 tests).

- [ ] **Step 3: Write the failing scheduler test**

```ts
// packages/gateway/src/fleet/fleet-scheduler.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { FLEET_V60_SQL } from "../index/fleet-v60-sql.ts";
import type { HostActivityProbe } from "../platform/host-activity.ts";
import { FleetStore } from "./fleet-store.ts";
import { FleetScheduler } from "./fleet-scheduler.ts";
import { DEFAULT_FLEET_CONFIG } from "../config/fleet-toml.ts";

const AC_IDLE: HostActivityProbe = { power: "ac", idleMs: 3_600_000, source: "measured" };
const ON_BATTERY: HostActivityProbe = { power: "battery", idleMs: 3_600_000, source: "measured" };

const JOBS = [
  { name: "a", agent: "catchup", intervalSeconds: 1, params: {} },
  { name: "b", agent: "ownership", intervalSeconds: 1, params: {} },
];

let db: Database;
let store: FleetStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.exec(FLEET_V60_SQL);
  store = new FleetStore(db);
});

function build(opts: {
  probes: HostActivityProbe[];
  invoke: (job: { name: string }) => Promise<{ status: "done" | "failed"; error?: string }>;
  config?: Partial<typeof DEFAULT_FLEET_CONFIG>;
}) {
  let i = 0;
  return new FleetScheduler({
    store,
    jobs: JOBS,
    config: { ...DEFAULT_FLEET_CONFIG, enabled: true, ...opts.config },
    capabilityDisabled: false,
    hostActivity: { probe: async () => opts.probes[Math.min(i++, opts.probes.length - 1)]! },
    invoke: opts.invoke as never,
    now: () => 1_000_000,
  });
}

describe("FleetScheduler.runOnce", () => {
  test("runs jobs strictly one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const s = build({
      probes: [AC_IDLE],
      invoke: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { status: "done" };
      },
    });
    const summary = await s.runOnce();
    expect(maxInFlight).toBe(1);
    expect(summary.outcome).toBe("completed");
    expect(summary.jobsCompleted).toBe(2);
  });

  test("refuses on battery and records deferred, attempting nothing", async () => {
    let called = 0;
    const s = build({
      probes: [ON_BATTERY],
      invoke: async () => {
        called += 1;
        return { status: "done" };
      },
    });
    const summary = await s.runOnce();
    expect(summary.outcome).toBe("deferred");
    expect(called).toBe(0);
  });

  test("yields at a job boundary when the user returns mid-run", async () => {
    // Probe 1 admits the run; probe 2 (between jobs) shows the user back.
    const s = build({ probes: [AC_IDLE, ON_BATTERY], invoke: async () => ({ status: "done" }) });
    const summary = await s.runOnce();
    expect(summary.outcome).toBe("yielded");
    expect(summary.jobsCompleted).toBe(1);
    expect(summary.jobsUnattempted).toBe(1);
  });

  test("a failing job backs off and the run continues", async () => {
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) =>
        job.name === "a" ? { status: "failed", error: "boom" } : { status: "done" },
    });
    const summary = await s.runOnce();
    expect(summary.outcome).toBe("completed");
    expect(summary.jobsCompleted).toBe(1);
    expect(store.loadJobState("a")?.consecutiveFailures).toBe(1);
    expect(store.loadJobState("a")?.backoffUntil).toBeGreaterThan(1_000_000);
  });

  test("a job that ran within its interval is NOT due", async () => {
    // Without this check the 60-second tick reruns every job every minute: a daily job would
    // produce 60 briefs an hour all night, and `interval_seconds` would be parsed and never read.
    store.recordJobSuccess("a", 1_000_000 - 500); // 0.5 s ago; interval is 1 s
    const ran: string[] = [];
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        ran.push(job.name);
        return { status: "done" };
      },
    });
    await s.runOnce();
    expect(ran).toEqual(["b"]);
  });

  test("a job whose interval has elapsed is due again", async () => {
    store.recordJobSuccess("a", 1_000_000 - 5_000); // 5 s ago; interval is 1 s
    const ran: string[] = [];
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        ran.push(job.name);
        return { status: "done" };
      },
    });
    await s.runOnce();
    expect(ran).toEqual(["a", "b"]);
  });

  test("a second tick while a run is in flight is refused, not run concurrently", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const s = build({
      probes: [AC_IDLE],
      invoke: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent -= 1;
        return { status: "done" };
      },
    });
    // A run can outlast the 60 s tick — a cold `ownership` + `impact` with synthesis easily does.
    const [first, second] = await Promise.all([s.runOnce(), s.runOnce()]);
    expect(maxConcurrent).toBe(1);
    expect([first.outcome, second.outcome].sort()).toEqual(["completed", "deferred"]);
    expect([first.runId, second.runId]).toContain(null); // the refused one opened no run row
  });

  test("runOnce({ jobName }) runs only that job", async () => {
    const ran: string[] = [];
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        ran.push(job.name);
        return { status: "done" };
      },
    });
    await s.runOnce({ jobName: "b", force: true });
    expect(ran).toEqual(["b"]);
  });

  test("an unknown jobName throws rather than running everything", async () => {
    const s = build({ probes: [AC_IDLE], invoke: async () => ({ status: "done" }) });
    await expect(s.runOnce({ jobName: "nope" })).rejects.toThrow(/no such fleet job/);
  });

  test("a job inside its backoff window is skipped", async () => {
    store.recordJobFailure("a", 1_000_000, "boom"); // backoff ends 1h later
    const ran: string[] = [];
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        ran.push(job.name);
        return { status: "done" };
      },
    });
    await s.runOnce();
    expect(ran).toEqual(["b"]);
  });

  test("force skips ADMISSION only, never the disabled capability", async () => {
    let called = 0;
    const s = build({
      probes: [ON_BATTERY],
      invoke: async () => {
        called += 1;
        return { status: "done" };
      },
    });
    await s.runOnce({ force: true });
    expect(called).toBe(2);
  });

  test("a disabled capability refuses even with force", async () => {
    const s = new FleetScheduler({
      store,
      jobs: JOBS,
      config: { ...DEFAULT_FLEET_CONFIG, enabled: true },
      capabilityDisabled: true,
      hostActivity: { probe: async () => AC_IDLE },
      invoke: (async () => ({ status: "done" })) as never,
      now: () => 1,
    });
    await expect(s.runOnce({ force: true })).rejects.toThrow(/org policy/);
  });

  test("a disabled config refuses before it probes anything", async () => {
    let probed = 0;
    const s = new FleetScheduler({
      store,
      jobs: JOBS,
      config: DEFAULT_FLEET_CONFIG, // enabled: false
      capabilityDisabled: false,
      hostActivity: {
        probe: async () => {
          probed += 1;
          return AC_IDLE;
        },
      },
      invoke: (async () => ({ status: "done" })) as never,
      now: () => 1,
    });
    await expect(s.runOnce()).rejects.toThrow(/disabled/);
    expect(probed).toBe(0);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `bun test packages/gateway/src/fleet/fleet-scheduler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the scheduler**

```ts
// packages/gateway/src/fleet/fleet-scheduler.ts
import type { NimbusFleetJobToml, NimbusFleetToml } from "../config/fleet-toml.ts";
import type { HostActivity } from "../platform/host-activity.ts";
import { admitFleetRun } from "./fleet-admission.ts";
import type { FleetInvoker } from "./fleet-invoker.ts";
import type { FleetRunOutcome, FleetStore } from "./fleet-store.ts";

export class FleetDisabledError extends Error {}

export interface FleetRunSummary {
  readonly runId: string | null;
  readonly outcome: FleetRunOutcome;
  readonly jobsAttempted: number;
  readonly jobsCompleted: number;
  readonly jobsUnattempted: number;
}

export interface FleetSchedulerDeps {
  readonly store: FleetStore;
  readonly jobs: readonly NimbusFleetJobToml[];
  readonly config: NimbusFleetToml;
  /** `EnforcedPolicy.capabilitiesDisabled.has("agent_fleet")`, resolved by the caller (I22). */
  readonly capabilityDisabled: boolean;
  readonly hostActivity: HostActivity;
  readonly invoke: FleetInvoker;
  readonly now: () => number;
  readonly remoteCallsMade?: () => number;
}

const TICK_MS = 60_000;

/**
 * Whether a job is due: past its backoff, and at least `interval_seconds` since its last SUCCESS.
 *
 * Keyed on `lastSuccessAt`, not `lastAttemptAt`: a job that failed should be retried when its
 * backoff expires, not held off for a full interval on top. A job that has never succeeded is due.
 */
export function isJobDue(
  job: NimbusFleetJobToml,
  state: FleetJobState | undefined,
  now: number,
): boolean {
  if (state?.backoffUntil != null && state.backoffUntil > now) return false;
  if (state?.lastSuccessAt == null) return true;
  return now - state.lastSuccessAt >= job.intervalSeconds * 1000;
}

export class FleetScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  /**
   * Re-entrancy guard. `start()` ticks every 60 s, and a real run — a cold `ownership` plus an
   * `impact` with synthesis — routinely takes minutes. Without this, tick N+1 opens a second
   * `fleet_run`, interleaves its writes with the first, and puts two jobs on the local model at
   * once: the exact concurrency the sequential invoker (Task 6) exists to prevent, reintroduced
   * one level up.
   */
  private inFlight = false;

  constructor(private readonly deps: FleetSchedulerDeps) {}

  start(): void {
    if (this.timer !== undefined) return;
    // `unref` so a pending tick never holds the process open — a hung fleet timer would make
    // `bun test` and a clean gateway shutdown hang identically.
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * One pass. `force` skips ADMISSION ONLY — the idle/power checks, which exist to protect the
   * user's machine and which an owner typing the command is by definition present to override. It
   * never skips the config kill-switch, the org-policy lockoff, eligibility, or I38's budget.
   */
  async runOnce(opts?: { force?: boolean; jobName?: string }): Promise<FleetRunSummary> {
    // Ordering mirrors I33: local kill-switch, then org policy, BOTH before any work — so a
    // disabled capability never advertises itself by probing hardware or opening a run row.
    if (!this.deps.config.enabled) {
      throw new FleetDisabledError("fleet is disabled ([fleet] enabled = false)");
    }
    if (this.deps.capabilityDisabled) {
      throw new FleetDisabledError("fleet is disabled by org policy");
    }

    const jobs =
      opts?.jobName === undefined
        ? this.deps.jobs
        : this.deps.jobs.filter((j) => j.name === opts.jobName);
    // Throws rather than running everything: `nimbus fleet run typo` must not become
    // "run every configured job", which is the worst possible reading of a typo.
    if (opts?.jobName !== undefined && jobs.length === 0) {
      throw new FleetDisabledError(`no such fleet job: ${opts.jobName}`);
    }

    if (this.inFlight) {
      return {
        runId: null,
        outcome: "deferred",
        jobsAttempted: 0,
        jobsCompleted: 0,
        jobsUnattempted: jobs.length,
      };
    }
    this.inFlight = true;
    try {
      return await this.execute(jobs, opts);
    } finally {
      this.inFlight = false;
    }
  }

  private async execute(
    jobs: readonly NimbusFleetJobToml[],
    opts?: { force?: boolean; jobName?: string },
  ): Promise<FleetRunSummary> {
    const probe = await this.deps.hostActivity.probe();
    const verdict = admitFleetRun(probe, {
      requireAcPower: this.deps.config.requireAcPower,
      minIdleSeconds: this.deps.config.minIdleSeconds,
    });

    const startedAt = this.deps.now();
    const runId = this.deps.store.openRun({
      startedAt,
      hostPower: probe.power,
      hostIdleMs: probe.idleMs,
      hostSource: probe.source,
      remoteCallBudget: this.deps.config.remoteCallBudget,
    });

    const close = (outcome: FleetRunOutcome, attempted: number, completed: number): FleetRunSummary => {
      this.deps.store.closeRun(runId, {
        endedAt: this.deps.now(),
        outcome,
        jobsAttempted: attempted,
        jobsCompleted: completed,
        remoteCallsMade: this.deps.remoteCallsMade?.() ?? 0,
      });
      return {
        runId,
        outcome,
        jobsAttempted: attempted,
        jobsCompleted: completed,
        jobsUnattempted: jobs.length - attempted,
      };
    };

    if (!verdict.admitted && opts?.force !== true) {
      return close("deferred", 0, 0);
    }

    const expiresAt = startedAt + this.deps.config.retentionDays * 86_400_000;
    let attempted = 0;
    let completed = 0;

    for (const job of jobs) {
      // Re-probe BETWEEN jobs, not only at the start. Stopping at a boundary rather than mid-brief
      // is why the boundary exists: a half-written brief is worse than an absent one.
      if (attempted > 0 && opts?.force !== true) {
        const again = await this.deps.hostActivity.probe();
        const stillOk = admitFleetRun(again, {
          requireAcPower: this.deps.config.requireAcPower,
          minIdleSeconds: this.deps.config.minIdleSeconds,
        });
        if (!stillOk.admitted) return close("yielded", attempted, completed);
      }

      // Due check AND backoff, both inside `isJobDue`. `force` (an owner at a keyboard) overrides
      // the schedule; it does not override the capability, eligibility or the I38 budget.
      const state = this.deps.store.loadJobState(job.name);
      if (opts?.force !== true && !isJobDue(job, state, this.deps.now())) continue;

      attempted += 1;
      const outcome = await this.deps.invoke(job);
      if (outcome.status === "done") {
        this.deps.store.recordBrief({
          runId,
          jobId: job.name,
          agentMethod: `agents.${job.agent}`,
          briefMarkdown: outcome.briefMarkdown,
          findingsJson: outcome.findingsJson,
          synthesisJson: outcome.synthesisJson,
          createdAt: this.deps.now(),
          expiresAt,
        });
        this.deps.store.recordJobSuccess(job.name, this.deps.now());
        completed += 1;
      } else {
        // Isolated, not fatal. A run that aborted on the first bad config line would let one stale
        // entry silence every other brief indefinitely — and overnight, nobody notices.
        this.deps.store.recordJobFailure(job.name, this.deps.now(), outcome.error);
      }
    }

    return close("completed", attempted, completed);
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `bun test packages/gateway/src/fleet`
Expected: PASS (all files).

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/fleet
git commit -m "feat(fleet): add host admission and the sequential scheduler"
```

---

### Task 8: Org policy, gateway wiring, LAN forbid, and retention

**Files:**

- Modify: `packages/gateway/src/policy/types.ts`
- Modify: `packages/gateway/src/platform/assemble.ts`
- Modify: `packages/gateway/src/ipc/lan-rpc.ts`
- Modify: `packages/gateway/src/embedding/create-embedding-runtime.ts`
- Test: `packages/gateway/src/policy/types.test.ts` (extend), `packages/gateway/src/ipc/lan-rpc.test.ts` (extend)

**Interfaces:**

- Consumes: everything from Tasks 1–7.
- Produces: `AI_V2_CAPABILITIES` gains `"agent_fleet"`; `PlatformServices` gains
  `fleetScheduler?: FleetScheduler`.

- [ ] **Step 1: Write the failing policy and LAN tests**

```ts
// in packages/gateway/src/policy/types.test.ts
test("agent_fleet is a lockoff-able ai_v2 capability", () => {
  expect(AI_V2_CAPABILITIES).toContain("agent_fleet");
  expect(AI_V2_CAPABILITIES).toHaveLength(6);
});
```

```ts
// in packages/gateway/src/ipc/lan-rpc.test.ts
test("the whole fleet namespace is forbidden over LAN", () => {
  // A LAN peer must not be able to trigger unattended local work or read last night's briefs.
  expect(() => checkLanMethodAllowed("fleet.runNow", { peerId: "p", writeAllowed: true })).toThrow(
    /not callable over LAN/,
  );
  expect(() => checkLanMethodAllowed("fleet.briefs", { peerId: "p", writeAllowed: true })).toThrow(
    /not callable over LAN/,
  );
});
```

- [ ] **Step 2: Run both, confirm failure**

Run: `bun test packages/gateway/src/policy packages/gateway/src/ipc/lan-rpc.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the capability and the LAN forbid**

`policy/types.ts` — append inside `AI_V2_CAPABILITIES`:

```ts
  "agent_fleet",
```

`ipc/lan-rpc.ts` — add to `FORBIDDEN_OVER_LAN`, with its reason:

```ts
  // The whole namespace. `fleet.runNow` would let a peer spend the owner's CPU (and, under
  // `allow_remote`, their frontier budget) unattended; `fleet.briefs`/`fleet.show` would hand a
  // peer last night's synthesised answers over the private index. Neither is a LAN surface.
  "fleet",
```

- [ ] **Step 4: Wire the scheduler in `assemble.ts`**

Construct only when configured, so a gateway with no `[fleet]` block builds nothing.

**Use the `db` handle `openGatewaySqlite` returns (`assemble.ts:357`), NOT `localIndex.db`** — that
field is `private readonly` (`local-index.ts:283`) and will not typecheck. `assemble.ts` already
threads this same `Database` into a dozen subsystems; follow the nearest one.

**Resolve the profile TOML, and never crash boot on a bad `[fleet]` block.** The parser throws
(Task 3); this is the caller that catches, logs loudly and leaves the fleet off — the gateway must
still boot, because the fleet is an optional default-off feature and the index is not.

```ts
  // A PATH, profile-resolved. `nimbus.work.toml`'s [fleet] must not be silently ignored the way
  // `[agents] synthesis` once was — see `loadNimbusAgentsFromPath`'s comment for that history.
  const fleetToml = resolveNimbusTomlForProfile(paths.configDir);
  let fleet = { config: DEFAULT_FLEET_CONFIG, jobs: [] as NimbusFleetJobToml[] };
  try {
    fleet = loadNimbusFleetFromPath(fleetToml);
  } catch (err) {
    // Loud, and fail-closed: no scheduler rather than a half-read one.
    logger.error(`[fleet] config error in ${fleetToml} — fleet disabled: ${String(err)}`);
  }

  const fleetScheduler =
    fleet.config.enabled && fleet.jobs.length > 0
      ? new FleetScheduler({
          store: new FleetStore(db),
          jobs: fleet.jobs,
          config: fleet.config,
          capabilityDisabled: policyHitl.enforced.capabilitiesDisabled.has("agent_fleet"),
          hostActivity,
          invoke: buildFleetInvoker({
            db,
            router: llmRegistry.llmRouter,
            budget: createFleetRemoteBudget(fleet.config.allowRemote, fleet.config.remoteCallBudget),
            index: localIndex,
            configDir: paths.configDir,
          }),
          now: () => Date.now(),
        })
      : undefined;

  if (fleetScheduler !== undefined) {
    fleetScheduler.start();
    // `assemble.ts` already collects teardown callbacks here (see `openGatewaySqlite`, line 357).
    // Without this the 60 s interval outlives `disposeSidecars()`; `.unref()` keeps it from
    // holding the process open but does not stop it firing during a shutdown that is still
    // draining.
    sidecarStops.push(() => fleetScheduler.stop());
  }
```

Add `fleetScheduler?: FleetScheduler` to `PlatformServices` in `platform/types.ts`.

**Prune at boot**, using a retention that is a policy FLOOR:

```ts
  const retentionDays = Math.max(
    fleet.config.retentionDays,
    policyHitl.enforced.retention?.minDays ?? 0,
  );
  // `pruneRuns` first: the FK cascade takes each run's briefs with it, which is what keeps
  // `fleet_run` from growing one row per 60-second tick forever. `pruneBriefs` then catches any
  // brief whose own expiry is earlier than its run's age.
  const cutoff = Date.now() - retentionDays * 86_400_000;
  new FleetStore(db).pruneRuns(cutoff);
  new FleetStore(db).pruneBriefs(Date.now());
```

A floor, not an override: an org that requires 30 days of evidence cannot have it deleted by a
local `retention_days = 7`.

- [ ] **Step 5: Wire the dead `pause_on_battery` key**

In `packages/gateway/src/embedding/create-embedding-runtime.ts`, accept `hostActivity` on the deps
and gate the background backfill loop:

```ts
  // `[embedding] pause_on_battery` has parsed and defaulted to `true` since it was added, and
  // nothing has ever read it — a key that lied about what it does. `HostActivity` is what it
  // always needed.
  if (config.pauseOnBattery && (await deps.hostActivity.probe()).power === "battery") {
    return; // resume on the next tick, when power is back
  }
```

Add a test asserting the loop does not process a chunk when the probe reports `battery` and
`pauseOnBattery` is true, and does when it is false.

- [ ] **Step 6: Run the full gateway suite and preflight**

Run: `bun test packages/gateway && bun run preflight:fast`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src
git commit -m "feat(fleet): wire the scheduler, add the agent_fleet lockoff, forbid fleet over LAN, and make pause_on_battery real"
```

---

### Task 9: IPC methods and the `nimbus fleet` CLI

**Files:**

- Create: `packages/gateway/src/ipc/fleet-rpc.ts`
- Create: `packages/cli/src/commands/fleet.ts`
- Test: `packages/gateway/src/ipc/fleet-rpc.test.ts`, `packages/cli/src/commands/fleet.test.ts`
- Modify: `packages/gateway/src/ipc/server/dispatchers.ts`, `packages/cli/src/index.ts`

**Interfaces:**

- Consumes: `FleetScheduler`, `FleetStore`.
- Produces: IPC `fleet.status`, `fleet.list`, `fleet.briefs`, `fleet.show`, `fleet.runNow`;
  CLI `runFleet(args: string[]): Promise<number>`.

- [ ] **Step 1: Write the failing IPC test**

```ts
// packages/gateway/src/ipc/fleet-rpc.test.ts
import { expect, test } from "bun:test";
import { dispatchFleetRpc } from "./fleet-rpc.ts";

test("fleet.status reports the live probe and config without running anything", async () => {
  const out = await dispatchFleetRpc("fleet.status", {}, {
    scheduler: undefined,
    store: undefined,
    hostActivity: { probe: async () => ({ power: "ac", idleMs: 1000, source: "measured" }) },
    config: { enabled: false },
  } as never);
  expect(out).toMatchObject({ hit: true });
});

test("an unknown fleet method is a miss, not a throw", async () => {
  const out = await dispatchFleetRpc("fleet.nope", {}, {} as never);
  expect(out).toMatchObject({ hit: false });
});
```

- [ ] **Step 2: Run it, confirm failure, implement `fleet-rpc.ts`**

Follow `ipc/egress-rpc.ts`'s shape exactly: a `dispatchByMethod` handler map returning
`RpcMissOrHit` and every read returning plain JSON.

`fleet.runNow` takes `{ job?: string; force?: boolean }` and calls
`scheduler.runOnce({ jobName: params.job, force: params.force === true })`. **`jobName` must be
threaded through** — without it `nimbus fleet run morning_catchup` runs every configured job, and a
mistyped job name would run all of them rather than erroring. Add a test asserting that a
`fleet.runNow` with `{ job: "b" }` reaches `runOnce` with `jobName: "b"`. Register it in `ipc/server/dispatchers.ts` beside the `exec.` branch:

```ts
  if (method.startsWith("fleet.")) return await dispatchFleetRpc(method, params, fleetCtx);
```

`fleet.*` is absent from the Tauri `ALLOWED_METHODS` (I7): `runNow` spends the machine's resources
and the reads return synthesised answers over the private index, neither of which the renderer
needs. Add an assertion in the Rust allowlist test that no `fleet.` method is present.

- [ ] **Step 3: Write the failing CLI test**

```ts
// packages/cli/src/commands/fleet.test.ts
import { expect, test } from "bun:test";
import { parseFleetArgs } from "./fleet.ts";

test("parses the subcommands", () => {
  expect(parseFleetArgs(["status"])).toEqual({ sub: "status", json: false });
  expect(parseFleetArgs(["briefs", "--limit", "5", "--json"])).toEqual({
    sub: "briefs",
    limit: 5,
    json: true,
  });
  expect(parseFleetArgs(["run", "morning_catchup", "--force"])).toEqual({
    sub: "run",
    job: "morning_catchup",
    force: true,
    json: false,
  });
});

test("an unknown subcommand is rejected", () => {
  expect(parseFleetArgs(["frobnicate"])).toBeUndefined();
});

test("run without a job name is rejected", () => {
  expect(parseFleetArgs(["run"])).toBeUndefined();
});
```

- [ ] **Step 4: Implement the CLI**

Model it on `packages/cli/src/commands/computer.ts`: a `FLEET_EXIT_CODES` map, `withGatewayIpc` for
transport, `--json` on every read. Register in `packages/cli/src/index.ts`:

```ts
  fleet: runFleet,
```

`--force` help text must say what it does and does not skip: *"run now even if the host is on
battery or in use. Does not bypass `[fleet] enabled`, org policy, agent eligibility, or the remote
call budget."*

- [ ] **Step 5: Run the tests**

Run: `bun test packages/gateway/src/ipc packages/cli/src/commands/fleet.test.ts && bun run audit:readme-cli`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/ipc packages/cli/src
git commit -m "feat(fleet): add the fleet.* IPC namespace and the nimbus fleet CLI"
```

---

### Task 10: Invariant I38, static rule D28 docs, and the enforcement test

The triple rule: wiring (already landed), docs and test in one commit.

**Files:**

- Modify: `packages/gateway/src/security-invariants.test.ts`
- Modify: `docs/SECURITY-INVARIANTS.md`

- [ ] **Step 1: Write the I38 enforcement test**

```ts
// in packages/gateway/src/security-invariants.test.ts
describe("I38 — an unattended fleet run reaches a non-local model only under grant + budget", () => {
  test("without allow_remote, a remote provider is withheld AND refused", async () => {
    const budget = createFleetRemoteBudget(false, 0);
    const inner: SynthesisRouter = {
      resolveForSynthesis: async () => REMOTE_PROVIDER,
      generateMarkdown: async () => "should not happen",
    };
    const wrapped = wrapFleetSynthesisRouter(inner, budget);
    expect(await wrapped.resolveForSynthesis(true)).toBeUndefined();
    await expect(wrapped.generateMarkdown("p", REMOTE_PROVIDER)).rejects.toThrow(/allow_remote/);
  });

  test("a frontier key enabled for interactive use does not itself grant the fleet anything", () => {
    // The capability is `[fleet] allow_remote`'s alone — the same shape as I37's per-artifact
    // grant, where an `[llm.remote.<vendor>]` key that works for `nimbus ask` grants no vision.
    expect(createFleetRemoteBudget(false, 100).remaining()).toBe(0);
  });

  test("the budget is a hard stop, not a soft preference", () => {
    const budget = createFleetRemoteBudget(true, 2);
    expect(budget.consume()).toBe(true);
    expect(budget.consume()).toBe(true);
    expect(budget.consume()).toBe(false);
  });

  test("locality is derived from provider.isLocal (I34), never from the vendor id", async () => {
    const budget = createFleetRemoteBudget(false, 0);
    let called = false;
    const wrapped = wrapFleetSynthesisRouter(
      {
        resolveForSynthesis: async () => undefined,
        generateMarkdown: async () => {
          called = true;
          return "ok";
        },
      },
      budget,
    );
    // providerId reads remote; isLocal says otherwise, and isLocal is what governs.
    await wrapped.generateMarkdown("p", { providerId: "openai", modelName: "m", isLocal: true });
    expect(called).toBe(true);
  });

  test("a fleet brief appends no egress row — the fleet kind is non-bearing", () => {
    expect(egressSourceTypeForClientKind("fleet")).toBeNull();
  });

  test("fleet is NOT declarable by a socket client — attribution stays a fact", () => {
    const store = new ClientKindStore();
    expect(store.declare("c1", "fleet")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun test packages/gateway/src/security-invariants.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 3: Add the `docs/SECURITY-INVARIANTS.md` row**

A full I38 section following the I37 template: statement, rationale, the two-door reasoning for
guarding both `SynthesisRouter` methods, the rejected `setTaskPin`/`enforce_air_gap` alternatives,
the D28 confinement, and the anti-patterns (recomputing locality from a vendor id; a budget that
warns instead of stopping; adding `fleet` to `RECOGNISED`).

- [ ] **Step 4: Verify the invariant count gates**

Run: `bun run audit:status-drift && bun run audit:doc-refs && bun run audit:nimbus-invariants`
Expected: PASS. If a gate asserts an invariant count, update it to I38 — and re-derive the
enumeration, not just the number.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/security-invariants.test.ts docs/SECURITY-INVARIANTS.md
git commit -m "feat(fleet): add invariant I38 with its enforcement test and docs row"
```

---

### Task 11: Documentation and the roadmap row

**Files:**

- Modify: `docs/roadmap.md`, `docs/CHANGELOG.md`, `docs/architecture.md`, `docs/cli-reference.md`,
  `CLAUDE.md`, `GEMINI.md`, `.claude/commands/nimbus-file-map.md`

- [ ] **Step 1: Check the S2 row in `docs/roadmap.md` § Active**

Mark *"[NEW] Overnight sub-agent fleets on zero-marginal local compute"* as shipped for **PR 1 of 2**,
and state plainly what did NOT ship: subject enumeration, the change/threshold digest, `negotiate`'s
classification (still `deferred`), and PowerShell-free per-OS idle measurement on Linux. Update the
"3 of 5 rows shipped" count to 4 of 5 — and re-derive the list, since a count that stays right while
its enumeration goes wrong is a failure mode this repo has already had.

- [ ] **Step 2: Add the `docs/CHANGELOG.md` entry**

Dated, naming V60, I38, D28, `agent_fleet`, and the `pause_on_battery` fix.

- [ ] **Step 3: Update `CLAUDE.md` and `GEMINI.md` together**

Both carry the invariant list and the S2 status paragraph; they mirror each other and drift if only
one is edited. Add I38 and D28, bump the schema to V59 → V60, and add `agent_fleet` as the sixth
`ai_v2` capability.

- [ ] **Step 4: Update `docs/cli-reference.md` and `docs/architecture.md`**

The five `nimbus fleet` subcommands, the `fleet.*` IPC namespace and its LAN-forbidden status, and
the V60 tables in the schema reference.

- [ ] **Step 5: Run the full preflight**

Run: `bun run preflight`
Expected: PASS. `audit:doc-refs`, `audit:status-drift` and `lint:markdown` all read these files.

- [ ] **Step 6: Commit and open the PR**

```bash
git add docs CLAUDE.md GEMINI.md .claude/commands
git commit -m "docs(fleet): record PR 1 of the overnight fleet row, I38, D28 and V60"
git push -u origin dev/asaf/s2-overnight-agent-fleets
```

PR title (this becomes the squash commit, and release-please parses it):
`feat(fleet): overnight sub-agent fleets on local compute — S2 PR 1 of 2`

The PR body must state the honesty bounds explicitly: Linux idle is never measured (power-only
admission, disclosed per run); the CI-runner probe expectations are expectations until the
cross-platform legs actually run; `negotiate` is classified `deferred`, not eligible; and PR 2 (the
sweep and digest) is unbuilt.

---

## Self-Review

**Spec coverage.** § 4 → Tasks 1 + 7; § 4.1 dead key → Task 8; § 5 → Tasks 5–7; § 5.1.1 → Task 6;
§ 6 → Task 4; § 7 → Task 4; § 8 + 8.1 → Tasks 5 + 10; § 9 → Tasks 2 + 8 (retention floor);
§ 10 → Tasks 3, 8, 9; § 11 → distributed across each task's tests. No spec section is unimplemented.

**Type consistency.** `HostActivityProbe` fields (`power`/`idleMs`/`source`) are identical in
Tasks 1, 7, 8. `FleetJobOutcome`'s `done` arm carries `briefMarkdown`/`findingsJson`/`synthesisJson`
in Task 6 and is consumed with exactly those names in Task 7. `FleetStore.recordBrief` takes the same
field names it is called with. `admitFleetRun` returns `{admitted}` in both its definition and both
call sites.

**Review divergence, recorded so it is not re-raised.** The review proposed defaulting a missing
`interval_seconds` to 86,400. Not taken: that trades one silent failure for another — the owner gets
a daily schedule they never chose, on a job they may have meant to run hourly. The original draft
was worse (it dropped such a job silently, so the owner believed it was configured). Task 3 refuses
instead, which is the only outcome the owner can actually see, and matches how `[fleet] allow_remote`
without a budget is handled. Task 8 catches that throw so the gateway still boots with the fleet off,
which is why refusing is affordable here.

**Known gap, deliberately carried:** the CI-runner probe behaviour in spec § 12 is an expectation,
not a measurement. Task 1's Step 8 test is written to assert the *contract* on whichever OS runs it
rather than to skip, so the first cross-platform CI run is what converts it into a measurement —
and if a runner behaves differently, that test fails loudly rather than passing vacuously.
