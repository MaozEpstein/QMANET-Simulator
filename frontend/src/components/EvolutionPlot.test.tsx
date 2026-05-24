import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EvolutionPlot } from "./EvolutionPlot";
import type { SimulationFrameDTO } from "../api/rest";

function makeFrames(n: number, nAtoms: number): SimulationFrameDTO[] {
  return Array.from({ length: n }, (_, i) => ({
    t_us: (i / (n - 1)) * 2.0,
    rydberg_populations: Array.from({ length: nAtoms }, (_, j) =>
      ((j + 1) * i) / (n - 1) > 1 ? 1 : ((j + 1) * i) / (n - 1),
    ),
    norm: 1,
  }));
}

describe("EvolutionPlot", () => {
  it("renders one path per atom", () => {
    const { container } = render(
      <EvolutionPlot frames={makeFrames(10, 3)} totalDurationUs={2} />,
    );
    expect(container.querySelectorAll("path").length).toBe(3);
  });

  it("renders with empty frames without crashing", () => {
    const { container } = render(<EvolutionPlot frames={[]} totalDurationUs={4} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll("path").length).toBe(0);
  });

  it("draws a cursor line at currentFrameIndex", () => {
    const { container } = render(
      <EvolutionPlot frames={makeFrames(20, 2)} totalDurationUs={2} currentFrameIndex={10} />,
    );
    // Cursor uses stroke-dasharray; the path lines don't.
    const dashed = Array.from(container.querySelectorAll("line")).filter((l) =>
      l.getAttribute("stroke-dasharray"),
    );
    expect(dashed.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onScrub with a frame index when moused over", () => {
    const onScrub = vi.fn();
    const { container } = render(
      <EvolutionPlot
        frames={makeFrames(20, 2)}
        totalDurationUs={2}
        currentFrameIndex={0}
        onScrub={onScrub}
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 50 });
    expect(onScrub).toHaveBeenCalled();
    const idx = onScrub.mock.calls[0][0];
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(20);
  });

  it("uses LTR wrapper to avoid coordinate flip in RTL parents", () => {
    const { container } = render(
      <EvolutionPlot frames={makeFrames(5, 1)} totalDurationUs={1} />,
    );
    expect((container.firstChild as HTMLElement).getAttribute("dir")).toBe("ltr");
  });
});
