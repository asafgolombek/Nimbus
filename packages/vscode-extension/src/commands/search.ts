import type { Logger } from "../logging.js";
import type { WindowApi } from "../vscode-shim.js";

export type SearchClientLike = {
  queryItems(params: { query?: string; limit?: number }): Promise<{
    items: Array<Record<string, unknown>>;
  }>;
};

export type SearchSinkDeps = {
  openExternal(url: string): Promise<boolean>;
  openTextDocument(uriOrPath: string, opts?: { isFile: boolean }): Promise<void>;
  showQuickPick(
    items: Array<{ label: string; description: string; detail: string; itemId: string; url?: string; filePath?: string }>,
  ): Promise<{ itemId: string; url?: string; filePath?: string } | undefined>;
};

export interface SearchCommandDeps {
  client: SearchClientLike;
  window: WindowApi;
  sink: SearchSinkDeps;
  log: Logger;
}

function pickUrl(item: Record<string, unknown>): string | undefined {
  const url = (item as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) return url;
  const extra = (item as { extra?: { url?: unknown } }).extra;
  if (extra !== undefined && typeof extra.url === "string") return extra.url;
  return undefined;
}

function pickFilePath(item: Record<string, unknown>): string | undefined {
  const fp = (item as { filePath?: unknown }).filePath;
  if (typeof fp === "string" && fp.length > 0) return fp;
  return undefined;
}

export function createSearchCommand(deps: SearchCommandDeps): (initial?: string) => Promise<void> {
  return async (initial) => {
    let query = initial;
    if (query === undefined) {
      query = await deps.window.showInputBox({ prompt: "Search Nimbus index" });
    }
    if (query === undefined || query.trim().length === 0) return;
    const result = await deps.client.queryItems({ query, limit: 50 });
    if (result.items.length === 0) {
      await deps.window.showInformationMessage("No results", {});
      return;
    }
    const picks = result.items.map((it) => {
      const id = typeof it.id === "string" ? it.id : "";
      const url = pickUrl(it);
      const filePath = pickFilePath(it);
      return {
        label: typeof it.name === "string" ? it.name : "Untitled",
        description: typeof it.service === "string" ? it.service : "",
        detail: typeof it.itemType === "string" ? it.itemType : "",
        itemId: id,
        ...(url !== undefined ? { url } : {}),
        ...(filePath !== undefined ? { filePath } : {}),
      };
    });
    const chosen = await deps.sink.showQuickPick(picks);
    if (chosen === undefined) return;
    if (chosen.url !== undefined) {
      await deps.sink.openExternal(chosen.url);
      return;
    }
    if (chosen.filePath !== undefined) {
      await deps.sink.openTextDocument(chosen.filePath, { isFile: true });
      return;
    }
    await deps.sink.openTextDocument(`nimbus-item:${chosen.itemId}`, { isFile: false });
  };
}
