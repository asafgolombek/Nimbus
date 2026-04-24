export type EmptyStateInput = {
  sub: "no-transcript" | "disconnected" | "permission-denied";
  socketPath?: string;
  onStartGateway: () => void;
  onOpenLogs: () => void;
  onOpenDocs: () => void;
};

export function renderEmptyState(inp: EmptyStateInput): HTMLElement {
  const card = document.createElement("div");
  card.className = "empty-state-card";

  if (inp.sub === "no-transcript") {
    const h = document.createElement("h2");
    h.textContent = "Ask Nimbus anything";
    const p = document.createElement("p");
    p.textContent =
      "Use the input below, or run a command from the palette: Search, Run Workflow, Ask About Selection.";
    card.appendChild(h);
    card.appendChild(p);
    return card;
  }

  if (inp.sub === "disconnected") {
    const h = document.createElement("h2");
    h.textContent = "Nimbus Gateway is not running";
    const p = document.createElement("p");
    p.textContent = `The extension can't reach the Gateway socket${
      inp.socketPath === undefined ? "" : ` at ${inp.socketPath}`
    }. The Gateway is a separate background process.`;
    card.appendChild(h);
    card.appendChild(p);
    const start = document.createElement("button");
    start.className = "empty-state-primary";
    start.textContent = "Start Gateway";
    start.addEventListener("click", inp.onStartGateway);
    card.appendChild(start);
    const docs = document.createElement("button");
    docs.className = "empty-state-secondary";
    docs.textContent = "Read Install Docs";
    docs.addEventListener("click", inp.onOpenDocs);
    card.appendChild(docs);
    return card;
  }

  // permission-denied
  const h = document.createElement("h2");
  h.textContent = "Permission denied";
  const p = document.createElement("p");
  p.textContent = `The extension cannot access the Gateway socket${
    inp.socketPath === undefined ? "" : `: ${inp.socketPath}`
  }. Check ownership/mode or set nimbus.socketPath.`;
  card.appendChild(h);
  card.appendChild(p);
  const logs = document.createElement("button");
  logs.className = "empty-state-secondary";
  logs.textContent = "Open Logs";
  logs.addEventListener("click", inp.onOpenLogs);
  card.appendChild(logs);
  return card;
}
