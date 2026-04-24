import { describe, expect, test, vi } from "vitest";
import { createSearchCommand } from "../../../src/commands/search.js";
import type { Logger } from "../../../src/logging.js";

const noLog: Logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

const PR_ITEM = { id: "1", name: "Doc", service: "github", itemType: "pr", url: "https://github.com/x" };
const FILE_ITEM = { id: "2", name: "README", service: "filesystem", itemType: "file", filePath: "/home/user/README.md" };
const PAGE_ITEM = { id: "abc", name: "Note", service: "notion", itemType: "page" };

function makeClient(items: Record<string, unknown>[] = []) {
  return { queryItems: vi.fn().mockResolvedValue({ items }) };
}

function makeWindow(inputResult?: string) {
  return {
    showInputBox: vi.fn().mockResolvedValue(inputResult),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn(),
  } as any;
}

function makeSink(quickPickResult?: { itemId: string; url?: string; filePath?: string }) {
  return {
    openExternal: vi.fn().mockResolvedValue(true),
    openTextDocument: vi.fn().mockResolvedValue(undefined),
    showQuickPick: vi.fn().mockResolvedValue(quickPickResult),
  };
}

describe("createSearchCommand", () => {
  test("returns early when user cancels input box (undefined)", async () => {
    const client = makeClient();
    const cmd = createSearchCommand({ client, window: makeWindow(), sink: makeSink(), log: noLog });
    await cmd();
    expect(client.queryItems).not.toHaveBeenCalled();
  });

  test("returns early when input box returns empty string", async () => {
    const client = makeClient();
    const cmd = createSearchCommand({ client, window: makeWindow("   "), sink: makeSink(), log: noLog });
    await cmd();
    expect(client.queryItems).not.toHaveBeenCalled();
  });

  test("skips input box when initial query string is provided", async () => {
    const client = makeClient();
    const window = makeWindow();
    const cmd = createSearchCommand({ client, window, sink: makeSink(), log: noLog });
    await cmd("pre-filled");
    expect(window.showInputBox).not.toHaveBeenCalled();
    expect(client.queryItems).toHaveBeenCalledWith({ query: "pre-filled", limit: 50 });
  });

  test("shows No results message when items array is empty", async () => {
    const window = makeWindow("nimbus");
    const sink = makeSink();
    const cmd = createSearchCommand({ client: makeClient(), window, sink, log: noLog });
    await cmd();
    expect(window.showInformationMessage).toHaveBeenCalledWith("No results", {});
    expect(sink.showQuickPick).not.toHaveBeenCalled();
  });

  test("returns early when user cancels quick pick", async () => {
    const sink = makeSink();
    const cmd = createSearchCommand({ client: makeClient([PR_ITEM]), window: makeWindow("doc"), sink, log: noLog });
    await cmd();
    expect(sink.openExternal).not.toHaveBeenCalled();
    expect(sink.openTextDocument).not.toHaveBeenCalled();
  });

  test("opens external URL when chosen item has url", async () => {
    const sink = makeSink({ itemId: "1", url: "https://github.com/x" });
    const cmd = createSearchCommand({ client: makeClient([PR_ITEM]), window: makeWindow("doc"), sink, log: noLog });
    await cmd();
    expect(sink.openExternal).toHaveBeenCalledWith("https://github.com/x");
    expect(sink.openTextDocument).not.toHaveBeenCalled();
  });

  test("opens file document when chosen item has filePath", async () => {
    const sink = makeSink({ itemId: "2", filePath: "/home/user/README.md" });
    const cmd = createSearchCommand({ client: makeClient([FILE_ITEM]), window: makeWindow("readme"), sink, log: noLog });
    await cmd();
    expect(sink.openTextDocument).toHaveBeenCalledWith("/home/user/README.md", { isFile: true });
    expect(sink.openExternal).not.toHaveBeenCalled();
  });

  test("opens nimbus-item: URI when no url or filePath", async () => {
    const sink = makeSink({ itemId: "abc" });
    const cmd = createSearchCommand({ client: makeClient([PAGE_ITEM]), window: makeWindow("note"), sink, log: noLog });
    await cmd();
    expect(sink.openTextDocument).toHaveBeenCalledWith("nimbus-item:abc", { isFile: false });
  });

  test("picks url from extra.url when top-level url is absent", async () => {
    const item = { id: "3", name: "PR", service: "gitlab", itemType: "pr", extra: { url: "https://gitlab.com/mr/1" } };
    const sink = makeSink({ itemId: "3", url: "https://gitlab.com/mr/1" });
    const cmd = createSearchCommand({ client: makeClient([item]), window: makeWindow("pr"), sink, log: noLog });
    await cmd();
    expect(sink.openExternal).toHaveBeenCalledWith("https://gitlab.com/mr/1");
  });

  test("renders Untitled label and empty service/itemType for items with missing fields", async () => {
    const sink = makeSink({ itemId: "" });
    const cmd = createSearchCommand({ client: makeClient([{}]), window: makeWindow("test"), sink, log: noLog });
    await cmd();
    const picksArg = (sink.showQuickPick as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      label: string;
      description: string;
      detail: string;
    }>;
    expect(picksArg[0].label).toBe("Untitled");
    expect(picksArg[0].description).toBe("");
    expect(picksArg[0].detail).toBe("");
  });
});
