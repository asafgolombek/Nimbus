import type { Logger } from "../logging.js";
import type { WindowApi } from "../vscode-shim.js";

export interface RunWorkflowDeps {
  call(method: string, params?: unknown): Promise<unknown>;
  window: WindowApi;
  log: Logger;
  showQuickPick<T extends { label: string }>(items: T[]): Promise<T | undefined>;
  showProgressToast(message: string, onShowLogs: () => void): Promise<void>;
}

export function createRunWorkflowCommand(deps: RunWorkflowDeps): () => Promise<void> {
  return async () => {
    const list = (await deps.call("workflow.list")) as Array<{ name: string; description?: string }>;
    if (!Array.isArray(list) || list.length === 0) {
      await deps.window.showInformationMessage("No workflows defined", {});
      return;
    }
    const chosen = await deps.showQuickPick(
      list.map((w) => ({ label: w.name, description: w.description ?? "" })),
    );
    if (chosen === undefined) return;
    deps.log.info(`Running workflow: ${chosen.label}`);
    void deps.call("workflow.run", { name: chosen.label }).catch((e: unknown) => {
      deps.log.error(
        `workflow.run failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
    await deps.showProgressToast(`Running workflow ${chosen.label}…`, () => undefined);
  };
}
