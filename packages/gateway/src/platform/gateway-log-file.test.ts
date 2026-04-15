import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createGatewayPinoLogger,
  gatewayDailyLogPath,
  gatewayLogBasename,
} from "./gateway-log-file.ts";

test("gatewayLogBasename matches gateway-YYYY-MM-DD.log", () => {
  const name = gatewayLogBasename();
  expect(name).toMatch(/^gateway-\d{4}-\d{2}-\d{2}\.log$/);
});

test("gatewayDailyLogPath joins logDir and basename", () => {
  const base = join(tmpdir(), "nimbus-logs-test");
  const p = gatewayDailyLogPath(base);
  expect(p.endsWith(gatewayLogBasename())).toBe(true);
  expect(p.startsWith(base)).toBe(true);
});

let savedIsTTY: boolean | undefined;

afterEach(() => {
  if (savedIsTTY !== undefined) {
    Object.defineProperty(process.stdout, "isTTY", {
      value: savedIsTTY,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    savedIsTTY = undefined;
  }
});

test("createGatewayPinoLogger appends JSON to daily log file when stdout is not a TTY", async () => {
  savedIsTTY = process.stdout.isTTY;
  Object.defineProperty(process.stdout, "isTTY", {
    value: false,
    configurable: true,
    enumerable: true,
    writable: true,
  });

  const dir = mkdtempSync(join(tmpdir(), "nimbus-gw-log-"));
  try {
    const log = createGatewayPinoLogger(dir);
    log.warn("unit_gateway_log_probe");
    await Bun.sleep(150);
    const files = readdirSync(dir);
    const daily = files.find((f) => f.startsWith("gateway-") && f.endsWith(".log"));
    if (daily === undefined) {
      throw new Error("expected gateway-*.log in temp dir");
    }
    const content = readFileSync(join(dir, daily), "utf8");
    expect(content).toContain("unit_gateway_log_probe");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
