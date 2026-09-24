import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InterferenceSweepChart } from "./InterferenceSweepChart";
import type { InterferenceSweepPoint } from "../api/rest";

const points: InterferenceSweepPoint[] = [
  { interference_radius: 10, mis_size: 4 },
  { interference_radius: 20, mis_size: 3 },
  { interference_radius: 35, mis_size: 1 },
];

describe("InterferenceSweepChart", () => {
  it("renders a fallback message instead of an empty chart when there are no points", () => {
    render(<InterferenceSweepChart points={[]} currentR={20} onPick={vi.fn()} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/אין מספיק קישורים/)).toBeInTheDocument();
  });

  it("draws one dot per breakpoint plus a step path", () => {
    const { container } = render(
      <InterferenceSweepChart points={points} currentR={20} onPick={vi.fn()} />,
    );
    expect(container.querySelectorAll("circle").length).toBe(points.length);
    // Step line + area fill.
    expect(container.querySelectorAll("path").length).toBe(2);
  });

  it("draws the current-R' marker only when it falls within the plotted range", () => {
    const { container, rerender } = render(
      <InterferenceSweepChart points={points} currentR={20} onPick={vi.fn()} />,
    );
    const linesWithMarker = container.querySelectorAll("line").length;
    expect(linesWithMarker).toBeGreaterThan(0);

    rerender(<InterferenceSweepChart points={points} currentR={-500} onPick={vi.fn()} />);
    // Grid lines remain, but the dashed R' marker line should be gone.
    expect(container.querySelectorAll("line").length).toBeLessThan(linesWithMarker);
  });

  it("calls onPick with the nearest breakpoint's R' when clicked", () => {
    const onPick = vi.fn();
    const { container } = render(
      <InterferenceSweepChart points={points} currentR={20} onPick={onPick} />,
    );
    const svg = container.querySelector("svg")!;
    // Hover near the first point so it becomes the "nearest" hover target,
    // then click — jsdom's getBoundingClientRect is all zeros, so every
    // point maps to the same pixel and the first one wins deterministically.
    fireEvent.mouseMove(svg, { clientX: 0, clientY: 0 });
    fireEvent.click(svg);
    expect(onPick).toHaveBeenCalledWith(points[0].interference_radius);
  });
});
