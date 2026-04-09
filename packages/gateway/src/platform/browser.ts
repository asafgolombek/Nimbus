import { type SpawnOptions, spawn } from "node:child_process";
import { win32 as pathWin32 } from "node:path";

/**
 * Opens a URL in the user's default browser (PAL — all platforms).
 * Does not validate the URL; callers must pass a trusted https/http URL.
 *
 * Spawns only fixed, absolute binaries (no PATH lookup for argv0 — Sonar S4036).
 */
export async function openUrlInDefaultBrowser(url: string): Promise<void> {
  const detachedIgnore: SpawnOptions = { detached: true, stdio: "ignore" };

  return new Promise((resolve, reject) => {
    const os = process.platform;
    let child: ReturnType<typeof spawn>;
    if (os === "win32") {
      const systemRoot = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
      const cmdExe = pathWin32.join(systemRoot, "System32", "cmd.exe");
      child = spawn(cmdExe, ["/c", "start", "", url], {
        ...detachedIgnore,
        windowsHide: true,
      });
    } else if (os === "darwin") {
      child = spawn("/usr/bin/open", [url], detachedIgnore);
    } else {
      child = spawn("/usr/bin/xdg-open", [url], detachedIgnore);
    }
    child.on("error", reject);
    child.unref();
    resolve();
  });
}
