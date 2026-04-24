import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Per-platform Nimbus paths. Pure node:* + process.env — no Bun-only APIs. */
export type NimbusPaths = {
  configDir: string;
  dataDir: string;
  logDir: string;
  socketPath: string;
  extensionsDir: string;
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
      const configDir = join(appData, "Nimbus");
      const dataDir = join(localAppData, "Nimbus", "data");
      return {
        configDir,
        dataDir,
        logDir: join(dataDir, "logs"),
        socketPath: String.raw`\\.\pipe\nimbus-gateway`,
        extensionsDir: join(localAppData, "Nimbus", "extensions"),
      };
    }
    case "darwin": {
      const root = join(homedir(), "Library", "Application Support", "Nimbus");
      const tmp = process.env["TMPDIR"] ?? tmpdir();
      return {
        configDir: root,
        dataDir: root,
        logDir: join(root, "logs"),
        socketPath: join(tmp, "nimbus-gateway.sock"),
        extensionsDir: join(root, "extensions"),
      };
    }
    default: {
      const home = homedir();
      const configRoot = envOrEmpty("XDG_CONFIG_HOME") || join(home, ".config");
      const dataRoot = envOrEmpty("XDG_DATA_HOME") || join(home, ".local", "share");
      const runtimeDir = envOrEmpty("XDG_RUNTIME_DIR") || tmpdir();
      const configDir = join(configRoot, "nimbus");
      const dataDir = join(dataRoot, "nimbus");
      return {
        configDir,
        dataDir,
        logDir: join(dataDir, "logs"),
        socketPath: join(runtimeDir, "nimbus-gateway.sock"),
        extensionsDir: join(dataDir, "extensions"),
      };
    }
  }
}
