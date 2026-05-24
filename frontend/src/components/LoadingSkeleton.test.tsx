import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingSkeleton, SkeletonBlock } from "./LoadingSkeleton";

describe("LoadingSkeleton", () => {
  it("has role=status and aria-busy=true for a11y", () => {
    render(<LoadingSkeleton label="loading manet" />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("loading manet");
  });

  it("renders the label when provided", () => {
    render(<LoadingSkeleton label="thinking…" />);
    expect(screen.getByText("thinking…")).toBeInTheDocument();
  });

  it("works without a label", () => {
    const { container } = render(<LoadingSkeleton height={16} />);
    expect(container.querySelector("[role=status]")).toBeInTheDocument();
  });
});

describe("SkeletonBlock", () => {
  it("renders a box with two child shimmer bars", () => {
    const { container } = render(<SkeletonBlock width={500} height={300} label="x" />);
    // SkeletonBlock + 2 inner LoadingSkeleton wrappers = 3 role=status
    expect(container.querySelectorAll("[role=status]").length).toBe(3);
  });

  it("renders the optional label", () => {
    render(<SkeletonBlock width={400} height={200} label="simulating…" />);
    expect(screen.getByText("simulating…")).toBeInTheDocument();
  });
});
