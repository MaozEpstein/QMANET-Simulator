/**
 * AtomArray2D rendering tests.
 *
 * Coverage:
 *  - renders for n=0, n=1, many atoms
 *  - draws blockade rings only when showBlockade is true
 *  - draws grid lines only when showGrid is true
 *  - edges between atoms get drawn
 *  - highlight set highlights the right atoms
 *  - caption is rendered
 *  - LTR wrapper preserves coordinate orientation in RTL parents
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AtomArray2D } from "./AtomArray2D";
import type { NodePos } from "../api/rest";

const atoms3: NodePos[] = [
  { id: 0, x: 10, y: 10 },
  { id: 1, x: 30, y: 30 },
  { id: 2, x: 50, y: 50 },
];

describe("AtomArray2D", () => {
  it("renders an svg with id labels for n=3", () => {
    const { container } = render(
      <AtomArray2D atoms={atoms3} blockadeRadiusUm={8} />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    // Only consider atom labels (text inside an atom <g transform=...>), not axis ticks.
    const atomLabels = Array.from(container.querySelectorAll("g[transform] text"))
      .map((t) => t.textContent)
      .filter(Boolean) as string[];
    expect(atomLabels.sort()).toEqual(["0", "1", "2"]);
  });

  it("renders empty (no atoms) without crashing", () => {
    const { container } = render(<AtomArray2D atoms={[]} blockadeRadiusUm={8} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    // The user-region rect + dotted boundary still rendered
  });

  it("renders a single atom in the center area", () => {
    const { container } = render(
      <AtomArray2D atoms={[{ id: 0, x: 37.5, y: 38 }]} blockadeRadiusUm={8} />,
    );
    const groups = container.querySelectorAll("g[transform]");
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("draws blockade rings by default", () => {
    const { container } = render(
      <AtomArray2D atoms={atoms3} blockadeRadiusUm={8} />,
    );
    // One blockade ring per atom; identifiable by dashed stroke
    const dashed = Array.from(container.querySelectorAll("circle")).filter((c) =>
      c.getAttribute("stroke-dasharray"),
    );
    expect(dashed.length).toBe(atoms3.length);
  });

  it("omits blockade rings when showBlockade=false", () => {
    const { container } = render(
      <AtomArray2D atoms={atoms3} blockadeRadiusUm={8} showBlockade={false} />,
    );
    const dashed = Array.from(container.querySelectorAll("circle")).filter((c) =>
      c.getAttribute("stroke-dasharray"),
    );
    expect(dashed.length).toBe(0);
  });

  it("draws grid lines by default", () => {
    const { container } = render(
      <AtomArray2D atoms={atoms3} blockadeRadiusUm={8} latticeSpacingUm={5} />,
    );
    // For 75x76 with 5µm spacing → 16 vertical + 16 horizontal lines roughly
    const lines = container.querySelectorAll("line");
    expect(lines.length).toBeGreaterThan(10);
  });

  it("omits grid lines when showGrid=false", () => {
    const { container } = render(
      <AtomArray2D atoms={atoms3} blockadeRadiusUm={8} showGrid={false} />,
    );
    // Edges (none here) and grid (none here) → expect 0 lines
    expect(container.querySelectorAll("line").length).toBe(0);
  });

  it("draws edges between atoms", () => {
    const { container } = render(
      <AtomArray2D
        atoms={atoms3}
        blockadeRadiusUm={8}
        edges={[
          [0, 1],
          [1, 2],
        ]}
        showGrid={false}
      />,
    );
    expect(container.querySelectorAll("line").length).toBe(2);
  });

  it("highlights atoms whose ids appear in `highlight`", () => {
    const { container } = render(
      <AtomArray2D atoms={atoms3} blockadeRadiusUm={8} highlight={new Set([1])} />,
    );
    // Highlighted atoms have r=8; non-highlighted have r=6
    const atomCircles = Array.from(container.querySelectorAll("g[transform] circle"));
    const hi = atomCircles.filter((c) => c.getAttribute("r") === "8");
    expect(hi.length).toBe(1);
  });

  it("renders the caption when provided", () => {
    render(
      <AtomArray2D atoms={atoms3} blockadeRadiusUm={8} caption="K3 · R_b=8µm" />,
    );
    expect(screen.getByText(/R_b=8µm/)).toBeInTheDocument();
  });

  it("uses LTR direction wrapper so atoms don't get RTL-flipped in Hebrew layouts", () => {
    const { container } = render(<AtomArray2D atoms={atoms3} blockadeRadiusUm={8} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.getAttribute("dir")).toBe("ltr");
  });

  it("colors atoms by population when populations are provided", () => {
    // p=0 → cyan; p=1 → glow purple. Verify the fill attribute differs between
    // an excited atom and a ground-state atom.
    const { container } = render(
      <AtomArray2D atoms={atoms3} blockadeRadiusUm={8} populations={[0, 0.5, 1]} />,
    );
    const fills = Array.from(container.querySelectorAll("g[transform] circle")).map((c) =>
      c.getAttribute("fill"),
    );
    expect(fills[0]).not.toEqual(fills[2]);
  });

  it("excited atoms (p=1) have a larger radius than ground-state atoms (p=0)", () => {
    const { container } = render(
      <AtomArray2D atoms={atoms3} blockadeRadiusUm={8} populations={[0, 0, 1]} />,
    );
    const radii = Array.from(container.querySelectorAll("g[transform] circle")).map((c) =>
      Number(c.getAttribute("r")),
    );
    expect(radii[2]).toBeGreaterThan(radii[0]);
  });
});
