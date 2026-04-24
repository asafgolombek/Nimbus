import type { AutoStarter } from "../connection/auto-start.js";
import type { Logger } from "../logging.js";
import type { WindowApi } from "../vscode-shim.js";

export interface StartGatewayDeps {
  autoStarter: AutoStarter;
  getSocketPath: () => Promise<string>;
  window: WindowApi;
  log: Logger;
  openLogs: () => void;
}

export function createStartGatewayCommand(deps: StartGatewayDeps): () => Promise<void> {
  return async () => {
    const socketPath = await deps.getSocketPath();
    deps.log.info(`Starting Gateway via 'nimbus start' (target socket: ${socketPath})`);
    const r = await deps.autoStarter.spawn(socketPath);
    if (r.kind === "ok") {
      await deps.window.showInformationMessage("Nimbus Gateway is running.", {});
      return;
    }
    if (r.kind === "timeout") {
      const action = await deps.window.showErrorMessage(
        `Nimbus: Gateway didn't appear within timeout (${r.socketPath}).`,
        "Open Logs",
      );
      if (action === "Open Logs") deps.openLogs();
      return;
    }
    const action = await deps.window.showErrorMessage(
      `Nimbus: Failed to spawn 'nimbus start' — ${r.message}. Is the binary on PATH?`,
      "Open Logs",
    );
    if (action === "Open Logs") deps.openLogs();
  };
}
