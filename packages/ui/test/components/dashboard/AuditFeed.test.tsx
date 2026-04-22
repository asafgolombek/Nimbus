import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditFeed } from "../../../src/components/dashboard/AuditFeed";

const hookState = { data: null as unknown, error: null as string | null, isLoading: false };
vi.mock("../../../src/hooks/useIpcQuery", () => ({ useIpcQuery: () => hookState }));

describe("AuditFeed", () => {
  it("renders recent entries using the Gateway wire shape", () => {
    hookState.data = [
      {
        id: 1,
        actionType: "file.create",
        hitlStatus: "approved",
        actionJson: JSON.stringify({ subject: "doc.md" }),
        timestamp: Date.now(),
      },
      {
        id: 2,
        actionType: "email.draft.send",
        hitlStatus: "rejected",
        actionJson: JSON.stringify({ subject: "to:a@b" }),
        timestamp: Date.now(),
      },
      {
        id: 3,
        actionType: "startup",
        hitlStatus: "not_required",
        actionJson: "{}",
        timestamp: Date.now(),
      },
    ];
    render(<AuditFeed />);
    expect(screen.getByText("file.create")).toBeInTheDocument();
    expect(screen.getByText("email.draft.send")).toBeInTheDocument();
    expect(screen.getByText("startup")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.getByText("not_required")).toBeInTheDocument();
    expect(screen.getByText("doc.md")).toBeInTheDocument();
  });

  it("shows empty state when no entries", () => {
    hookState.data = [];
    render(<AuditFeed />);
    expect(screen.getByText(/No recent activity/i)).toBeInTheDocument();
  });

  it("handles malformed actionJson gracefully (no subject rendered)", () => {
    hookState.data = [
      {
        id: 1,
        actionType: "weird.entry",
        hitlStatus: "approved",
        actionJson: "not json",
        timestamp: Date.now(),
      },
    ];
    render(<AuditFeed />);
    expect(screen.getByText("weird.entry")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
  });
});
