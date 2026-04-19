import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => undefined),
}));

import { RootLayout } from "../../src/layouts/RootLayout";
import { useNimbusStore } from "../../src/store";

describe("RootLayout", () => {
  beforeEach(() => {
    useNimbusStore.setState({ connectionState: "connected" });
  });

  const renderWith = () =>
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<RootLayout />}>
            <Route index element={<div>child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

  it("does not render the offline banner when connected", () => {
    renderWith();
    expect(screen.queryByText(/Gateway is not running/i)).toBeNull();
    expect(screen.getByText("child")).toBeTruthy();
  });

  it("renders the offline banner when disconnected", () => {
    useNimbusStore.setState({ connectionState: "disconnected" });
    renderWith();
    expect(screen.getByText(/Gateway is not running/i)).toBeTruthy();
    expect(screen.getByText("child")).toBeTruthy();
  });
});
