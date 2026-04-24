// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import { renderHitlCard } from "../../../src/chat/webview/hitl-card.js";

describe("renderHitlCard", () => {
  test("renders prompt + Approve/Reject buttons", () => {
    const onResponse = vi.fn();
    const card = renderHitlCard({
      requestId: "r1",
      prompt: "Send email?",
      onResponse,
    });
    expect(card.textContent).toContain("Send email?");
    const buttons = card.querySelectorAll("button");
    expect(buttons.length).toBe(2);
  });

  test("Approve click invokes callback with 'approve'", () => {
    const onResponse = vi.fn();
    const card = renderHitlCard({
      requestId: "r1",
      prompt: "Send email?",
      onResponse,
    });
    const approve = card.querySelector("button.hitl-approve") as HTMLButtonElement;
    approve.click();
    expect(onResponse).toHaveBeenCalledWith("r1", "approve");
  });
});
