/**
 * D3 force-directed graph view with smooth animated transitions.
 *
 * When `mode="geometric"`, node positions are fixed to the (x,y) supplied by
 * the MANET generator (so the comm-radius geometry is faithful). When
 * `mode="force"`, D3's force layout runs and nodes settle naturally — used
 * for the complement graph where geometry has no physical meaning.
 *
 * Highlighted vertices (in `highlight`) get a glowing halo + bold stroke.
 */

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { palette } from "../theme/palette";
import type { GraphDTO } from "../api/rest";

interface Props {
  graph: GraphDTO;
  width?: number;
  height?: number;
  mode?: "geometric" | "force";
  highlight?: Set<number>;
  /** When given (only for geometric MANET), draws a translucent comm-radius ring per node. */
  commRadius?: number;
  /** Caption shown in the top-left of the SVG. */
  caption?: string;
  /** When true, edges that go between two highlighted nodes are drawn extra-bright (clique edges). */
  emphasizeHighlightedEdges?: boolean;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: number;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink {
  source: number;
  target: number;
}

export function GraphView({
  graph,
  width = 560,
  height = 500,
  mode = "force",
  highlight,
  commRadius,
  caption,
  emphasizeHighlightedEdges = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const padding = 40;
    const innerW = width - 2 * padding;
    const innerH = height - 2 * padding;

    // Background grid
    svg
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", height)
      .attr("fill", palette.bgInset);

    // Defs: glow filter for highlighted nodes
    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "node-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("stdDeviation", 3).attr("result", "blur");
    const feMerge = glow.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "blur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Build nodes
    const nodes: SimNode[] = graph.node_positions
      ? graph.node_positions.map((p) => ({ id: p.id, x: p.x, y: p.y }))
      : Array.from({ length: graph.n_nodes }, (_, i) => ({
          id: i,
          x: width / 2 + Math.cos((2 * Math.PI * i) / graph.n_nodes) * 80,
          y: height / 2 + Math.sin((2 * Math.PI * i) / graph.n_nodes) * 80,
        }));

    const links: SimLink[] = graph.edges.map(([s, t]) => ({ source: s, target: t }));

    // Position scaling for geometric mode
    let xScale: (v: number) => number;
    let yScale: (v: number) => number;
    if (mode === "geometric" && graph.node_positions && graph.node_positions.length > 0) {
      const xs = graph.node_positions.map((p) => p.x);
      const ys = graph.node_positions.map((p) => p.y);
      const xExt: [number, number] = [Math.min(...xs), Math.max(...xs)];
      const yExt: [number, number] = [Math.min(...ys), Math.max(...ys)];
      const sx = d3.scaleLinear().domain(xExt).range([padding, width - padding]);
      const sy = d3.scaleLinear().domain(yExt).range([height - padding, padding]);
      xScale = (v) => sx(v);
      yScale = (v) => sy(v);
      for (const n of nodes) {
        n.fx = xScale(n.x);
        n.fy = yScale(n.y);
      }
    } else {
      xScale = (v) => v;
      yScale = (v) => v;
    }

    // comm-radius rings (geometric only)
    let radiusGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
    if (mode === "geometric" && commRadius && graph.node_positions) {
      const xs = graph.node_positions.map((p) => p.x);
      const ys = graph.node_positions.map((p) => p.y);
      const xExtent = Math.max(...xs) - Math.min(...xs);
      const yExtent = Math.max(...ys) - Math.min(...ys);
      const scaleFactor = Math.min(innerW / xExtent, innerH / yExtent);
      radiusGroup = svg.append("g").attr("opacity", 0.08);
      radiusGroup
        .selectAll("circle")
        .data(nodes)
        .enter()
        .append("circle")
        .attr("cx", (d) => xScale(d.x))
        .attr("cy", (d) => yScale(d.y))
        .attr("r", commRadius * scaleFactor)
        .attr("fill", palette.queraPurpleGlow)
        .attr("stroke", palette.queraPurple)
        .attr("stroke-width", 1);
    }

    // Links
    const linkSel = svg
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke-linecap", "round")
      .attr("stroke", (d) => {
        if (
          emphasizeHighlightedEdges &&
          highlight &&
          highlight.has(d.source) &&
          highlight.has(d.target)
        ) {
          return palette.queraPurpleGlow;
        }
        return palette.textMuted;
      })
      .attr("stroke-opacity", (d) => {
        if (
          emphasizeHighlightedEdges &&
          highlight &&
          highlight.has(d.source) &&
          highlight.has(d.target)
        )
          return 0.95;
        return 0.45;
      })
      .attr("stroke-width", (d) => {
        if (
          emphasizeHighlightedEdges &&
          highlight &&
          highlight.has(d.source) &&
          highlight.has(d.target)
        )
          return 2.5;
        return 1.2;
      });

    // Nodes
    const nodeSel = svg
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g");

    nodeSel
      .append("circle")
      .attr("r", (d) => (highlight && highlight.has(d.id) ? 10 : 7))
      .attr("fill", (d) =>
        highlight && highlight.has(d.id) ? palette.queraPurpleGlow : palette.atomGround,
      )
      .attr("stroke", (d) =>
        highlight && highlight.has(d.id) ? "#fff" : palette.queraPurpleSoft,
      )
      .attr("stroke-width", (d) => (highlight && highlight.has(d.id) ? 2 : 1))
      .attr("filter", (d) => (highlight && highlight.has(d.id) ? "url(#node-glow)" : null));

    nodeSel
      .append("text")
      .text((d) => String(d.id))
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .attr("font-size", 10)
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("fill", "#fff")
      .attr("pointer-events", "none");

    // Caption
    if (caption) {
      svg
        .append("text")
        .text(caption)
        .attr("x", 12)
        .attr("y", 22)
        .attr("font-size", 12)
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("fill", palette.textSecondary);
    }

    // Force simulation (force mode)
    if (mode === "force") {
      const linkData = links as unknown as d3.SimulationLinkDatum<SimNode>[];
      const sim = d3
        .forceSimulation<SimNode>(nodes)
        .force(
          "link",
          d3
            .forceLink<SimNode, d3.SimulationLinkDatum<SimNode>>(linkData)
            .id((d) => d.id)
            .distance(70)
            .strength(0.7),
        )
        .force("charge", d3.forceManyBody<SimNode>().strength(-220))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide<SimNode>().radius(16))
        .on("tick", () => {
          linkSel
            .attr("x1", (d) => (d.source as unknown as SimNode).x ?? 0)
            .attr("y1", (d) => (d.source as unknown as SimNode).y ?? 0)
            .attr("x2", (d) => (d.target as unknown as SimNode).x ?? 0)
            .attr("y2", (d) => (d.target as unknown as SimNode).y ?? 0);
          nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
        });
      simRef.current = sim;
    } else {
      // Geometric: position once, no simulation
      linkSel
        .attr("x1", (d) => xScale(nodes[d.source].x))
        .attr("y1", (d) => yScale(nodes[d.source].y))
        .attr("x2", (d) => xScale(nodes[d.target].x))
        .attr("y2", (d) => yScale(nodes[d.target].y));
      nodeSel.attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`);
    }

    return () => {
      simRef.current?.stop();
      simRef.current = null;
    };
  }, [graph, width, height, mode, highlight, commRadius, caption, emphasizeHighlightedEdges]);

  return (
    <div dir="ltr" style={{ display: "inline-block" }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{
          borderRadius: 12,
          border: `1px solid ${palette.queraPurpleSoft}`,
          display: "block",
        }}
      />
    </div>
  );
}
