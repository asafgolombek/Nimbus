import { homedir, tmpdir } from "node:os";
import { join as joinNative } from "node:path";
import { join as joinPosix } from "node:path/posix";

/** Per-platform Nimbus paths. Pure node:* + process.env — no Bun-only APIs. */
export type NimbusPaths = {
  readonly configDir: string;
  readonly dataDir: string;
  readonly logDir: string;
  readonly socketPath: string;
  readonly extensionsDir: string;
};

function envOrEmpty(key: string): string {
  const v = process.env[key];
  return typeof v === "string" ? v : "";
}

export function getNimbusPaths(): NimbusPaths {
  switch (process.platform) {
    case "win32": {
      const appData = envOrEmpty("APPDATA");
      const localAppData = envOrEmpty("LOCALAPPDATA");
      if (appData.length === 0) {
        throw new Error("APPDATA is not set. Nimbus requires a standard Windows user profile.");
      }
      if (localAppData.length === 0) {
        throw new Error(
          "LOCALAPPDATA is not set. Nimbus requires a standard Windows user profile.",
        );
      }
      const configDir = joinNative(appData, "Nimbus");
      const dataDir = joinNative(localAppData, "Nimbus", "data");
      return {
        configDir,
        dataDir,
        logDir: joinNative(dataDir, "logs"),
        socketPath: String.raw`\\.\pipe\nimbus-gateway`,
        extensionsDir: joinNative(localAppData, "Nimbus", "extensions"),
      };
    }
    case "darwin": {
      const root = joinPosix(homedir(), "Library", "Application Support", "Nimbus");
      const tmp = envOrEmpty("TMPDIR") || "/tmp";
      return {
        configDir: root,
        dataDir: root,
        logDir: joinPosix(root, "logs"),
        socketPath: joinPosix(tmp, "nimbus-gateway.sock"),
        extensionsDir: joinPosix(root, "extensions"),
      };
    }
    default: {
      const home = homedir();
      const configRoot = envOrEmpty("XDG_CONFIG_HOME") || joinPosix(home, ".config");
      const dataRoot = envOrEmpty("XDG_DATA_HOME") || joinPosix(home, ".local", "share");
      const runtimeDir = envOrEmpty("XDG_RUNTIME_DIR") || tmpdir();
      const configDir = joinPosix(configRoot, "nimbus");
      const dataDir = joinPosix(dataRoot, "nimbus");
      return {
        configDir,
        dataDir,
        logDir: joinPosix(dataDir, "logs"),
        socketPath: joinPosix(runtimeDir, "nimbus-gateway.sock"),
        extensionsDir: joinPosix(dataDir, "extensions"),
      };
    }
  }
}
