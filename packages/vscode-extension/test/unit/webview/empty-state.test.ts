/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { renderEmptyState } from "../../../src/chat/webview/empty-state.js";

describe("renderEmptyState", () => {
  describe("no-transcript sub", () => {
    test("returns an HTMLElement", () => {
      const el = renderEmptyState({
        sub: "no-transcript",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      expect(el).toBeInstanceOf(HTMLElement);
    });

    test("renders 'Ask Nimbus anything' heading", () => {
      const el = renderEmptyState({
        sub: "no-transcript",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      expect(el.querySelector("h2")?.textContent).toBe("Ask Nimbus anything");
    });

    test("renders instructional paragraph text", () => {
      const el = renderEmptyState({
        sub: "no-transcript",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      expect(el.textContent).toContain("Ask");
      expect(el.textContent).toContain("Search");
    });

    test("does not render any buttons", () => {
      const el = renderEmptyState({
        sub: "no-transcript",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      expect(el.querySelectorAll("button").length).toBe(0);
    });
  });

  describe("disconnected sub", () => {
    test("renders 'Nimbus Gateway is not running' heading", () => {
      const el = renderEmptyState({
        sub: "disconnected",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      expect(el.querySelector("h2")?.textContent).toBe("Nimbus Gateway is not running");
    });

    test("renders Start Gateway button that calls onStartGateway", () => {
      const onStartGateway = vi.fn();
      const el = renderEmptyState({
        sub: "disconnected",
        onStartGateway,
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      const btn = el.querySelector("button.empty-state-primary") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe("Start Gateway");
      btn.click();
      expect(onStartGateway).toHaveBeenCalled();
    });

    test("renders Read Install Docs button that calls onOpenDocs", () => {
      const onOpenDocs = vi.fn();
      const el = renderEmptyState({
        sub: "disconnected",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs,
      });
      const btn = el.querySelector("button.empty-state-secondary") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe("Read Install Docs");
      btn.click();
      expect(onOpenDocs).toHaveBeenCalled();
    });

    test("includes socket path in paragraph when socketPath is provided", () => {
      const el = renderEmptyState({
        sub: "disconnected",
        socketPath: "/run/nimbus.sock",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      expect(el.querySelector("p")?.textContent).toContain("/run/nimbus.sock");
    });

    test("renders paragraph without socket path when socketPath is omitted", () => {
      const el = renderEmptyState({
        sub: "disconnected",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      const pText = el.querySelector("p")?.textContent ?? "";
      expect(pText).toContain("Gateway socket");
      expect(pText).not.toContain("at /");
    });
  });

  describe("permission-denied sub", () => {
    test("renders 'Permission denied' heading", () => {
      const el = renderEmptyState({
        sub: "permission-denied",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      expect(el.querySelector("h2")?.textContent).toBe("Permission denied");
    });

    test("renders Open Logs button that calls onOpenLogs", () => {
      const onOpenLogs = vi.fn();
      const el = renderEmptyState({
        sub: "permission-denied",
        onStartGateway: vi.fn(),
        onOpenLogs,
        onOpenDocs: vi.fn(),
      });
      const btn = el.querySelector("button.empty-state-secondary") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe("Open Logs");
      btn.click();
      expect(onOpenLogs).toHaveBeenCalled();
    });

    test("includes socket path in paragraph when socketPath is provided", () => {
      const el = renderEmptyState({
        sub: "permission-denied",
        socketPath: "/run/nimbus.sock",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      expect(el.querySelector("p")?.textContent).toContain("/run/nimbus.sock");
    });

    test("paragraph mentions gateway socket without socket path when omitted", () => {
      const el = renderEmptyState({
        sub: "permission-denied",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      const pText = el.querySelector("p")?.textContent ?? "";
      expect(pText.toLowerCase()).toContain("gateway socket");
    });

    test("has empty-state-card class on root element", () => {
      const el = renderEmptyState({
        sub: "permission-denied",
        onStartGateway: vi.fn(),
        onOpenLogs: vi.fn(),
        onOpenDocs: vi.fn(),
      });
      expect(el.className).toBe("empty-state-card");
    });
  });
});
