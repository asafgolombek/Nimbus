import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditFeed } from "../../../src/components/dashboard/AuditFeed";

const hookState = { data: null as unknown, error: null as string | null, isLoading: false };
vi.mock("../../../src/hooks/useIpcQuery", () => ({ useIpcQuery: () => hookState }));

describe("AuditFeed", () => {
  it("renders recent entries", () => {
    hookState.data = [
      {
        id: 1,
        ts: new Date().toISOString(),
        action: "file.create",
        outcome: "approved",
        subject: "doc.md",
      },
      {
        id: 2,
        ts: new Date().toISOString(),
        action: "email.draft.send",
        outcome: "rejected",
        subject: "to:a@b",
      },
    ];
    render(<AuditFeed />);
    expect(screen.getByText("file.create")).toBeInTheDocument();
    expect(screen.getByText("email.draft.send")).toBeInTheDocument();
    expect(screen.getByText(/approved/)).toBeInTheDocument();
    expect(screen.getByText(/rejected/)).toBeInTheDocument();
  });

  it("shows empty state when no entries", () => {
    hookState.data = [];
    render(<AuditFeed />);
    expect(screen.getByText(/No recent activity/i)).toBeInTheDocument();
  });
});
