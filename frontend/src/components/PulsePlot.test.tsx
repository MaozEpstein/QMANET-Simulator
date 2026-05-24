import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PulsePlot, valueAt } from "./PulsePlot";
import type { PiecewiseLinearDTO } from "../api/rest";

const omega: PiecewiseLinearDTO = {
  times: [0, 0.4, 3.6, 4.0],
  values: [0, 15, 15, 0],
};
const delta: PiecewiseLinearDTO = {
  times: [0, 0.4, 3.6, 4.0],
  values: [-30, -30, 40, 40],
};
const phi: PiecewiseLinearDTO = {
  times: [0, 4.0],
  values: [0, 0],
};

describe("PulsePlot", () => {
  it("renders an SVG with one panel per channel", () => {
    const { container } = render(
      <PulsePlot
        totalDurationUs={4}
        channels={[
          { data: omega, label: "Ω(t)", units: "rad/µs", upperLimit: 15.8, lowerLimit: 0 },
          { data: delta, label: "Δ(t)", units: "rad/µs", upperLimit: 125, lowerLimit: -125 },
          { data: phi, label: "φ(t)", units: "rad" },
        ]}
      />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("Ω(t)")).toBeInTheDocument();
    expect(screen.getByText("Δ(t)")).toBeInTheDocument();
    expect(screen.getByText("φ(t)")).toBeInTheDocument();
  });

  it("draws all breakpoints as dots", () => {
    const { container } = render(
      <PulsePlot
        totalDurationUs={4}
        channels={[{ data: omega, label: "Ω", units: "rad/µs" }]}
      />,
    );
    // 4 breakpoints in omega
    expect(container.querySelectorAll("circle").length).toBe(4);
  });

  it("draws constraint lines as red dashed when limits supplied", () => {
    const { container } = render(
      <PulsePlot
        totalDurationUs={4}
        channels={[
          { data: omega, label: "Ω", units: "rad/µs", upperLimit: 15.8, lowerLimit: 0 },
        ]}
      />,
    );
    const dashed = Array.from(container.querySelectorAll("line")).filter((l) =>
      l.getAttribute("stroke-dasharray"),
    );
    expect(dashed.length).toBeGreaterThanOrEqual(2); // upper + lower
  });

  it("highlights cursor and calls onCursorChange when moving over the plot", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PulsePlot
        totalDurationUs={4}
        cursorT={2}
        onCursorChange={onChange}
        channels={[{ data: omega, label: "Ω", units: "rad/µs" }]}
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 100 });
    expect(onChange).toHaveBeenCalled();
    const t = onChange.mock.calls[0][0];
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(4);
  });

  it("handles a zero-duration plot without crashing", () => {
    const { container } = render(
      <PulsePlot
        totalDurationUs={0}
        channels={[{ data: { times: [], values: [] }, label: "X", units: "—" }]}
      />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("uses an LTR wrapper so it doesn't flip in RTL parents", () => {
    const { container } = render(
      <PulsePlot
        totalDurationUs={4}
        channels={[{ data: omega, label: "Ω", units: "rad/µs" }]}
      />,
    );
    expect((container.firstChild as HTMLElement).getAttribute("dir")).toBe("ltr");
  });
});

describe("valueAt", () => {
  it("returns endpoint clamped values outside range", () => {
    expect(valueAt(omega, -1)).toBe(0);
    expect(valueAt(omega, 100)).toBe(0);
  });

  it("interpolates linearly inside a segment", () => {
    // Segment: t∈[0, 0.4], v∈[0, 15], so at t=0.2 ⇒ 7.5
    expect(valueAt(omega, 0.2)).toBeCloseTo(7.5);
  });

  it("returns plateau value during the plateau", () => {
    expect(valueAt(omega, 2.0)).toBe(15);
  });

  it("handles empty piecewise", () => {
    expect(valueAt({ times: [], values: [] }, 1.0)).toBe(0);
  });

  it("handles a single point", () => {
    expect(valueAt({ times: [0], values: [5] }, 10)).toBe(5);
  });
});
