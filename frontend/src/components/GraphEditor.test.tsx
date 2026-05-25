import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GraphEditor, __testing } from "./GraphEditor";
import type { MANETResponse } from "../api/rest";

const { umToPx } = __testing;

function svgLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("svg text"))
    .map((t) => t.textContent ?? "")
    .filter(Boolean);
}

function stubBoundingRect(svg: SVGSVGElement) {
  svg.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1080,
      bottom: 1080,
      width: 1080,
      height: 1080,
      toJSON: () => ({}),
    } as DOMRect);
}

function clickAtUm(svg: SVGSVGElement, ux: number, uy: number) {
  const { px, py } = umToPx(ux, uy);
  fireEvent.click(svg, { clientX: px, clientY: py });
}

function clickNode(container: HTMLElement, id: number) {
  const groups = container.querySelectorAll("g.nodes-fake, g > g");
  void groups;
  const label = Array.from(container.querySelectorAll("text")).find(
    (t) => t.textContent === String(id),
  );
  expect(label).toBeTruthy();
  const group = label!.parentElement as unknown as SVGGElement | null;
  expect(group).toBeTruthy();
  fireEvent.click(group!);
}

describe("GraphEditor", () => {
  it("adds nodes when the canvas is clicked in addNode mode", () => {
    const onSave = vi.fn();
    const { container } = render(<GraphEditor onSave={onSave} onCancel={() => {}} />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    stubBoundingRect(svg);

    clickAtUm(svg, 20, 20);
    clickAtUm(svg, 80, 80);

    expect(svgLabels(container)).toEqual(expect.arrayContaining(["0", "1"]));
  });

  it("creates an edge when two nodes are clicked in addEdge mode", () => {
    const onSave = vi.fn();
    const { container } = render(<GraphEditor onSave={onSave} onCancel={() => {}} />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    stubBoundingRect(svg);

    clickAtUm(svg, 20, 20);
    clickAtUm(svg, 80, 80);

    fireEvent.click(screen.getByRole("button", { name: /קשת/ }));

    const linesBefore = container.querySelectorAll("g line").length;
    clickNode(container, 0);
    clickNode(container, 1);
    const linesAfter = container.querySelectorAll("g line").length;
    expect(linesAfter).toBeGreaterThan(linesBefore);
  });

  it("auto-connect creates edges between nodes within commRadius", () => {
    const onSave = vi.fn();
    const { container } = render(<GraphEditor onSave={onSave} onCancel={() => {}} />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    stubBoundingRect(svg);

    clickAtUm(svg, 20, 50);
    clickAtUm(svg, 50, 50);
    clickAtUm(svg, 80, 50);

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "30" } });

    fireEvent.click(screen.getByRole("button", { name: /חבר אוטומטית/ }));

    // Edge lines use palette.textMuted (#5d6885); grid lines use a different
    // color and the transparent hitbox uses "transparent".
    const edgeLines = Array.from(container.querySelectorAll("line")).filter(
      (l) => l.getAttribute("stroke") === "#5d6885",
    );
    expect(edgeLines.length).toBe(2);
  });

  it("save flow calls onSave with a MANETResponse-shaped payload", () => {
    const onSave = vi.fn();
    const { container } = render(<GraphEditor onSave={onSave} onCancel={() => {}} />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    stubBoundingRect(svg);

    clickAtUm(svg, 20, 50);
    clickAtUm(svg, 80, 50);

    fireEvent.click(screen.getByRole("button", { name: /^שמור/ }));

    const nameInput = screen.getByPlaceholderText(/רשת משולשת/) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "My Pair" } });

    const dialogSaveBtn = Array.from(
      document.querySelectorAll('div[role="dialog"] button'),
    ).find((b) => b.textContent === "שמור") as HTMLButtonElement;
    fireEvent.click(dialogSaveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    const [payload, name] = onSave.mock.calls[0] as [MANETResponse, string, string];
    expect(name).toBe("My Pair");
    expect(payload.graph.n_nodes).toBe(2);
    expect(payload.graph.node_positions?.map((p) => p.id)).toEqual([0, 1]);
    expect(payload.config.box_size).toBe(200);
  });

  it("blocks save and shows an alert when only one node is placed", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onSave = vi.fn();
    const { container } = render(<GraphEditor onSave={onSave} onCancel={() => {}} />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    stubBoundingRect(svg);

    clickAtUm(svg, 30, 30);
    fireEvent.click(screen.getByRole("button", { name: /^שמור/ }));

    expect(alertSpy).toHaveBeenCalled();
    expect(alertSpy.mock.calls[0][0]).toContain("לפחות 2");
    expect(onSave).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
