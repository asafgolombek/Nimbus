import { spawn } from "node:child_process";

/**
 * Opens a URL in the user's default browser (PAL — all platforms).
 * Does not validate the URL; callers must pass a trusted https/http URL.
 */
export async function openUrlInDefaultBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const os = process.platform;
    let child: ReturnType<typeof spawn>;
    if (os === "win32") {
      child = spawn("cmd.exe", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    } else if (os === "darwin") {
      child = spawn("open", [url], { detached: true, stdio: "ignore" });
    } else {
      child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    }
    child.on("error", reject);
    child.unref();
    resolve();
  });
}
