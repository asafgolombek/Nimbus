/**
 * Webview entry — bundled by esbuild to `media/webview.js` (browser IIFE,
 * `globalName: "NimbusWebview"`). Loaded by the chat WebviewPanel constructed
 * in `extension.ts`.
 *
 * Responsibilities:
 *   1. Listen for ExtensionToWebview messages (chat-protocol.ts) and apply
 *      them to the DOM (transcript, sub-task strip, HITL card, empty state).
 *   2. Bind DOM events on the input form + HITL buttons + empty-state action
 *      buttons and post WebviewToExtension messages back through
 *      `acquireVsCodeApi().postMessage(...)`.
 *
 * All HTML the webview generates flows through the helpers in `render.ts`,
 * which escape user-controlled content. The webview's CSP (set in
 * extension.ts) blocks inline script and restricts script-src to a per-load
 * nonce so any markdown injection cannot execute code.
 */

import type { ExtensionToWebview, WebviewToExtension } from "../chat-protocol.js";
import {
  type EmptyStateInput,
  renderEmptyState,
  renderHitlCard,
  renderSubTaskRow,
  renderTurn,
} from "./render.js";

interface VsCodeApi {
  postMessage(msg: WebviewToExtension): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// DOM cache. Wired up once on DOMContentLoaded.

interface Refs {
  transcript: HTMLElement;
  subTaskList: HTMLElement;
  emptyMount: HTMLElement;
  hitlMount: HTMLElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  stop: HTMLButtonElement;
  status: HTMLElement;
}

function refs(): Refs {
  // The webview shell is a fixed scaffold the extension HTML defines; these
  // selectors are stable across renders.
  return {
    transcript: must("#transcript"),
    subTaskList: must("#subtask-list"),
    emptyMount: must("#empty-mount"),
    hitlMount: must("#hitl-mount"),
    form: must<HTMLFormElement>("#input-form"),
    input: must<HTMLTextAreaElement>("#input-text"),
    send: must<HTMLButtonElement>("#input-send"),
    stop: must<HTMLButtonElement>("#input-stop"),
    status: must("#status"),
  };
}

function must<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (el === null) throw new Error(`webview shell missing required selector: ${sel}`);
  return el;
}

// ---------------------------------------------------------------------------
// Streaming state. The current assistant turn is held in `streamingText` and
// re-rendered on every token so markdown blocks display correctly mid-stream.

interface State {
  streamingText: string;
  /** True between userMessage and done/error/reset. Drives Send/Stop UI. */
  streaming: boolean;
}

const state: State = {
  streamingText: "",
  streaming: false,
};

// ---------------------------------------------------------------------------
// Message handlers — one per discriminated `type` in ExtensionToWebview.

function applyMessage(r: Refs, msg: ExtensionToWebview): void {
  switch (msg.type) {
    case "reset":
      r.transcript.replaceChildren();
      r.subTaskList.replaceChildren();
      r.hitlMount.replaceChildren();
      r.emptyMount.replaceChildren();
      r.emptyMount.insertAdjacentHTML("beforeend", renderEmptyState({ sub: "no-transcript" }));
      state.streamingText = "";
      setStreaming(r, false);
      return;
    case "hydrate":
      r.transcript.replaceChildren();
      r.emptyMount.replaceChildren();
      for (const t of msg.turns) {
        r.transcript.insertAdjacentHTML("beforeend", renderTurn(t));
      }
      scrollToBottom(r);
      return;
    case "userMessage":
      r.emptyMount.replaceChildren();
      r.transcript.insertAdjacentHTML(
        "beforeend",
        renderTurn({ role: "user", text: msg.text, timestamp: Date.now() }),
      );
      // Open a fresh streaming turn placeholder.
      state.streamingText = "";
      r.transcript.insertAdjacentHTML(
        "beforeend",
        '<article class="turn turn-assistant turn-streaming"><header class="turn-header">Nimbus</header><div class="markdown" data-streaming="1"></div></article>',
      );
      setStreaming(r, true);
      scrollToBottom(r);
      return;
    case "token":
      state.streamingText += msg.text;
      // Re-render the in-flight turn body. We render whole-text every time —
      // markdown is not stable mid-token (open code fences, etc.) and the
      // re-render cost on the small payloads we deal with is negligible.
      {
        const target = r.transcript.querySelector('div.markdown[data-streaming="1"]');
        if (target !== null) {
          // Use the same renderer the final turn uses so markdown is consistent.
          target.innerHTML = renderTurnBodyHtml(state.streamingText);
        }
      }
      scrollToBottom(r);
      return;
    case "subTask": {
      const row = renderSubTaskRow(msg);
      const existing = r.subTaskList.querySelector(
        `li.subtask-row[data-subtask-id="${cssEscape(msg.subTaskId)}"]`,
      );
      if (existing === null) {
        r.subTaskList.insertAdjacentHTML("beforeend", row);
      } else {
        existing.outerHTML = row;
      }
      return;
    }
    case "hitlInline":
      r.hitlMount.replaceChildren();
      r.hitlMount.insertAdjacentHTML(
        "beforeend",
        renderHitlCard({
          requestId: msg.requestId,
          prompt: msg.prompt,
          ...(msg.details === undefined ? {} : { details: msg.details }),
        }),
      );
      scrollToBottom(r);
      return;
    case "done":
      finalizeStreamingTurn(r);
      setStreaming(r, false);
      return;
    case "error":
      finalizeStreamingTurn(r);
      // Build the error article via DOM APIs (textContent) instead of
      // insertAdjacentHTML so the agent-supplied error message can never be
      // interpreted as HTML — the strict CSP plus DOMPurify on the markdown
      // path already block script execution, but `textContent` makes the
      // intent unambiguous to static analysis (and to readers).
      {
        const article = document.createElement("article");
        article.className = "turn turn-error";
        article.setAttribute("role", "alert");
        article.textContent = `Error: ${msg.message}`;
        r.transcript.append(article);
      }
      setStreaming(r, false);
      return;
    case "emptyState":
      r.transcript.replaceChildren();
      r.emptyMount.replaceChildren();
      r.emptyMount.insertAdjacentHTML(
        "beforeend",
        renderEmptyState({
          sub: msg.sub,
          ...(msg.socketPath === undefined ? {} : { socketPath: msg.socketPath }),
        } as EmptyStateInput),
      );
      return;
    case "themeChange":
      // VS Code applies CSS variables automatically; nothing to do.
      return;
  }
}

function finalizeStreamingTurn(r: Refs): void {
  const target = r.transcript.querySelector<HTMLElement>('div.markdown[data-streaming="1"]');
  if (target !== null) {
    delete target.dataset["streaming"];
    // One last full re-render so the final markdown is well-formed.
    target.innerHTML = renderTurnBodyHtml(state.streamingText);
    target.parentElement?.classList.remove("turn-streaming");
  }
  state.streamingText = "";
  r.subTaskList.replaceChildren();
  r.hitlMount.replaceChildren();
  scrollToBottom(r);
}

function renderTurnBodyHtml(text: string): string {
  // Borrow the assistant-turn body renderer by feeding renderTurn and
  // slicing out the inner markdown div. Cheap and keeps a single source of
  // truth for the markdown invocation.
  const full = renderTurn({ role: "assistant", text });
  const start = full.indexOf('<div class="markdown">');
  const end = full.lastIndexOf("</div>");
  if (start < 0 || end < 0) return "";
  return full.slice(start + '<div class="markdown">'.length, end);
}

function setStreaming(r: Refs, streaming: boolean): void {
  state.streaming = streaming;
  r.send.disabled = streaming;
  r.stop.disabled = !streaming;
  r.status.textContent = streaming ? "Streaming…" : "";
}

function scrollToBottom(r: Refs): void {
  // The transcript pane uses overflow-y: auto; pin to the bottom on every
  // mutation while streaming so newly arriving tokens stay in view.
  r.transcript.scrollTop = r.transcript.scrollHeight;
}

/** CSS.escape polyfill — avoids pulling in the full lib. */
function cssEscape(s: string): string {
  return s.replaceAll(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// Bootstrap

function bootstrap(): void {
  const r = refs();

  // Initial state — empty until the extension hydrates or sends a turn.
  r.emptyMount.insertAdjacentHTML("beforeend", renderEmptyState({ sub: "no-transcript" }));
  setStreaming(r, false);

  // Form submit → submitAsk
  r.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.streaming) return;
    const text = r.input.value.trim();
    if (text.length === 0) return;
    vscode.postMessage({ type: "submitAsk", text });
    r.input.value = "";
  });

  // Cmd/Ctrl+Enter submits even when textarea is multi-line.
  r.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      r.form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });

  // Stop button → stopStream
  r.stop.addEventListener("click", () => {
    if (!state.streaming) return;
    vscode.postMessage({ type: "stopStream" });
  });

  // Delegated listener — split into per-target handlers so each branch stays
  // simple (Sonar's cognitive-complexity gate caps a single handler at 15).
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (target === null) return;
    if (handleHitlButtonClick(target)) return;
    handleEmptyStateActionClick(target);
  });

  window.addEventListener("message", (ev) => {
    if (!isFromExtensionHost(ev)) return;
    const data = ev.data as ExtensionToWebview;
    if (data === null || typeof data !== "object" || typeof data.type !== "string") return;
    applyMessage(r, data);
  });

  // Tell the extension we're ready to receive hydrate/empty-state.
  vscode.postMessage({ type: "ready" });
}

function mkStub(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "hitl-stub";
  el.textContent = text;
  return el;
}

/**
 * HITL Approve/Reject button click — returns true when the click was handled
 * so the caller can short-circuit. Posts the decision back to the extension
 * and replaces the card with an "decision recorded" stub for instant feedback.
 */
function handleHitlButtonClick(target: HTMLElement): boolean {
  const decisionBtn = target.closest<HTMLButtonElement>("button.hitl-btn[data-decision]");
  if (decisionBtn === null) return false;
  const requestId = decisionBtn.dataset["requestId"];
  const decision = decisionBtn.dataset["decision"];
  if (typeof requestId !== "string") return true;
  if (decision !== "approve" && decision !== "reject") return true;
  vscode.postMessage({ type: "hitlResponse", requestId, decision });
  const card = decisionBtn.closest<HTMLElement>(".hitl-card");
  if (card !== null) {
    const verb = decision === "approve" ? "approved" : "rejected";
    card.replaceWith(mkStub(`Decision recorded: ${verb}`));
  }
  return true;
}

/** Empty-state action buttons (Open Logs / Start Gateway). */
function handleEmptyStateActionClick(target: HTMLElement): void {
  const btn = target.closest<HTMLButtonElement>("button[data-action]");
  if (btn === null) return;
  const action = btn.dataset["action"];
  if (action === "openLogs") {
    vscode.postMessage({ type: "openLogs" });
  } else if (action === "startGateway") {
    vscode.postMessage({ type: "startGateway" });
  }
}

/**
 * VS Code webviews receive postMessage events from the extension host frame
 * embedding this iframe. The host sets `event.source === window.parent` and
 * uses an `vscode-webview://` origin (or a webview-prefixed scheme on web).
 * Any message that doesn't satisfy both is from a hostile injected frame
 * and must be dropped before its `data` is applied.
 */
function isFromExtensionHost(ev: MessageEvent): boolean {
  if (ev.source !== window.parent) return false;
  // `event.origin` may be empty in test/sandbox environments; only reject
  // explicit non-vscode origins so legitimate webview test harnesses still work.
  if (ev.origin.length > 0 && !ev.origin.startsWith("vscode-webview")) return false;
  return true;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
