import { renderEmptyState } from "./empty-state.js";
import { renderHitlCard } from "./hitl-card.js";
import { renderMarkdownInto } from "./markdown.js";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

const vscode = acquireVsCodeApi();

const transcriptEl = document.getElementById("transcript") as HTMLDivElement;
const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const submitEl = document.getElementById("submit") as HTMLButtonElement;
const stopEl = document.getElementById("stop") as HTMLButtonElement;

let currentAssistantMessage: HTMLDivElement | undefined;
let currentAssistantText = "";

function appendUser(text: string): void {
  const wrap = document.createElement("div");
  wrap.className = "message user";
  wrap.textContent = text;
  transcriptEl.appendChild(wrap);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function startAssistant(): void {
  const wrap = document.createElement("div");
  wrap.className = "message assistant";
  transcriptEl.appendChild(wrap);
  currentAssistantMessage = wrap;
  currentAssistantText = "";
}

function appendToken(text: string): void {
  if (currentAssistantMessage === undefined) startAssistant();
  currentAssistantText += text;
  if (currentAssistantMessage !== undefined) {
    renderMarkdownInto(currentAssistantMessage, currentAssistantText);
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function clearTranscript(): void {
  transcriptEl.innerHTML = "";
  currentAssistantMessage = undefined;
  currentAssistantText = "";
}

function showEmptyState(sub: "no-transcript" | "disconnected" | "permission-denied", socketPath?: string): void {
  clearTranscript();
  const card = renderEmptyState({
    sub,
    ...(socketPath !== undefined && { socketPath }),
    onStartGateway: () => vscode.postMessage({ type: "startGateway" }),
    onOpenLogs: () => vscode.postMessage({ type: "openLogs" }),
    onOpenDocs: () =>
      vscode.postMessage({ type: "openExternal", url: "https://nimbus.dev/install" }),
  });
  transcriptEl.appendChild(card);
}

window.addEventListener("message", (event) => {
  if (!event.origin.startsWith("vscode-webview://")) return;
  const msg = event.data as { type: string } & Record<string, unknown>;
  switch (msg.type) {
    case "reset":
      clearTranscript();
      break;
    case "hydrate": {
      clearTranscript();
      const turns = (msg["turns"] as Array<{ role: string; text: string }>) ?? [];
      for (const t of turns) {
        if (t.role === "user") appendUser(t.text);
        else {
          startAssistant();
          appendToken(t.text);
          currentAssistantMessage = undefined;
        }
      }
      break;
    }
    case "userMessage":
      appendUser(msg["text"] as string);
      startAssistant();
      break;
    case "token":
      appendToken(msg["text"] as string);
      break;
    case "done":
      currentAssistantMessage = undefined;
      stopEl.style.display = "none";
      submitEl.disabled = false;
      break;
    case "error": {
      const err = document.createElement("div");
      err.className = "message error";
      err.textContent = `Error: ${msg["message"] as string}`;
      transcriptEl.appendChild(err);
      currentAssistantMessage = undefined;
      stopEl.style.display = "none";
      submitEl.disabled = false;
      break;
    }
    case "hitlInline": {
      const card = renderHitlCard({
        requestId: msg["requestId"] as string,
        prompt: msg["prompt"] as string,
        details: msg["details"],
        onResponse: (rid, dec) =>
          vscode.postMessage({ type: "hitlResponse", requestId: rid, decision: dec }),
      });
      transcriptEl.appendChild(card);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
      break;
    }
    case "emptyState":
      showEmptyState(
        msg["sub"] as "no-transcript" | "disconnected" | "permission-denied",
        msg["socketPath"] as string | undefined,
      );
      break;
    case "subTask":
      {
        const chip = document.createElement("div");
        chip.className = "subtask";
        chip.textContent = `[${msg["status"]}] ${msg["subTaskId"]}`;
        transcriptEl.appendChild(chip);
      }
      break;
  }
});

submitEl.addEventListener("click", () => {
  const text = inputEl.value.trim();
  if (text.length === 0) return;
  inputEl.value = "";
  submitEl.disabled = true;
  stopEl.style.display = "inline-block";
  vscode.postMessage({ type: "submitAsk", text });
});

stopEl.addEventListener("click", () => {
  vscode.postMessage({ type: "stopStream" });
});

vscode.postMessage({ type: "ready" });
