// @vitest-environment jsdom
import { describe, expect, test } from "vitest";

import { renderMarkdownInto } from "../../../src/chat/webview/markdown.js";

describe("renderMarkdownInto", () => {
  test("renders headings, paragraphs, code blocks", () => {
    const el = document.createElement("div");
    renderMarkdownInto(el, "# Title\n\nHello\n\n```ts\nconst x = 1;\n```");
    expect(el.querySelector("h1")?.textContent).toBe("Title");
    expect(el.querySelector("pre code")).not.toBeNull();
  });

  test("incremental token append produces accumulating DOM", () => {
    const el = document.createElement("div");
    renderMarkdownInto(el, "He");
    renderMarkdownInto(el, "Hello world");
    expect(el.textContent).toContain("Hello world");
  });

  test("code block gets a copy button", () => {
    const el = document.createElement("div");
    renderMarkdownInto(el, "```js\nfoo()\n```");
    expect(el.querySelector("button.copy-code")).not.toBeNull();
  });
});
