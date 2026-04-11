/**
 * Stop processes running the compiled gateway binary (by image name).
 * Used when gateway.json is missing or `rename`/`overwrite` of dist/nimbus-gateway fails on Windows.
 */
import { spawnSync } from "node:child_process";

export type TerminateGatewayBinaryResult = {
  ran: boolean;
  message: string;
};

export function terminateCompiledGatewayBinary(): TerminateGatewayBinaryResult {
  if (process.platform === "win32") {
    const r = spawnSync("taskkill", ["/F", "/IM", "nimbus-gateway.exe", "/T"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (r.status === 0) {
      return { ran: true, message: "Terminated nimbus-gateway.exe (and child processes)." };
    }
    // 128: "not found" for taskkill
    if (r.status === 128) {
      return { ran: true, message: "No nimbus-gateway.exe process was running." };
    }
    const statusMsg = `taskkill exited ${String(r.status)}`;
    const detail = combined === "" ? "" : `: ${combined}`;
    return {
      ran: true,
      message: `${statusMsg}${detail}`,
    };
  }

  let r = spawnSync("killall", ["nimbus-gateway"], { stdio: "ignore" });
  const killallErr = r.error;
  if (
    killallErr !== undefined &&
    killallErr !== null &&
    typeof killallErr === "object" &&
    "code" in killallErr &&
    killallErr.code === "ENOENT"
  ) {
    r = spawnSync("pkill", ["-x", "nimbus-gateway"], { stdio: "ignore" });
  }
  if (r.status === 0) {
    return { ran: true, message: "Sent signal to nimbus-gateway process(es)." };
  }
  return { ran: true, message: "No nimbus-gateway process found (killall/pkill)." };
}
