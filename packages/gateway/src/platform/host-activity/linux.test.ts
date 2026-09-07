import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
