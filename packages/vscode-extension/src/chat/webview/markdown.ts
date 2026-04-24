import { marked } from "marked";

export function renderMarkdownInto(container: HTMLElement, markdownText: string): void {
  const html = marked.parse(markdownText, { async: false }) as string;
  container.innerHTML = html;
  for (const pre of Array.from(container.querySelectorAll("pre"))) {
    if (pre.querySelector("button.copy-code") !== null) continue;
    const btn = document.createElement("button");
    btn.className = "copy-code";
    btn.textContent = "Copy";
    btn.addEventListener("click", () => {
      const code = pre.querySelector("code");
      if (code !== null && navigator.clipboard !== undefined) {
        void navigator.clipboard.writeText(code.textContent ?? "");
      }
    });
    pre.style.position = "relative";
    btn.style.position = "absolute";
    btn.style.top = "4px";
    btn.style.right = "4px";
    pre.appendChild(btn);
  }
}
