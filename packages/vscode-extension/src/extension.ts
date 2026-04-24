import { spawn } from "node:child_process";
import * as net from "node:net";

import { discoverSocketPath, type HitlRequest, NimbusClient } from "@nimbus-dev/client";
import * as vscode from "vscode";

import { createChatController } from "./chat/chat-controller.js";
import type { ExtensionToWebview, WebviewToExtension } from "./chat/chat-protocol.js";
import { createSessionStore } from "./chat/session-store.js";
import { createAskAboutSelectionCommand, createAskCommand } from "./commands/ask.js";
import { createNewConversationCommand } from "./commands/new-conversation.js";
import { createRunWorkflowCommand } from "./commands/run-workflow.js";
import { createSearchCommand } from "./commands/search.js";
import { createStartGatewayCommand } from "./commands/start-gateway.js";
import { createAutoStarter } from "./connection/auto-start.js";
import { createConnectionManager, type NimbusClientLike } from "./connection/connection-manager.js";
import { createModalSurface } from "./hitl/hitl-modal.js";
import { createHitlRouter, type HitlDecision } from "./hitl/hitl-router.js";
import { createToastSurface } from "./hitl/hitl-toast.js";
import { createLogger } from "./logging.js";
import { formatItemMarkdown, parseItemUri, URI_SCHEME } from "./search/item-provider.js";
import { createSettings } from "./settings.js";
import { createStatusBarController } from "./status-bar/status-bar-item.js";
import type {
  OutputChannelHandle,
  StatusBarItemHandle,
  WindowApi,
  WorkspaceApi,
} from "./vscode-shim.js";

let disposables: vscode.Disposable[] = [];

function adaptOutputChannel(channel: vscode.OutputChannel): OutputChannelHandle {
  return {
    appendLine: (m) => channel.appendLine(m),
    show: (preserveFocus) => channel.show(preserveFocus ?? true),
    dispose: () => channel.dispose(),
  };
}

function adaptStatusBar(item: vscode.StatusBarItem): StatusBarItemHandle {
  return {
    get text() {
      return item.text;
    },
    set text(v: string) {
      item.text = v;
    },
    get tooltip() {
      return item.tooltip as string | undefined;
    },
    set tooltip(v: string | undefined) {
      item.tooltip = v;
    },
    get command() {
      return typeof item.command === "string" ? item.command : undefined;
    },
    set command(v: string | undefined) {
      item.command = v;
    },
    get backgroundColor() {
      const bg = item.backgroundColor;
      return bg === undefined ? undefined : { id: (bg as vscode.ThemeColor).id };
    },
    set backgroundColor(v: { id: string } | undefined) {
      item.backgroundColor = v === undefined ? undefined : new vscode.ThemeColor(v.id);
    },
    show: () => item.show(),
    hide: () => item.hide(),
    dispose: () => item.dispose(),
  };
}

function adaptWindow(): WindowApi {
  return {
    createOutputChannel: (name) => adaptOutputChannel(vscode.window.createOutputChannel(name)),
    createStatusBarItem: (alignment, priority) =>
      adaptStatusBar(
        vscode.window.createStatusBarItem(
          alignment === 1 ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
          priority,
        ),
      ),
    showInformationMessage: (msg, opts, ...items) =>
      Promise.resolve(vscode.window.showInformationMessage(msg, opts, ...items)),
    showErrorMessage: (msg, ...items) =>
      Promise.resolve(vscode.window.showErrorMessage(msg, ...items)),
    showInputBox: (opts) => Promise.resolve(vscode.window.showInputBox(opts)),
  };
}

function adaptWorkspace(): WorkspaceApi {
  return {
    getConfiguration: (section) => {
      const cfg = vscode.workspace.getConfiguration(section);
      return { get: <T>(key: string, dflt: T): T => cfg.get<T>(key, dflt) };
    },
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const window = adaptWindow();
  const workspace = adaptWorkspace();
  const settings = createSettings(workspace);
  const rawChannel = vscode.window.createOutputChannel("Nimbus");
  const channel = adaptOutputChannel(rawChannel);
  const logger = createLogger(channel, () => settings.logLevel());

  // ---------- Connection ----------
  const open = async (socketPath: string): Promise<NimbusClientLike> => {
    const c = await NimbusClient.open({ socketPath });
    return c as unknown as NimbusClientLike;
  };
  const discover = async (override?: string) => {
    const o = override !== undefined && override.length > 0 ? override : settings.socketPath();
    const r = await discoverSocketPath(o.length > 0 ? { override: o } : undefined);
    return r;
  };
  const connection = createConnectionManager({
    open,
    discoverSocket: discover,
    log: logger,
    socketPathOverride: settings.socketPath(),
  });

  // ---------- Status bar ----------
  const sbItem = window.createStatusBarItem(1, 100);
  const sbCtl = createStatusBarController(sbItem);
  let degraded = 0;
  let degradedNames: string[] = [];
  let pending = 0;
  const profile = "default";
  const updateStatusBar = (): void => {
    sbCtl.update({
      connection: connection.current(),
      profile,
      degradedConnectorCount: degraded,
      degradedConnectorNames: degradedNames,
      pendingHitlCount: pending,
      autoStartGateway: settings.autoStartGateway(),
    });
  };
  connection.onState(() => updateStatusBar());

  // ---------- Auto-starter ----------
  const autoStarter = createAutoStarter({
    spawn: (cmd, args) => spawn(cmd, args, { detached: true, stdio: "ignore" }),
    pingSocket: async (socketPath) =>
      new Promise<boolean>((resolve) => {
        const sock = net.createConnection({ path: socketPath });
        sock.once("connect", () => {
          sock.end();
          resolve(true);
        });
        sock.once("error", () => resolve(false));
      }),
    log: logger,
  });

  // ---------- Chat panel ----------
  let chatPanel: vscode.WebviewPanel | undefined;
  const sessionStore = createSessionStore({
    get: (k, d) => context.workspaceState.get(k, d),
    update: (k, v) => Promise.resolve(context.workspaceState.update(k, v)),
  });

  const buildPanelHtml = (panel: vscode.WebviewPanel): string => {
    const csp = `default-src 'none'; img-src ${panel.webview.cspSource} https: data:; script-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline';`;
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "webview.js"),
    );
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "webview.css"),
    );
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${styleUri}" />
<title>Nimbus</title>
</head>
<body>
<div id="transcript"></div>
<div id="input-area">
  <textarea id="input" placeholder="Ask Nimbus…"></textarea>
  <button id="submit">Send</button>
  <button id="stop">Stop</button>
</div>
<script src="${scriptUri}"></script>
</body>
</html>`;
  };

  const wireWebviewMessages = (panel: vscode.WebviewPanel): void => {
    panel.webview.onDidReceiveMessage(async (msg: WebviewToExtension) => {
      switch (msg.type) {
        case "ready":
        case "requestRehydrate":
          await controller.rehydrateIfNeeded(settings.transcriptHistoryLimit());
          return;
        case "submitAsk":
          await controller.start(msg.text);
          return;
        case "stopStream":
          await controller.stop();
          return;
        case "hitlResponse": {
          const cb = pendingInline.get(msg.requestId);
          if (cb !== undefined) {
            pendingInline.delete(msg.requestId);
            cb(msg.decision);
          }
          return;
        }
        case "openLogs":
          rawChannel.show(true);
          return;
        case "startGateway":
          await vscode.commands.executeCommand("nimbus.startGateway");
          return;
        case "openExternal":
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          return;
      }
    });
  };

  const ensurePanel = (): vscode.WebviewPanel => {
    if (chatPanel !== undefined) {
      chatPanel.reveal(vscode.ViewColumn.Beside, true);
      return chatPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      "nimbus.chat",
      "Nimbus",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        retainContextWhenHidden: true,
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      },
    );
    panel.webview.html = buildPanelHtml(panel);
    wireWebviewMessages(panel);
    panel.onDidDispose(() => {
      chatPanel = undefined;
    });
    chatPanel = panel;
    return panel;
  };

  const chatPanelAdapter = {
    reveal: () => {
      ensurePanel();
    },
    dispose: () => chatPanel?.dispose(),
    panel: () => chatPanel,
    onDispose: (h: () => void) => {
      if (chatPanel !== undefined) chatPanel.onDidDispose(h);
    },
    onMessage: (h: (msg: unknown) => void) => {
      if (chatPanel !== undefined) chatPanel.webview.onDidReceiveMessage(h);
    },
    postMessage: (m: unknown) => Promise.resolve(chatPanel?.webview.postMessage(m) ?? false),
    isVisible: () => chatPanel?.visible ?? false,
    isActive: () => chatPanel?.active ?? false,
  };

  // ---------- HITL ----------
  const activeStreams = new Set<string>();
  const pendingInline = new Map<string, (d: HitlDecision | undefined) => void>();

  const router = createHitlRouter({
    chatPanelVisibleAndFocused: () => chatPanelAdapter.isVisible() && chatPanelAdapter.isActive(),
    streamRegistered: (sid) => activeStreams.has(sid),
    showInline: (req) =>
      new Promise<HitlDecision | undefined>((resolve) => {
        pendingInline.set(req.requestId, resolve);
        chatPanelAdapter
          .postMessage({
            type: "hitlInline",
            requestId: req.requestId,
            prompt: req.prompt,
            details: req.details,
          } as ExtensionToWebview)
          .catch(() => undefined);
      }),
    showToast: createToastSurface(window),
    showModal: createModalSurface(window),
    sendResponse: async (requestId, decision) => {
      const c = connection.client() as unknown as {
        ipc?: { call(m: string, p: unknown): Promise<unknown> };
      };
      if (c?.ipc !== undefined) {
        await c.ipc.call("consent.respond", { requestId, decisions: [{ decision }] });
      }
    },
    onCountChange: (n) => {
      pending = n;
      updateStatusBar();
    },
    alwaysModal: () => settings.hitlAlwaysModal(),
  });

  // ---------- Chat controller ----------
  const controller = createChatController({
    client: {
      askStream: (input, opts) => {
        const c = connection.client();
        if (c === undefined) throw new Error("Not connected");
        return (c as unknown as NimbusClient).askStream(input, opts);
      },
      cancelStream: async (sid) => {
        const c = connection.client();
        if (c === undefined) return { ok: false };
        return await (c as unknown as NimbusClient).cancelStream(sid);
      },
      getSessionTranscript: async (params) => {
        const c = connection.client();
        if (c === undefined) throw new Error("Not connected");
        return await (c as unknown as NimbusClient).getSessionTranscript(params);
      },
    },
    panel: chatPanelAdapter as unknown as import("./chat/chat-panel.js").ChatPanel,
    sessionStore,
    registerStreamWithHitl: (sid) => activeStreams.add(sid),
    unregisterStreamWithHitl: (sid) => activeStreams.delete(sid),
    log: logger,
    agent: () => settings.askAgent(),
  });

  // Wire HITL subscription on connect
  connection.onState((s) => {
    if (s.kind === "connected") {
      const c = connection.client() as unknown as NimbusClient | undefined;
      c?.subscribeHitl((req: HitlRequest) => {
        void router.handle(req);
      });
    }
  });

  // ---------- nimbus-item: URI provider ----------
  const provider: vscode.TextDocumentContentProvider = {
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      const itemId = parseItemUri(uri.toString());
      if (itemId === undefined) return "";
      const c = connection.client() as unknown as NimbusClient | undefined;
      if (c === undefined) return "Gateway not connected.";
      const escaped = itemId.replaceAll("'", "''");
      const r = await c.querySql(`SELECT * FROM items WHERE id = '${escaped}' LIMIT 1`);
      if (r.rows.length === 0) return `Item not found: ${itemId}`;
      return formatItemMarkdown(r.rows[0] as Record<string, unknown>);
    },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(URI_SCHEME, provider),
  );

  // ---------- Commands ----------
  const reveal = (): void => {
    ensurePanel();
  };
  const setInputText = (text: string): void => {
    chatPanelAdapter
      .postMessage({ type: "userMessage", text } as ExtensionToWebview)
      .catch(() => undefined);
  };

  const askCmd = createAskCommand({ controller, reveal, setInputText });
  const askSelCmd = createAskAboutSelectionCommand({ controller, reveal, setInputText }, () => {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || editor.selection.isEmpty) return undefined;
    return {
      relativePath: vscode.workspace.asRelativePath(editor.document.uri),
      startLine: editor.selection.start.line,
      endLine: editor.selection.end.line,
      languageId: editor.document.languageId,
      selectionText: editor.document.getText(editor.selection),
    };
  });

  const searchCmd = createSearchCommand({
    client: {
      queryItems: async (params) => {
        const c = connection.client() as unknown as NimbusClient;
        if (params.query !== undefined && params.query.trim().length > 0) {
          const escaped = params.query.replaceAll("'", "''");
          const limit = params.limit ?? 50;
          const r = await c.querySql(
            `SELECT id, name, service, item_type AS "itemType", url, file_path AS "filePath" FROM items WHERE name LIKE '%${escaped}%' LIMIT ${limit}`,
          );
          return { items: r.rows };
        }
        const limitedParams: { limit?: number } = {};
        if (params.limit !== undefined) limitedParams.limit = params.limit;
        return await c.queryItems(limitedParams);
      },
    },
    window,
    sink: {
      openExternal: async (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
      openTextDocument: async (uriOrPath, opts) => {
        const uri =
          opts?.isFile === true ? vscode.Uri.file(uriOrPath) : vscode.Uri.parse(uriOrPath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
      },
      showQuickPick: async (items) => {
        const chosen = await vscode.window.showQuickPick(items, { matchOnDescription: true });
        return chosen as { itemId: string; url?: string; filePath?: string } | undefined;
      },
    },
    log: logger,
  });

  const runWfCmd = createRunWorkflowCommand({
    call: async (method, params) => {
      const c = connection.client() as unknown as {
        ipc?: { call(m: string, p?: unknown): Promise<unknown> };
      };
      if (c?.ipc === undefined) throw new Error("Not connected");
      return await c.ipc.call(method, params);
    },
    window,
    log: logger,
    showQuickPick: async (items) => {
      const chosen = await vscode.window.showQuickPick(items, { matchOnDescription: true });
      return chosen as (typeof items)[number] | undefined;
    },
    showProgressToast: async (message, onShowLogs) => {
      const action = await window.showInformationMessage(message, {}, "Show Progress");
      if (action === "Show Progress") onShowLogs();
    },
  });

  const newConvCmd = createNewConversationCommand(controller);
  const startGwCmd = createStartGatewayCommand({
    autoStarter,
    getSocketPath: async () => {
      const o = settings.socketPath();
      const r = await discoverSocketPath(o.length > 0 ? { override: o } : undefined);
      return r.socketPath;
    },
    window,
    log: logger,
    openLogs: () => rawChannel.show(true),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("nimbus.ask", askCmd),
    vscode.commands.registerCommand("nimbus.askAboutSelection", askSelCmd),
    vscode.commands.registerCommand("nimbus.search", () => searchCmd()),
    vscode.commands.registerCommand("nimbus.searchSelection", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined || editor.selection.isEmpty) return Promise.resolve();
      return searchCmd(editor.document.getText(editor.selection));
    }),
    vscode.commands.registerCommand("nimbus.runWorkflow", runWfCmd),
    vscode.commands.registerCommand("nimbus.newConversation", newConvCmd),
    vscode.commands.registerCommand("nimbus.startGateway", startGwCmd),
    vscode.commands.registerCommand("nimbus.reconnect", async () => {
      logger.info("Manual reconnect requested via nimbus.reconnect");
      await connection.reconnectNow();
    }),
    vscode.commands.registerCommand("nimbus.openLogs", () => rawChannel.show(true)),
    vscode.commands.registerCommand("nimbus.showPendingHitl", async () => {
      const snap = router.snapshot();
      if (snap.length === 0) {
        await window.showInformationMessage("No pending consent requests.", {});
        return;
      }
      const chosen = await vscode.window.showQuickPick(
        snap.map((r) => ({ label: r.prompt, requestId: r.requestId })),
      );
      if (chosen === undefined) return;
      const orig = snap.find((r) => r.requestId === (chosen as { requestId: string }).requestId);
      if (orig !== undefined) await router.handle(orig);
    }),
  );

  // ---------- Connector polling for status bar ----------
  const pollConnectors = async (): Promise<void> => {
    const c = connection.client() as unknown as
      | { ipc?: { call(m: string, p?: unknown): Promise<unknown> } }
      | undefined;
    if (c?.ipc === undefined) return;
    try {
      const list = (await c.ipc.call("connector.list")) as Array<{
        name?: string;
        health?: string;
      }>;
      const broken = Array.isArray(list)
        ? list.filter(
            (it) => typeof it.health === "string" && it.health !== "healthy" && it.health !== "ok",
          )
        : [];
      degraded = broken.length;
      degradedNames = broken
        .map((it) => (typeof it.name === "string" ? it.name : ""))
        .filter((n) => n.length > 0);
      updateStatusBar();
    } catch {
      // ignored
    }
  };
  const pollTimer = setInterval(() => {
    void pollConnectors();
  }, settings.statusBarPollMs());

  // ---------- Start ----------
  await connection.start();

  disposables.push(
    new vscode.Disposable(() => {
      clearInterval(pollTimer);
    }),
    new vscode.Disposable(() => {
      void connection.dispose();
    }),
    sbCtl,
    rawChannel,
  );
  context.subscriptions.push(...disposables);
}

export function deactivate(): void {
  for (const d of disposables) d.dispose();
  disposables = [];
}
