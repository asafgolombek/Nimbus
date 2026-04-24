/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { type EmptyStateInput, renderEmptyState } from "../../../src/chat/webview/empty-state.js";

function makeInput(sub: EmptyStateInput["sub"], extra?: Partial<EmptyStateInput>): EmptyStateInput {
  return {
    sub,
    onStartGateway: vi.fn(),
    onOpenLogs: vi.fn(),
    onOpenDocs: vi.fn(),
    ...extra,
  };
}

describe("renderEmptyState", () => {
  describe("no-transcript sub", () => {
    test("returns an HTMLElement", () => {
      expect(renderEmptyState(makeInput("no-transcript"))).toBeInstanceOf(HTMLElement);
    });

    test("renders 'Ask Nimbus anything' heading", () => {
      const el = renderEmptyState(makeInput("no-transcript"));
      expect(el.querySelector("h2")?.textContent).toBe("Ask Nimbus anything");
    });

    test("renders instructional paragraph text", () => {
      const el = renderEmptyState(makeInput("no-transcript"));
      expect(el.textContent).toContain("Ask");
      expect(el.textContent).toContain("Search");
    });

    test("does not render any buttons", () => {
      const el = renderEmptyState(makeInput("no-transcript"));
      expect(el.querySelectorAll("button").length).toBe(0);
    });
  });

  describe("disconnected sub", () => {
    test("renders 'Nimbus Gateway is not running' heading", () => {
      const el = renderEmptyState(makeInput("disconnected"));
      expect(el.querySelector("h2")?.textContent).toBe("Nimbus Gateway is not running");
    });

    test("renders Start Gateway button that calls onStartGateway", () => {
      const inp = makeInput("disconnected");
      const el = renderEmptyState(inp);
      const btn = el.querySelector("button.empty-state-primary") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe("Start Gateway");
      btn.click();
      expect(inp.onStartGateway).toHaveBeenCalled();
    });

    test("renders Read Install Docs button that calls onOpenDocs", () => {
      const inp = makeInput("disconnected");
      const el = renderEmptyState(inp);
      const btn = el.querySelector("button.empty-state-secondary") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe("Read Install Docs");
      btn.click();
      expect(inp.onOpenDocs).toHaveBeenCalled();
    });

    test("includes socket path in paragraph when socketPath is provided", () => {
      const el = renderEmptyState(makeInput("disconnected", { socketPath: "/run/nimbus.sock" }));
      expect(el.querySelector("p")?.textContent).toContain("/run/nimbus.sock");
    });

    test("renders paragraph without socket path when socketPath is omitted", () => {
      const pText =
        renderEmptyState(makeInput("disconnected")).querySelector("p")?.textContent ?? "";
      expect(pText).toContain("Gateway socket");
      expect(pText).not.toContain("at /");
    });
  });

  describe("permission-denied sub", () => {
    test("renders 'Permission denied' heading", () => {
      const el = renderEmptyState(makeInput("permission-denied"));
      expect(el.querySelector("h2")?.textContent).toBe("Permission denied");
    });

    test("renders Open Logs button that calls onOpenLogs", () => {
      const inp = makeInput("permission-denied");
      const el = renderEmptyState(inp);
      const btn = el.querySelector("button.empty-state-secondary") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe("Open Logs");
      btn.click();
      expect(inp.onOpenLogs).toHaveBeenCalled();
    });

    test("includes socket path in paragraph when socketPath is provided", () => {
      const el = renderEmptyState(
        makeInput("permission-denied", { socketPath: "/run/nimbus.sock" }),
      );
      expect(el.querySelector("p")?.textContent).toContain("/run/nimbus.sock");
    });

    test("paragraph mentions gateway socket without socket path when omitted", () => {
      const pText =
        renderEmptyState(makeInput("permission-denied")).querySelector("p")?.textContent ?? "";
      expect(pText.toLowerCase()).toContain("gateway socket");
    });

    test("has empty-state-card class on root element", () => {
      expect(renderEmptyState(makeInput("permission-denied")).className).toBe("empty-state-card");
    });
  });
});
