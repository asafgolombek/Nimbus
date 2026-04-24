import { describe, expect, test, vi } from "vitest";
import { createSearchCommand } from "../../../src/commands/search.js";
import type { Logger } from "../../../src/logging.js";

const noLog: Logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

describe("createSearchCommand", () => {
  test("returns early when user cancels input box (undefined)", async () => {
    const client = { queryItems: vi.fn() };
    const window = {
      showInputBox: vi.fn().mockResolvedValue(undefined),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn(),
      openTextDocument: vi.fn(),
      showQuickPick: vi.fn(),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
    await cmd();
    expect(client.queryItems).not.toHaveBeenCalled();
  });

  test("returns early when input box returns empty string", async () => {
    const client = { queryItems: vi.fn() };
    const window = {
      showInputBox: vi.fn().mockResolvedValue("   "),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn(),
      openTextDocument: vi.fn(),
      showQuickPick: vi.fn(),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
    await cmd();
    expect(client.queryItems).not.toHaveBeenCalled();
  });

  test("skips input box when initial query string is provided", async () => {
    const client = { queryItems: vi.fn().mockResolvedValue({ items: [] }) };
    const window = {
      showInputBox: vi.fn(),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn(),
      openTextDocument: vi.fn(),
      showQuickPick: vi.fn(),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
    await cmd("pre-filled");
    expect(window.showInputBox).not.toHaveBeenCalled();
    expect(client.queryItems).toHaveBeenCalledWith({ query: "pre-filled", limit: 50 });
  });

  test("shows No results message when items array is empty", async () => {
    const client = { queryItems: vi.fn().mockResolvedValue({ items: [] }) };
    const window = {
      showInputBox: vi.fn().mockResolvedValue("nimbus"),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn(),
      openTextDocument: vi.fn(),
      showQuickPick: vi.fn(),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
    await cmd();
    expect(window.showInformationMessage).toHaveBeenCalledWith("No results", {});
    expect(sink.showQuickPick).not.toHaveBeenCalled();
  });

  test("returns early when user cancels quick pick", async () => {
    const item = { id: "1", name: "Doc", service: "github", itemType: "pr", url: "https://github.com/x" };
    const client = { queryItems: vi.fn().mockResolvedValue({ items: [item] }) };
    const window = {
      showInputBox: vi.fn().mockResolvedValue("doc"),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn(),
      openTextDocument: vi.fn(),
      showQuickPick: vi.fn().mockResolvedValue(undefined),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
    await cmd();
    expect(sink.openExternal).not.toHaveBeenCalled();
    expect(sink.openTextDocument).not.toHaveBeenCalled();
  });

  test("opens external URL when chosen item has url", async () => {
    const item = { id: "1", name: "Doc", service: "github", itemType: "pr", url: "https://github.com/x" };
    const client = { queryItems: vi.fn().mockResolvedValue({ items: [item] }) };
    const window = {
      showInputBox: vi.fn().mockResolvedValue("doc"),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn().mockResolvedValue(true),
      openTextDocument: vi.fn(),
      showQuickPick: vi.fn().mockResolvedValue({ itemId: "1", url: "https://github.com/x" }),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
    await cmd();
    expect(sink.openExternal).toHaveBeenCalledWith("https://github.com/x");
    expect(sink.openTextDocument).not.toHaveBeenCalled();
  });

  test("opens file document when chosen item has filePath", async () => {
    const item = { id: "2", name: "README", service: "filesystem", itemType: "file", filePath: "/home/user/README.md" };
    const client = { queryItems: vi.fn().mockResolvedValue({ items: [item] }) };
    const window = {
      showInputBox: vi.fn().mockResolvedValue("readme"),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn(),
      openTextDocument: vi.fn().mockResolvedValue(undefined),
      showQuickPick: vi.fn().mockResolvedValue({ itemId: "2", filePath: "/home/user/README.md" }),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
    await cmd();
    expect(sink.openTextDocument).toHaveBeenCalledWith("/home/user/README.md", { isFile: true });
    expect(sink.openExternal).not.toHaveBeenCalled();
  });

  test("opens nimbus-item: URI when no url or filePath", async () => {
    const item = { id: "abc", name: "Note", service: "notion", itemType: "page" };
    const client = { queryItems: vi.fn().mockResolvedValue({ items: [item] }) };
    const window = {
      showInputBox: vi.fn().mockResolvedValue("note"),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn(),
      openTextDocument: vi.fn().mockResolvedValue(undefined),
      showQuickPick: vi.fn().mockResolvedValue({ itemId: "abc" }),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
    await cmd();
    expect(sink.openTextDocument).toHaveBeenCalledWith("nimbus-item:abc", { isFile: false });
  });

  test("picks url from extra.url when top-level url is absent", async () => {
    const item = { id: "3", name: "PR", service: "gitlab", itemType: "pr", extra: { url: "https://gitlab.com/mr/1" } };
    const client = { queryItems: vi.fn().mockResolvedValue({ items: [item] }) };
    const window = {
      showInputBox: vi.fn().mockResolvedValue("pr"),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn().mockResolvedValue(true),
      openTextDocument: vi.fn(),
      showQuickPick: vi.fn().mockResolvedValue({ itemId: "3", url: "https://gitlab.com/mr/1" }),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
    await cmd();
    expect(sink.openExternal).toHaveBeenCalledWith("https://gitlab.com/mr/1");
  });

  test("renders Untitled label and empty service/itemType for items with missing fields", async () => {
    const item = {};
    const client = { queryItems: vi.fn().mockResolvedValue({ items: [item] }) };
    const window = {
      showInputBox: vi.fn().mockResolvedValue("test"),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    } as any;
    const sink = {
      openExternal: vi.fn(),
      openTextDocument: vi.fn().mockResolvedValue(undefined),
      showQuickPick: vi.fn().mockResolvedValue({ itemId: "" }),
    };
    const cmd = createSearchCommand({ client, window, sink, log: noLog });
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
