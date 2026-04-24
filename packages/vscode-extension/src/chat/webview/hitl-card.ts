export type HitlCardInput = {
  requestId: string;
  prompt: string;
  details?: unknown;
  onResponse: (requestId: string, decision: "approve" | "reject") => void;
};

export function renderHitlCard(inp: HitlCardInput): HTMLElement {
  const card = document.createElement("div");
  card.className = "hitl-card";

  const header = document.createElement("h4");
  header.textContent = "Consent required";
  card.appendChild(header);

  const promptEl = document.createElement("p");
  promptEl.textContent = inp.prompt;
  card.appendChild(promptEl);

  if (inp.details !== undefined && inp.details !== null) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(inp.details, null, 2);
    card.appendChild(pre);
  }

  const actions = document.createElement("div");
  actions.className = "hitl-actions";

  const approve = document.createElement("button");
  approve.className = "hitl-approve";
  approve.textContent = "Approve";
  approve.addEventListener("click", () => {
    approve.disabled = true;
    reject.disabled = true;
    inp.onResponse(inp.requestId, "approve");
  });

  const reject = document.createElement("button");
  reject.className = "hitl-reject";
  reject.textContent = "Reject";
  reject.addEventListener("click", () => {
    approve.disabled = true;
    reject.disabled = true;
    inp.onResponse(inp.requestId, "reject");
  });

  actions.appendChild(approve);
  actions.appendChild(reject);
  card.appendChild(actions);

  return card;
}
