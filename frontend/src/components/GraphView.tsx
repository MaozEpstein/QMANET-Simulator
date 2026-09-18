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

import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { palette } from "../theme/palette";
import type { GraphDTO } from "../api/rest";
import { computeDegrees } from "../lib/graphMetrics";

interface Props {
  graph: GraphDTO;
  width?: number;
  height?: number;
  mode?: "geometric" | "force";
  highlight?: Set<number>;
  /** Custom color for the primary highlight set. Defaults to palette.highlight (amber). */
  highlightColor?: string;
  /** When given (only for geometric MANET), draws a translucent comm-radius ring per node. */
  commRadius?: number;
  /** Caption shown in the top-left of the SVG. */
  caption?: string;
  /** When true, edges that go between two highlighted nodes are drawn extra-bright (clique edges). */
  emphasizeHighlightedEdges?: boolean;
  /** Single node "focus": its edges are emphasised so the user sees its neighbourhood. */
  selectedNode?: number | null;
  /** Click handler; node id is passed. */
  onNodeClick?: (id: number) => void;
  /** When true, show "n=… m=… density=…" badge in the top-right. */
  showStatsBadge?: boolean;
  /**
   * When true, render each vertex's degree d_i as a small label above the
   * node circle (Karni 2026 Fig 1a style). Off by default so existing call
   * sites are unaffected. When `degreeEdges` is supplied, degree is computed
   * from that edge list instead of `graph.edges` — useful when this view
   * shows G̅ but we want the original G's degree shown on each atom.
   */
  showDegrees?: boolean;
  degreeEdges?: readonly (readonly [number, number])[];
  /**
   * Override the id label drawn inside each node circle. Used by the
   * conflict-graph track (Stage 2) to show a vertex's underlying MANET link
   * as "i–j" instead of an arbitrary index — a conflict-graph vertex *is* a
   * link, so it should read as one. Defaults to the bare numeric id.
   */
  nodeLabel?: (id: number) => string;
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
  highlightColor,
  commRadius,
  caption,
  emphasizeHighlightedEdges = false,
  selectedNode = null,
  onNodeClick,
  showStatsBadge = false,
  showDegrees = false,
  degreeEdges,
  nodeLabel,
}: Props) {
  const hiColor = highlightColor ?? palette.highlight;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);
  const degrees = useMemo(
    () => computeDegrees(graph.n_nodes, degreeEdges ?? graph.edges),
    [graph.n_nodes, graph.edges, degreeEdges],
  );

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
    const hasHighlight = !!highlight && highlight.size > 0;
    const isCliqueEdge = (d: SimLink) =>
      emphasizeHighlightedEdges &&
      !!highlight &&
      highlight.has(d.source) &&
      highlight.has(d.target);
    const isNeighbourEdge = (d: SimLink) =>
      selectedNode !== null &&
      selectedNode !== undefined &&
      (d.source === selectedNode || d.target === selectedNode);

    const linkSel = svg
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke-linecap", "round")
      .attr("stroke", (d) => {
        if (isNeighbourEdge(d)) return palette.warn;
        if (isCliqueEdge(d)) return hiColor;
        return palette.textPrimary;
      })
      .attr("stroke-opacity", (d) => {
        if (isNeighbourEdge(d)) return 1.0;
        if (isCliqueEdge(d)) return 0.95;
        // Dim non-neighbour edges when a node is selected so the focus reads cleanly.
        if (selectedNode !== null && selectedNode !== undefined) return 0.25;
        // Dim the rest of the graph when a highlight set is active — the eye
        // goes to what stays bright, which reads better than boosting the
        // highlighted set alone.
        if (hasHighlight) return 0.3;
        return 0.75;
      })
      .attr("stroke-width", (d) => {
        if (isNeighbourEdge(d)) return 3.2;
        if (isCliqueEdge(d)) return 2.8;
        return 1.8;
      });

    // Nodes
    const nodeSel = svg
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g");

    const isSelected = (id: number) =>
      selectedNode !== null && selectedNode !== undefined && id === selectedNode;
    const isHighlighted = (id: number) => !!highlight && highlight.has(id);

    // Thick outer ring on highlighted nodes — a shape cue on top of the color
    // cue, so the marking survives poor color discrimination.
    nodeSel
      .filter((d) => isHighlighted(d.id))
      .append("circle")
      .attr("r", 15)
      .attr("fill", "none")
      .attr("stroke", hiColor)
      .attr("stroke-width", 2.5)
      .attr("stroke-opacity", 0.9)
      .attr("pointer-events", "none");

    const baseR = 7;
    nodeSel
      .append("circle")
      .attr("r", (d) => (isSelected(d.id) ? baseR + 4 : isHighlighted(d.id) ? baseR + 3 : baseR))
      .attr("fill", (d) =>
        isSelected(d.id) ? palette.warn : isHighlighted(d.id) ? hiColor : palette.atomGround,
      )
      .attr("stroke", (d) =>
        isSelected(d.id) || isHighlighted(d.id) ? "#fff" : palette.queraPurpleSoft,
      )
      .attr("stroke-width", (d) => (isSelected(d.id) ? 2.5 : isHighlighted(d.id) ? 2 : 1))
      .attr("filter", (d) =>
        isSelected(d.id) || isHighlighted(d.id) ? "url(#node-glow)" : null,
      )
      .attr("opacity", (d) =>
        hasHighlight && !isHighlighted(d.id) && !isSelected(d.id) ? 0.45 : 1,
      )
      .style("cursor", onNodeClick ? "pointer" : "default")
      .on("click", (_event, d) => {
        if (onNodeClick) onNodeClick(d.id);
      });

    if (nodeLabel) {
      // A link label like "12–7" doesn't fit inside a 7px-radius node circle
      // legibly at any font size, so it's drawn *outside* the node instead —
      // same halo technique as the degree label below, just positioned
      // under the node so it doesn't collide with it. The circle stays
      // small and plain; the label carries all the identifying information.
      nodeSel
        .append("text")
        .text((d) => nodeLabel(d.id))
        .attr("text-anchor", "middle")
        .attr("dy", 22)
        .attr("font-size", 11.5)
        .attr("font-weight", 700)
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("fill", "#fff")
        .attr("stroke", palette.bgInset)
        .attr("stroke-width", 3.5)
        .attr("paint-order", "stroke")
        .attr("opacity", (d) =>
          hasHighlight && !isHighlighted(d.id) && !isSelected(d.id) ? 0.65 : 1,
        )
        .attr("pointer-events", "none");
    }

    if (!nodeLabel) {
      // White fill alone reads poorly against the light-cyan default node
      // color (and against warn/highlight fills too) — the dark stroke halo
      // keeps the id legible regardless of what's underneath it.
      nodeSel
        .append("text")
        .text((d) => String(d.id))
        .attr("text-anchor", "middle")
        .attr("dy", 4)
        .attr("font-size", 11)
        .attr("font-weight", 700)
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("fill", "#fff")
        .attr("stroke", palette.bgInset)
        .attr("stroke-width", 3)
        .attr("paint-order", "stroke")
        .attr("opacity", (d) =>
          hasHighlight && !isHighlighted(d.id) && !isSelected(d.id) ? 0.55 : 1,
        )
        .attr("pointer-events", "none");
    }

    if (showDegrees) {
      // Render degree d_i above the node, in queraPurpleGlow with a subtle
      // shadow stroke so it remains legible over both light edges and the
      // panel background. Matches Karni 2026 Fig 1(a) where vertices are
      // colour-coded by degree to motivate the LD-AQC schedule.
      nodeSel
        .append("text")
        .text((d) => `d=${degrees[d.id] ?? 0}`)
        .attr("text-anchor", "middle")
        .attr("dy", -14)
        .attr("font-size", 10)
        .attr("font-weight", 600)
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("fill", palette.queraPurpleGlow)
        .attr("stroke", palette.bgInset)
        .attr("stroke-width", 3)
        .attr("paint-order", "stroke")
        .attr("pointer-events", "none");
    }

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

    // Stats badge (top-right): n / m / density. Helps the user spot at a glance
    // that the complement has the inverse edge count of the original — sum is
    // always N(N-1)/2.
    if (showStatsBadge) {
      const n = graph.n_nodes;
      const m = graph.edges.length;
      const maxEdges = n > 1 ? (n * (n - 1)) / 2 : 0;
      const density = maxEdges > 0 ? m / maxEdges : 0;
      const lines = [
        `n=${n}  m=${m}`,
        `density=${density.toFixed(2)}`,
      ];
      const padX = 8;
      const padY = 6;
      const lineH = 14;
      const boxW = 116;
      const boxH = padY * 2 + lineH * lines.length;
      const x0 = width - boxW - 10;
      const y0 = 10;
      const g = svg.append("g");
      g.append("rect")
        .attr("x", x0)
        .attr("y", y0)
        .attr("width", boxW)
        .attr("height", boxH)
        .attr("rx", 6)
        .attr("ry", 6)
        .attr("fill", palette.bgPanel)
        .attr("stroke", palette.queraPurpleSoft)
        .attr("stroke-opacity", 0.6);
      lines.forEach((line, i) => {
        g.append("text")
          .text(line)
          .attr("x", x0 + padX)
          .attr("y", y0 + padY + lineH * (i + 1) - 4)
          .attr("font-size", 11)
          .attr("font-family", "JetBrains Mono, monospace")
          .attr("fill", palette.textSecondary);
      });
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
  }, [
    graph,
    width,
    height,
    mode,
    highlight,
    hiColor,
    commRadius,
    caption,
    emphasizeHighlightedEdges,
    selectedNode,
    onNodeClick,
    showStatsBadge,
    showDegrees,
    degrees,
    nodeLabel,
  ]);

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
