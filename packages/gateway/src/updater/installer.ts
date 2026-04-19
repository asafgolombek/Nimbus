import { extname } from "node:path";

export type Platform = "darwin" | "linux" | "win32";

export interface InstallerCommandSubprocess {
  kind: "subprocess";
  argv: string[];
}

export interface InstallerCommandReplaceInPlace {
  kind: "replace-in-place";
  targetBinary: string;
  sourceArchive: string;
}

export type InstallerCommand = InstallerCommandSubprocess | InstallerCommandReplaceInPlace;

export interface BuildCommandOptions {
  targetBinary?: string;
}

export async function executeReplaceInPlace(cmd: InstallerCommandReplaceInPlace): Promise<void> {
  const { copyFileSync, chmodSync } = await import("node:fs");
  copyFileSync(cmd.sourceArchive, cmd.targetBinary);
  try {
    chmodSync(cmd.targetBinary, 0o755);
  } catch {
    // Non-POSIX filesystem
  }
}

export function buildInstallerCommand(
  platform: Platform,
  installerPath: string,
  opts: BuildCommandOptions = {},
): InstallerCommand {
  const ext = extname(installerPath).toLowerCase();
  if (platform === "darwin") {
    if (ext === ".pkg") {
      return { kind: "subprocess", argv: ["open", "-W", installerPath] };
    }
    throw new Error(`unsupported macOS installer extension: ${ext}`);
  }
  if (platform === "linux") {
    if (ext === ".deb") {
      return { kind: "subprocess", argv: ["sudo", "dpkg", "-i", installerPath] };
    }
    if (installerPath.endsWith(".tar.gz")) {
      return {
        kind: "replace-in-place",
        targetBinary: opts.targetBinary ?? process.execPath,
        sourceArchive: installerPath,
      };
    }
    throw new Error(`unsupported Linux installer extension: ${ext}`);
  }
  if (platform === "win32") {
    if (ext === ".exe") {
      return { kind: "subprocess", argv: [installerPath, "/S"] };
    }
    throw new Error(`unsupported Windows installer extension: ${ext}`);
  }
  throw new Error(`unsupported platform: ${platform}`);
}
