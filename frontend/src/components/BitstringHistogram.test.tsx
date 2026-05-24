import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BitstringHistogram } from "./BitstringHistogram";

describe("BitstringHistogram", () => {
  it("renders one bar per histogram entry", () => {
    const { container } = render(
      <BitstringHistogram
        histogram={{ "00": 10, "01": 5, "10": 3, "11": 1 }}
        totalShots={19}
      />,
    );
    expect(container.querySelectorAll("rect").length).toBeGreaterThanOrEqual(4);
  });

  it("limits to topK bars", () => {
    const hist: Record<string, number> = {};
    for (let i = 0; i < 50; i++) {
      hist[i.toString(2).padStart(8, "0")] = 50 - i;
    }
    const { container } = render(
      <BitstringHistogram histogram={hist} totalShots={1275} topK={10} />,
    );
    // Each bar produces a <rect>; count the bar rects (exclude any background rects)
    const bars = Array.from(container.querySelectorAll("rect")).filter(
      (r) => r.getAttribute("rx") === "2",
    );
    expect(bars.length).toBe(10);
  });

  it("renders an empty histogram without crashing", () => {
    const { container } = render(
      <BitstringHistogram histogram={{}} totalShots={0} />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows the total shots in the footer", () => {
    render(
      <BitstringHistogram histogram={{ "00": 50, "11": 50 }} totalShots={100} />,
    );
    expect(screen.getByText(/100 shots total/)).toBeInTheDocument();
  });

  it("shows unique count in the corner", () => {
    render(
      <BitstringHistogram
        histogram={{ "0": 1, "1": 1 }}
        totalShots={2}
      />,
    );
    // "2 / 2 unique"
    expect(screen.getByText(/2 \/ 2 unique/)).toBeInTheDocument();
  });

  it("highlights bars whose Hamming weight matches highlightSize", () => {
    const { container } = render(
      <BitstringHistogram
        histogram={{ "00": 10, "11": 10, "10": 5 }}
        totalShots={25}
        highlightSize={2}
      />,
    );
    // "11" has weight 2 → should get the brighter fill
    const bars = Array.from(container.querySelectorAll("rect")).filter(
      (r) => r.getAttribute("rx") === "2",
    );
    // At least one bar must have the glow fill
    const fills = bars.map((b) => b.getAttribute("fill"));
    expect(fills).toContain("#b388ff"); // queraPurpleGlow
  });

  it("marks a specific bitstring in green", () => {
    const { container } = render(
      <BitstringHistogram
        histogram={{ "00": 10, "11": 5 }}
        totalShots={15}
        markedBitstring="11"
      />,
    );
    const bars = Array.from(container.querySelectorAll("rect")).filter(
      (r) => r.getAttribute("rx") === "2",
    );
    const fills = bars.map((b) => b.getAttribute("fill"));
    expect(fills).toContain("#3ddc97"); // ok color
  });

  it("uses LTR wrapper", () => {
    const { container } = render(
      <BitstringHistogram histogram={{ "0": 1 }} totalShots={1} />,
    );
    expect((container.firstChild as HTMLElement).getAttribute("dir")).toBe("ltr");
  });
});
