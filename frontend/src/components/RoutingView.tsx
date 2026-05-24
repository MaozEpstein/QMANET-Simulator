/**
 * MANET routing visualization.
 *
 * Draws the MANET graph (geometric layout from the snapshot) with:
 *   - All edges in muted gray
 *   - Backbone vertices glowing purple, with backbone edges drawn bolder
 *   - Optional active route highlighted in cyan
 *   - Optional animated "packet" — a glowing dot interpolating between
 *     consecutive nodes along the active path
 */

import { useEffect, useState } from "react";
import { palette } from "../theme/palette";
import type { NodePos, RouteDTO } from "../api/rest";

interface Props {
  nodes: NodePos[];
  edges: [number, number][];
  backbone: number[];
  /** When given, draws this route in cyan and animates a packet along it. */
  activeRoute?: RouteDTO;
  width?: number;
  height?: number;
  /** Source/destination annotations for picker UX. */
  selectedSrc?: number;
  selectedDst?: number;
  onPickNode?: (id: number) => void;
}

const PACKET_SPEED_HOPS_PER_SEC = 1.2;

export function RoutingView({
  nodes,
  edges,
  backbone,
  activeRoute,
  width = 620,
  height = 520,
  selectedSrc,
  selectedDst,
  onPickNode,
}: Props) {
  const padding = 30;
  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;

  const backboneSet = new Set(backbone);

  // Compute a stable [0, 1] mapping over the node positions
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;

  const toX = (n: NodePos) => padding + ((n.x - minX) / dx) * innerW;
  const toY = (n: NodePos) => padding + (1 - (n.y - minY) / dy) * innerH;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const backboneEdges = new Set<string>();
  for (const [u, v] of edges) {
    if (backboneSet.has(u) && backboneSet.has(v)) {
      backboneEdges.add(`${Math.min(u, v)}-${Math.max(u, v)}`);
    }
  }
  const activePathEdges = new Set<string>();
  if (activeRoute) {
    for (let i = 0; i < activeRoute.path.length - 1; i++) {
      const a = activeRoute.path[i];
      const b = activeRoute.path[i + 1];
      activePathEdges.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
    }
  }

  // Packet position: linearly interpolated along the active path
  const [packetT, setPacketT] = useState(0);
  useEffect(() => {
    setPacketT(0);
    if (!activeRoute || activeRoute.hops === 0) return;
    const start = performance.now();
    const durationMs = (activeRoute.hops / PACKET_SPEED_HOPS_PER_SEC) * 1000;
    let raf = 0;
    const step = () => {
      const elapsed = (performance.now() - start) / durationMs;
      const t = elapsed % 1;
      setPacketT(t);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [activeRoute]);

  let packetPos: { x: number; y: number } | null = null;
  if (activeRoute && activeRoute.path.length >= 2) {
    const total = activeRoute.hops;
    const tt = packetT * total;
    const seg = Math.min(Math.floor(tt), total - 1);
    const local = tt - seg;
    const a = nodeById.get(activeRoute.path[seg]);
    const b = nodeById.get(activeRoute.path[seg + 1]);
    if (a && b) {
      packetPos = {
        x: toX(a) + (toX(b) - toX(a)) * local,
        y: toY(a) + (toY(b) - toY(a)) * local,
      };
    }
  }

  return (
    <div dir="ltr" style={{ display: "inline-block" }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="MANET routing view"
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
        }}
      >
        <defs>
          <filter id="packet-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* All edges (muted) */}
        {edges.map(([u, v], i) => {
          const a = nodeById.get(u);
          const b = nodeById.get(v);
          if (!a || !b) return null;
          const key = `${Math.min(u, v)}-${Math.max(u, v)}`;
          const isBack = backboneEdges.has(key);
          const isActive = activePathEdges.has(key);
          return (
            <line
              key={`e-${i}`}
              x1={toX(a)}
              y1={toY(a)}
              x2={toX(b)}
              y2={toY(b)}
              stroke={
                isActive
                  ? palette.atomGround
                  : isBack
                    ? palette.queraPurpleGlow
                    : palette.textMuted
              }
              strokeOpacity={isActive ? 0.95 : isBack ? 0.85 : 0.3}
              strokeWidth={isActive ? 3 : isBack ? 2.2 : 0.9}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const isBack = backboneSet.has(n.id);
          const isSrc = selectedSrc === n.id;
          const isDst = selectedDst === n.id;
          const onPath = activeRoute?.path.includes(n.id);
          const r = isSrc || isDst ? 10 : isBack || onPath ? 8 : 6;
          const fill = isSrc
            ? palette.ok
            : isDst
              ? palette.warn
              : isBack
                ? palette.queraPurpleGlow
                : onPath
                  ? palette.atomGround
                  : palette.queraPurple;
          return (
            <g
              key={`n-${n.id}`}
              transform={`translate(${toX(n)}, ${toY(n)})`}
              onClick={() => onPickNode?.(n.id)}
              style={{ cursor: onPickNode ? "pointer" : "default" }}
            >
              <circle
                r={r}
                fill={fill}
                stroke="#fff"
                strokeOpacity={0.85}
                strokeWidth={isSrc || isDst ? 2 : 1}
                filter={isBack || isSrc || isDst ? "url(#packet-glow)" : undefined}
              />
              <text
                fontSize={9}
                fill="#fff"
                textAnchor="middle"
                dy={3}
                style={{ fontFamily: "JetBrains Mono, monospace", pointerEvents: "none" }}
              >
                {n.id}
              </text>
            </g>
          );
        })}

        {/* Packet */}
        {packetPos && (
          <circle
            cx={packetPos.x}
            cy={packetPos.y}
            r={6}
            fill={palette.ok}
            filter="url(#packet-glow)"
            data-testid="packet"
          />
        )}
      </svg>
    </div>
  );
}
