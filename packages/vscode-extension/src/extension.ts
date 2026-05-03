/**
 * Nimbus VS Code extension entry point.
 *
 * This is the only file in the package that imports the real `vscode` module.
 * Everything else in `src/` consumes vscode through the narrow `vscode-shim`
 * interfaces so it stays unit-testable with `test/unit/vscode-stub.ts`.
 *
 * `activateWithDeps()` composes the surfaces shipped in PR3 — settings,
 * logging, SessionStore, ConnectionManager, AutoStarter, HitlRouter,
 * StatusBarController and ChatController — and registers the eight
 * contributed commands plus two internal ones referenced by the status bar
 * (`nimbus.openLogs`, `nimbus.showPendingHitl`). All disposables are pushed
 * to `ctx.subscriptions` so deactivation is automatic.
 *
 * Webview rendering is intentionally minimal here. The full markdown +
 * inline-HITL chat UI lands in a follow-up PR (Task 23).
 */

import { spawn as nodeSpawn } from "node:child_process";
import { connect as netConnect } from "node:net";

import { discoverSocketPath, type HitlRequest, NimbusClient } from "@nimbus-dev/client";
import * as vscode from "vscode";
import { type ChatController, createChatController } from "./chat/chat-controller.js";
import type { ChatPanel, ChatPanelFactory, WebviewPanelLike } from "./chat/chat-panel.js";
import { createSessionStore } from "./chat/session-store.js";
import { createAutoStarter } from "./connection/auto-start.js";
import { type ConnectionState, createConnectionManager } from "./connection/connection-manager.js";
import { renderDetailsHtml } from "./hitl/hitl-details-webview.js";
import { createModalSurface } from "./hitl/hitl-modal.js";
import { createHitlRouter, type HitlDecision } from "./hitl/hitl-router.js";
import { createToastSurface } from "./hitl/hitl-toast.js";
import { createLogger, type Logger } from "./logging.js";
import { createSettings } from "./settings.js";
import { createStatusBarController } from "./status-bar/status-bar-item.js";
import type {
  CommandsApi,
  DisposableLike,
  ExtensionContextLike,
  WindowApi,
  WorkspaceApi,
} from "./vscode-shim.js";

// ---------------------------------------------------------------------------
// activate / deactivate

export interface ActivateDeps {
  window: WindowApi;
  workspace: WorkspaceApi;
  commands: CommandsApi;
  /** Build a NimbusClient — overridable so tests can avoid opening sockets. */
  openClient?: (socketPath: string) => Promise<NimbusClient>;
  /** Resolve the gateway socket path. Default uses @nimbus-dev/client. */
  discoverSocket?: typeof discoverSocketPath;
  /** Factory for the chat WebviewPanel. Default uses real vscode.window. */
  chatPanelFactory?: (deps: { log: Logger }) => ChatPanelFactory;
}

/**
 * Wire up the extension. Pure-DI entry point — `activateWithDeps` accepts the
 * narrow shim interfaces so unit tests can drive the same wiring without
 * touching real vscode globals. The exported `activate()` below is the
 * shim-to-real adapter VS Code calls.
 */
export function activateWithDeps(
  ctx: ExtensionContextLike,
  deps: ActivateDeps,
): {
  /** Test-only — re-renders the status bar with a synthetic state. */
  fireConnectionState: (s: ConnectionState) => void;
  /** Test-only — pushes a synthetic HITL request through the router. */
  fireHitl: (req: HitlRequest) => void;
} {
  const out = deps.window.createOutputChannel("Nimbus");
  ctx.subscriptions.push(out);

  const settings = createSettings(deps.workspace);
  const log = createLogger(out, () => settings.logLevel());
  log.info("Nimbus VS Code extension activating");

  const sessionStore = createSessionStore(ctx.workspaceState);

  // -----------------------------------------------------------------------
  // ConnectionManager — opens NimbusClient, retries on failure with backoff
  const openClient =
    deps.openClient ?? (async (socketPath: string) => await NimbusClient.open({ socketPath }));
  const discoverSocket = deps.discoverSocket ?? discoverSocketPath;

  const connection = createConnectionManager({
    open: openClient,
    discoverSocket: async () => {
      const override = settings.socketPath();
      if (override.length > 0) return { socketPath: override, source: "settings" };
      return await discoverSocket();
    },
    log,
  });
  ctx.subscriptions.push({ dispose: () => void connection.dispose() });

  // -----------------------------------------------------------------------
  // Auto-start: when settings.autoStartGateway() and we go disconnected, run
  // `nimbus start` and ping the socket until it appears.
  const autoStart = createAutoStarter({
    spawn: (cmd, args) => nodeSpawn(cmd, args, { detached: true, stdio: "ignore" }),
    pingSocket,
    log,
  });
  let autoStartInFlight = false;

  // -----------------------------------------------------------------------
  // Status bar — alignment Right (2), priority 100
  const statusItem = deps.window.createStatusBarItem(2, 100);
  ctx.subscriptions.push(statusItem);
  const statusBar = createStatusBarController(statusItem);
  ctx.subscriptions.push(statusBar);

  let pendingHitlCount = 0;
  const renderStatusBar = (s: ConnectionState): void => {
    statusBar.update({
      connection: s,
      profile: "",
      degradedConnectorCount: 0,
      degradedConnectorNames: [],
      pendingHitlCount,
      autoStartGateway: settings.autoStartGateway(),
    });
  };

  // -----------------------------------------------------------------------
  // Chat panel factory — defaults to real vscode.window.createWebviewPanel
  const chatPanelFactory = deps.chatPanelFactory?.({ log }) ?? createRealChatPanelFactory(log);

  // -----------------------------------------------------------------------
  // ChatController — instantiated lazily when an ask command first fires
  let chatController: ChatController | undefined;
  const registeredHitlStreams = new Set<string>();

  const ensureChatController = (): ChatController | undefined => {
    if (chatController !== undefined) return chatController;
    const c = connection.client();
    if (c === undefined) {
      void deps.window.showErrorMessage(
        'Nimbus is not connected to the Gateway yet. Try again in a moment, or run "Nimbus: Reconnect to Gateway".',
      );
      return undefined;
    }
    const panel = chatPanelFactory.createOrReveal();
    chatController = createChatController({
      client: c as unknown as Parameters<typeof createChatController>[0]["client"],
      panel,
      sessionStore,
      registerStreamWithHitl: (id) => registeredHitlStreams.add(id),
      unregisterStreamWithHitl: (id) => {
        registeredHitlStreams.delete(id);
      },
      log,
      agent: () => settings.askAgent(),
    });
    panel.onDispose(() => {
      chatController = undefined;
    });
    return chatController;
  };

  // -----------------------------------------------------------------------
  // HITL router. The inline rich surface depends on the chat webview UI
  // landing in a follow-up; until then inline degrades to the toast surface.
  const hitlRouter = createHitlRouter({
    chatPanelVisibleAndFocused: () => {
      const p = chatPanelFactory.current();
      return p?.isVisible() === true && p.isActive();
    },
    streamRegistered: (streamId) => registeredHitlStreams.has(streamId),
    showInline: createToastSurface(deps.window),
    showToast: createToastSurface(deps.window),
    showModal: createModalSurface(deps.window),
    sendResponse: async (requestId, decision) => {
      const c = connection.client() as NimbusClient | undefined;
      if (c === undefined) {
        log.warn("HITL response dropped: no Gateway connection");
        return;
      }
      try {
        await sendConsentResponse(c, requestId, decision);
      } catch (e) {
        log.error(`HITL sendResponse failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    onCountChange: (count) => {
      pendingHitlCount = count;
      renderStatusBar(connection.current());
    },
    alwaysModal: () => settings.hitlAlwaysModal(),
  });

  // -----------------------------------------------------------------------
  // Connection state listener: status repaint + autostart + hitl wireup
  let hitlSubscription: DisposableLike | undefined;
  const stateSub = connection.onState((s) => {
    renderStatusBar(s);
    if (s.kind === "connected") {
      const c = connection.client() as NimbusClient | undefined;
      if (c !== undefined) {
        if (hitlSubscription !== undefined) {
          try {
            hitlSubscription.dispose();
          } catch {
            /* ignore */
          }
        }
        hitlSubscription = c.subscribeHitl((req) => {
          void hitlRouter.handle(req);
        });
      }
      log.info(`Nimbus connected to Gateway at ${s.socketPath}`);
      return;
    }
    if (s.kind === "disconnected" && settings.autoStartGateway() && !autoStartInFlight) {
      autoStartInFlight = true;
      void (async (): Promise<void> => {
        try {
          const r = await autoStart.spawn(s.socketPath);
          if (r.kind === "ok") {
            await connection.reconnectNow();
          } else if (r.kind === "spawn-error") {
            log.error(`Auto-start failed: ${r.message}`);
          } else {
            log.warn(`Auto-start timeout waiting for ${r.socketPath}`);
          }
        } finally {
          autoStartInFlight = false;
        }
      })();
    }
  });
  ctx.subscriptions.push({ dispose: () => stateSub.dispose() });
  ctx.subscriptions.push({
    dispose: () => {
      if (hitlSubscription !== undefined) hitlSubscription.dispose();
    },
  });

  // -----------------------------------------------------------------------
  // Settings observer — repaint status bar on any nimbus.* config change
  const cfgSub = deps.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("nimbus")) renderStatusBar(connection.current());
  });
  ctx.subscriptions.push(cfgSub);

  // -----------------------------------------------------------------------
  // Command registration
  const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
    ctx.subscriptions.push(deps.commands.registerCommand(id, handler));
  };

  register("nimbus.ask", async () => {
    const input = await deps.window.showInputBox({ prompt: "Ask Nimbus" });
    if (input === undefined || input.trim().length === 0) return;
    const ctl = ensureChatController();
    if (ctl === undefined) return;
    await ctl.start(input.trim());
  });

  register("nimbus.askAboutSelection", async () => {
    const editor = deps.window.activeTextEditor;
    if (editor === undefined || editor.selection.isEmpty) {
      void deps.window.showErrorMessage("Nimbus: select text first.");
      return;
    }
    const selection = editor.document.getText(editor.selection);
    const trimmed = typeof selection === "string" ? selection.trim() : "";
    if (trimmed.length === 0) return;
    const prefix = await deps.window.showInputBox({
      prompt: "Ask about the selected code",
      value: "Explain this:",
    });
    if (prefix === undefined) return;
    const ctl = ensureChatController();
    if (ctl === undefined) return;
    await ctl.start(`${prefix.trim()}\n\n${trimmed}`);
  });

  register("nimbus.search", async () => {
    const c = connection.client() as NimbusClient | undefined;
    if (c === undefined) {
      void deps.window.showErrorMessage("Nimbus: not connected to Gateway.");
      return;
    }
    const q = await deps.window.showInputBox({ prompt: "Search local index" });
    if (q === undefined || q.trim().length === 0) return;
    try {
      const r = await c.queryItems({ limit: 50 });
      const items = r.items.map((it) => ({
        label: String(it["title"] ?? it["id"] ?? "(untitled)"),
        description: String(it["service"] ?? ""),
        detail: String(it["url"] ?? it["path"] ?? ""),
      }));
      await deps.window.showQuickPick(items, {
        placeHolder: `${items.length} results for "${q.trim()}"`,
        matchOnDescription: true,
        matchOnDetail: true,
      });
    } catch (e) {
      log.error(`nimbus.search failed: ${e instanceof Error ? e.message : String(e)}`);
      void deps.window.showErrorMessage(
        `Nimbus search failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  register("nimbus.searchSelection", async () => {
    const editor = deps.window.activeTextEditor;
    if (editor === undefined || editor.selection.isEmpty) {
      void deps.window.showErrorMessage("Nimbus: select text first.");
      return;
    }
    await deps.commands.executeCommand("nimbus.search");
  });

  register("nimbus.runWorkflow", async () => {
    void deps.window.showInformationMessage(
      "Run Workflow lands in a follow-up release. For now use `nimbus workflow run` from the terminal.",
      {},
    );
  });

  register("nimbus.newConversation", async () => {
    const ctl = ensureChatController();
    if (ctl === undefined) return;
    await ctl.newConversation();
  });

  register("nimbus.startGateway", async () => {
    const cur = connection.current();
    const target = cur.kind === "idle" ? "" : ((cur as { socketPath?: string }).socketPath ?? "");
    const r = await autoStart.spawn(target);
    if (r.kind === "ok") {
      await connection.reconnectNow();
    } else if (r.kind === "spawn-error") {
      void deps.window.showErrorMessage(`Could not start Nimbus Gateway: ${r.message}`);
    } else {
      void deps.window.showErrorMessage(
        `Timed out waiting for Nimbus Gateway socket at ${r.socketPath}.`,
      );
    }
  });

  register("nimbus.reconnect", async () => {
    await connection.reconnectNow();
  });

  // Internal — invoked by the status bar tooltip in permission-denied state
  register("nimbus.openLogs", () => {
    out.show(true);
  });

  // Internal — invoked by the status bar when there's a pending HITL request
  register("nimbus.showPendingHitl", () => {
    if (hitlRouter.snapshot().length === 0) return;
    chatPanelFactory.current()?.reveal();
  });

  // -----------------------------------------------------------------------
  // Kick off the connection. Run async — VS Code activate() should not block.
  void connection.start();

  log.info(`Nimbus extension activated; ${ctx.subscriptions.length} disposable(s) registered`);

  return {
    fireConnectionState: (s) => renderStatusBar(s),
    fireHitl: (req) => void hitlRouter.handle(req),
  };
}

export function activate(ctx: vscode.ExtensionContext): void {
  activateWithDeps(ctx as unknown as ExtensionContextLike, {
    window: vscode.window as unknown as WindowApi,
    workspace: vscode.workspace as unknown as WorkspaceApi,
    commands: vscode.commands as unknown as CommandsApi,
  });
}

export function deactivate(): void {
  // VS Code disposes ctx.subscriptions automatically; nothing extra to do.
}

// Exposed for the follow-up PR that wires the rich HITL Webview surface.
export { renderDetailsHtml };

// ---------------------------------------------------------------------------
// Helpers (private to this module)

/**
 * `consent.respond` is the gateway IPC method that records a HITL decision.
 * NimbusClient does not currently expose a typed helper for it; the
 * structural cast below keeps the call to a single, well-named site so a
 * future typed wrapper on NimbusClient is a one-line follow-up.
 */
async function sendConsentResponse(
  client: NimbusClient,
  requestId: string,
  decision: HitlDecision,
): Promise<void> {
  const ipc = (
    client as unknown as {
      ipc: { call: (m: string, p: unknown) => Promise<unknown> };
    }
  ).ipc;
  await ipc.call("consent.respond", { requestId, decision });
}

/** Best-effort socket reachability probe used by the auto-starter. */
async function pingSocket(socketPath: string): Promise<boolean> {
  if (socketPath.length === 0) return false;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const sock = netConnect(socketPath);
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    sock.once("connect", () => settle(true));
    sock.once("error", () => settle(false));
    setTimeout(() => settle(false), 500);
  });
}

/**
 * Real ChatPanelFactory backed by `vscode.window.createWebviewPanel`. The
 * webview HTML is intentionally minimal in this PR; the rich markdown
 * renderer lands in a follow-up. The contract surface (`postMessage`,
 * `onMessage`, `reveal`, `dispose`) is what `ChatController` actually uses.
 */
function createRealChatPanelFactory(log: Logger): ChatPanelFactory {
  let current: ChatPanel | undefined;

  return {
    createOrReveal(): ChatPanel {
      if (current !== undefined) {
        current.reveal();
        return current;
      }
      const panel = vscode.window.createWebviewPanel(
        "nimbus.chat",
        "Nimbus",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      panel.webview.html = renderPlaceholderHtml(panel.webview.cspSource);
      const wrapper = wrapWebviewPanel(panel, log, () => {
        current = undefined;
      });
      current = wrapper;
      return wrapper;
    },
    current(): ChatPanel | undefined {
      return current;
    },
  };
}

function wrapWebviewPanel(
  panel: vscode.WebviewPanel,
  log: Logger,
  onDisposed: () => void,
): ChatPanel {
  const disposeListeners: Array<() => void> = [];
  panel.onDidDispose(() => {
    onDisposed();
    for (const l of disposeListeners) {
      try {
        l();
      } catch (e) {
        log.warn(
          `chatPanel onDispose handler threw: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  });
  const webviewLike = {
    cspSource: panel.webview.cspSource,
    asWebviewUri: (p: string) => panel.webview.asWebviewUri(vscode.Uri.parse(p)).toString(),
    get html(): string {
      return panel.webview.html;
    },
    set html(v: string) {
      panel.webview.html = v;
    },
    postMessage: (m: unknown) => panel.webview.postMessage(m),
    onDidReceiveMessage: (h: (msg: unknown) => void) => panel.webview.onDidReceiveMessage(h),
  };
  const panelLike: WebviewPanelLike = {
    get visible(): boolean {
      return panel.visible;
    },
    get active(): boolean {
      return panel.active;
    },
    webview: webviewLike,
    reveal: () => panel.reveal(),
    dispose: () => panel.dispose(),
    onDidDispose: (h) => panel.onDidDispose(h),
    onDidChangeViewState: (h) => panel.onDidChangeViewState(h),
  };
  return {
    reveal: () => panel.reveal(),
    dispose: () => panel.dispose(),
    panel: () => panelLike,
    onDispose: (h) => disposeListeners.push(h),
    onMessage: (h) => panel.webview.onDidReceiveMessage(h),
    postMessage: (m) => panel.webview.postMessage(m),
    isVisible: () => panel.visible,
    isActive: () => panel.active,
  };
}

function renderPlaceholderHtml(cspSource: string): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline' ${cspSource}; script-src ${cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<title>Nimbus</title>
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:1em}</style>
</head><body><h2>Nimbus</h2><p>Streaming chat UI lands in a follow-up release. Output is currently posted to the "Nimbus" output channel.</p></body></html>`;
}
