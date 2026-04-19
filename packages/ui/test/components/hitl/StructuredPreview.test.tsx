import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StructuredPreview } from "../../../src/components/hitl/StructuredPreview";

describe("StructuredPreview", () => {
  it("renders scalar key/value rows", () => {
    render(<StructuredPreview details={{ channel: "#eng", text: "hi" }} />);
    expect(screen.getByText("channel")).toBeInTheDocument();
    expect(screen.getByText("#eng")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("hides rows with null / undefined values", () => {
    render(<StructuredPreview details={{ a: "x", b: null, c: undefined }} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText("b")).not.toBeInTheDocument();
    expect(screen.queryByText("c")).not.toBeInTheDocument();
  });

  it("never renders raw HTML in values", () => {
    render(<StructuredPreview details={{ payload: "<script>alert(1)</script>" }} />);
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("joins arrays of scalars with commas", () => {
    render(<StructuredPreview details={{ recipients: ["a", "b", "c"] }} />);
    expect(screen.getByText("a, b, c")).toBeInTheDocument();
  });

  it("renders nested object one level deep", () => {
    render(<StructuredPreview details={{ meta: { author: "me", team: "eng" } }} />);
    expect(screen.getByText("author")).toBeInTheDocument();
    expect(screen.getByText("me")).toBeInTheDocument();
  });
});
