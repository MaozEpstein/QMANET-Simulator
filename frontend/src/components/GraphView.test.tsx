/**
 * GraphView rendering tests.
 * D3 mutates DOM imperatively, so we render then inspect the SVG.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GraphView } from "./GraphView";
import type { GraphDTO } from "../api/rest";

const triangle: GraphDTO = {
  n_nodes: 3,
  edges: [
    [0, 1],
    [0, 2],
    [1, 2],
  ],
  node_positions: [
    { id: 0, x: 0, y: 0 },
    { id: 1, x: 10, y: 0 },
    { id: 2, x: 5, y: 9 },
  ],
};

const emptyGraph: GraphDTO = { n_nodes: 0, edges: [], node_positions: null };
const isolatedNodes: GraphDTO = {
  n_nodes: 4,
  edges: [],
  node_positions: null,
};

describe("GraphView", () => {
  it("renders an SVG for a normal triangle (geometric mode)", () => {
    const { container } = render(
      <GraphView graph={triangle} mode="geometric" width={300} height={300} caption="K3" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // 3 nodes => at least 3 <circle> elements (one per node; geometric mode may add more for radius rings)
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(3);
    // 3 edges => 3 <line>s
    expect(container.querySelectorAll("line").length).toBe(3);
    // Caption visible
    expect(screen.getByText("K3")).toBeInTheDocument();
  });

  it("renders without crashing for an empty graph (n=0)", () => {
    const { container } = render(<GraphView graph={emptyGraph} mode="force" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll("line").length).toBe(0);
  });

  it("renders disconnected nodes when there are no edges", () => {
    const { container } = render(<GraphView graph={isolatedNodes} mode="force" />);
    expect(container.querySelectorAll("line").length).toBe(0);
    // 4 node circles
    const nodeGroup = container.querySelector("g.nodes");
    expect(nodeGroup?.querySelectorAll("circle").length).toBe(4);
  });

  it("renders comm-radius rings in geometric mode when commRadius is given", () => {
    const { container } = render(
      <GraphView graph={triangle} mode="geometric" commRadius={4} width={300} height={300} />,
    );
    // Now there should be 3 (radius rings) + 3 (nodes) circles
    expect(container.querySelectorAll("circle").length).toBeGreaterThanOrEqual(6);
  });

  it("highlights nodes whose ids appear in `highlight`", () => {
    const { container } = render(
      <GraphView
        graph={triangle}
        mode="geometric"
        highlight={new Set([0, 2])}
        width={300}
        height={300}
      />,
    );
    // Highlighted nodes should have larger radius (10 vs 7) — count them.
    const nodeGroup = container.querySelector("g.nodes");
    const circles = Array.from(nodeGroup!.querySelectorAll("circle"));
    const highlighted = circles.filter((c) => c.getAttribute("r") === "10");
    expect(highlighted.length).toBe(2);
  });

  it("uses the LTR wrapper so RTL parent does not flip axes", () => {
    const { container } = render(<GraphView graph={triangle} mode="geometric" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.getAttribute("dir")).toBe("ltr");
  });

  it("renders node id labels", () => {
    const { container } = render(<GraphView graph={triangle} mode="geometric" />);
    const texts = Array.from(container.querySelectorAll("text"))
      .map((t) => t.textContent)
      .filter(Boolean);
    expect(texts).toContain("0");
    expect(texts).toContain("1");
    expect(texts).toContain("2");
  });

  it("invokes onNodeClick when a node circle is clicked", () => {
    const handler = vi.fn();
    const { container } = render(
      <GraphView graph={triangle} mode="geometric" onNodeClick={handler} />,
    );
    const nodeCircles = container.querySelectorAll("g.nodes circle");
    expect(nodeCircles.length).toBe(3);
    fireEvent.click(nodeCircles[1]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it("emphasises edges incident to the selectedNode", () => {
    const { container } = render(
      <GraphView graph={triangle} mode="geometric" selectedNode={0} />,
    );
    const lines = Array.from(container.querySelectorAll("line"));
    // Edges (0,1) and (0,2) are incident → wider stroke than (1,2).
    const incident = lines.filter((l) => Number(l.getAttribute("stroke-width")) >= 3);
    const nonIncident = lines.filter((l) => Number(l.getAttribute("stroke-width")) < 3);
    expect(incident.length).toBe(2);
    expect(nonIncident.length).toBe(1);
  });

  it("renders the stats badge with n, m and density when showStatsBadge=true", () => {
    render(
      <GraphView graph={triangle} mode="geometric" showStatsBadge width={300} height={300} />,
    );
    // n=3, m=3, density = 3 / (3*2/2) = 1.0
    expect(screen.getByText(/n=3/)).toBeInTheDocument();
    expect(screen.getByText(/density=1\.00/)).toBeInTheDocument();
  });

  it("colours the highlight set with the override colour", () => {
    const { container } = render(
      <GraphView
        graph={triangle}
        mode="geometric"
        highlight={new Set([0])}
        highlightColor="#10b981"
      />,
    );
    const nodeCircles = Array.from(container.querySelectorAll("g.nodes circle"));
    // The highlighted node should carry the override fill.
    const highlighted = nodeCircles.find((c) => c.getAttribute("r") === "10");
    expect(highlighted).toBeDefined();
    expect(highlighted!.getAttribute("fill")).toBe("#10b981");
  });
});
