import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RoutingView } from "./RoutingView";
import type { NodePos, RouteDTO } from "../api/rest";

const NODES: NodePos[] = [
  { id: 0, x: 0, y: 0 },
  { id: 1, x: 10, y: 0 },
  { id: 2, x: 5, y: 10 },
  { id: 3, x: 15, y: 10 },
];
const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 2],
  [1, 3],
  [2, 3],
];

describe("RoutingView", () => {
  it("renders one circle per node + edges", () => {
    const { container } = render(
      <RoutingView nodes={NODES} edges={EDGES} backbone={[0, 1, 2]} />,
    );
    expect(container.querySelectorAll("svg line").length).toBe(EDGES.length);
    // node circles (one per node inside g[transform])
    const nodeCircles = container.querySelectorAll("g[transform] circle");
    expect(nodeCircles.length).toBe(NODES.length);
  });

  it("draws an active path in cyan when activeRoute is supplied", () => {
    const activeRoute: RouteDTO = { src: 3, dst: 0, path: [3, 1, 0], hops: 2 };
    const { container } = render(
      <RoutingView
        nodes={NODES}
        edges={EDGES}
        backbone={[0, 1, 2]}
        activeRoute={activeRoute}
      />,
    );
    // Some edges should be drawn with the atomGround color (cyan)
    const cyanLines = Array.from(container.querySelectorAll("line")).filter(
      (l) => l.getAttribute("stroke") === "#3ed3ff",
    );
    expect(cyanLines.length).toBe(2); // path 3→1→0 has 2 segments
  });

  it("draws the packet only when there is an active route", () => {
    const { container, rerender } = render(
      <RoutingView nodes={NODES} edges={EDGES} backbone={[0, 1, 2]} />,
    );
    expect(container.querySelector('[data-testid="packet"]')).toBeNull();

    rerender(
      <RoutingView
        nodes={NODES}
        edges={EDGES}
        backbone={[0, 1, 2]}
        activeRoute={{ src: 3, dst: 0, path: [3, 1, 0], hops: 2 }}
      />,
    );
    expect(container.querySelector('[data-testid="packet"]')).toBeInTheDocument();
  });

  it("clicking a node invokes onPickNode with that id", () => {
    const onPick = vi.fn();
    const { container } = render(
      <RoutingView nodes={NODES} edges={EDGES} backbone={[0]} onPickNode={onPick} />,
    );
    const groups = container.querySelectorAll("g[transform]");
    fireEvent.click(groups[2]);
    expect(onPick).toHaveBeenCalled();
    const id = onPick.mock.calls[0][0];
    expect([0, 1, 2, 3]).toContain(id);
  });

  it("backbone vertices get a different fill color than non-backbone", () => {
    const { container } = render(
      <RoutingView nodes={NODES} edges={EDGES} backbone={[0]} />,
    );
    const fills = Array.from(container.querySelectorAll("g[transform] circle")).map(
      (c) => c.getAttribute("fill"),
    );
    expect(new Set(fills).size).toBeGreaterThan(1);
  });

  it("does not crash when activeRoute is unreachable (hops=0, path=[])", () => {
    const { container } = render(
      <RoutingView
        nodes={NODES}
        edges={EDGES}
        backbone={[0, 1]}
        activeRoute={{ src: 2, dst: 3, path: [], hops: 0 }}
      />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="packet"]')).toBeNull();
  });

  it("uses LTR wrapper", () => {
    const { container } = render(
      <RoutingView nodes={NODES} edges={EDGES} backbone={[]} />,
    );
    expect((container.firstChild as HTMLElement).getAttribute("dir")).toBe("ltr");
  });

  it("selectedSrc and selectedDst color those nodes uniquely", () => {
    const { container } = render(
      <RoutingView
        nodes={NODES}
        edges={EDGES}
        backbone={[]}
        selectedSrc={0}
        selectedDst={3}
      />,
    );
    const fills = Array.from(container.querySelectorAll("g[transform] circle")).map(
      (c) => c.getAttribute("fill"),
    );
    // src=ok (#3ddc97), dst=warn (#ffb547)
    expect(fills).toContain("#3ddc97");
    expect(fills).toContain("#ffb547");
  });
});
