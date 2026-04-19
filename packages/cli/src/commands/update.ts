import { withGatewayIpc } from "../lib/with-gateway-ipc.ts";

export type UpdateArgs = { mode: "check" | "apply"; yes: boolean };

export function parseUpdateArgs(argv: string[]): UpdateArgs {
  let mode: UpdateArgs["mode"] = "apply";
  let yes = false;
  for (const arg of argv) {
    switch (arg) {
      case "--check":
        mode = "check";
        break;
      case "--yes":
      case "-y":
        yes = true;
        break;
      default:
        throw new Error(`unknown flag: ${arg}`);
    }
  }
  return { mode, yes };
}

export async function runUpdate(argv: string[]): Promise<void> {
  const args = parseUpdateArgs(argv);

  if (args.mode === "check") {
    const result = await withGatewayIpc((c) =>
      c.call<{
        currentVersion: string;
        latestVersion: string;
        updateAvailable: boolean;
        notes?: string;
      }>("updater.checkNow", {}),
    );
    console.log(`current: ${result.currentVersion}`);
    console.log(`latest:  ${result.latestVersion}`);
    if (result.notes) {
      console.log(`notes:   ${result.notes}`);
    }
    process.exitCode = result.updateAvailable ? 1 : 0;
    return;
  }

  if (!args.yes) {
    console.log("Check for updates?");
    const checkResult = await withGatewayIpc((c) =>
      c.call<{
        currentVersion: string;
        latestVersion: string;
        updateAvailable: boolean;
        notes?: string;
      }>("updater.checkNow", {}),
    );
    console.log(`current: ${checkResult.currentVersion}`);
    console.log(`latest:  ${checkResult.latestVersion}`);

    if (!checkResult.updateAvailable) {
      console.log("No update available.");
      return;
    }

    if (checkResult.notes) {
      console.log(`Release notes: ${checkResult.notes}`);
    }

    process.stdout.write("Apply update now? [y/N] ");
    const answer = await readLine();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("Aborted.");
      return;
    }
  }

  await withGatewayIpc((c) => c.call<unknown>("updater.applyUpdate", {}));
  console.log("Update applied. Gateway will restart.");
}

async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // If not a TTY, don't try to read
      resolve("");
      return;
    }
    const chunk = process.stdin.read() as Buffer | null;
    if (chunk !== null) {
      resolve(chunk.toString("utf8"));
    } else {
      process.stdin.once("data", (data) => {
        resolve(data.toString("utf8"));
      });
    }
  });
}
