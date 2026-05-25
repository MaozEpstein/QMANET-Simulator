import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MANETResponse, NodePos } from "../api/rest";
import {
  COLLISION_DISTANCE,
  SOFT_MAX_NODES,
  normalizeEdges,
  validateGraph,
  wouldCollideWithExisting,
} from "../lib/graphValidation";
import { PRESETS, type PresetSpec } from "../lib/graphPresets";
import {
  GRID_TYPES,
  computeGridGeometry,
  snapToGridPoint,
  type GridGeometry,
  type GridType,
} from "../lib/gridGeometry";
import { palette } from "../theme/palette";

const BOX_UM = 100;
const DEFAULT_COMM_RADIUS = 35;
const COMM_RADIUS_MIN = 1;
const COMM_RADIUS_MAX = 60;
const CANVAS_PX = 1080;
const PADDING_PX = 24;
const NODE_RADIUS_PX = 8;
const EDGE_HITBOX_PX = 6;
const DEFAULT_GRID_STEP = 10;
const GRID_STEP_MIN = 1;
const GRID_STEP_MAX = 25;

type Tool = "move" | "addNode" | "addEdge" | "delete";

interface DragState {
  id: number;
  startUx: number;
  startUy: number;
}

interface Props {
  onSave: (payload: MANETResponse, name: string, description: string) => void;
  onCancel: () => void;
}

const SCALE = (CANVAS_PX - 2 * PADDING_PX) / BOX_UM;

function umToPx(ux: number, uy: number): { px: number; py: number } {
  return {
    px: PADDING_PX + ux * SCALE,
    py: CANVAS_PX - PADDING_PX - uy * SCALE,
  };
}

function pxToUm(px: number, py: number): { ux: number; uy: number } {
  return {
    ux: (px - PADDING_PX) / SCALE,
    uy: (CANVAS_PX - PADDING_PX - py) / SCALE,
  };
}

function clampUm(v: number): number {
  return Math.max(0, Math.min(BOX_UM, v));
}

function lowestFreeId(nodes: NodePos[]): number {
  const used = new Set(nodes.map((n) => n.id));
  let id = 0;
  while (used.has(id)) id++;
  return id;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return distance(px, py, ax + t * dx, ay + t * dy);
}

export function GraphEditor({ onSave, onCancel }: Props) {
  const [tool, setTool] = useState<Tool>("addNode");
  const [nodes, setNodes] = useState<NodePos[]>([]);
  const [edges, setEdges] = useState<[number, number][]>([]);
  const [commRadius, setCommRadius] = useState(DEFAULT_COMM_RADIUS);
  const [showCommRadius, setShowCommRadius] = useState(true);
  const [gridStep, setGridStep] = useState(DEFAULT_GRID_STEP);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridType, setGridType] = useState<GridType>("square");
  const [gridMenuOpen, setGridMenuOpen] = useState(false);

  const gridGeometry = useMemo<GridGeometry>(
    () => computeGridGeometry(gridType, gridStep, BOX_UM),
    [gridType, gridStep],
  );
  const [pendingEdgeStart, setPendingEdgeStart] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverNode, setHoverNode] = useState<number | null>(null);
  const [transientMsg, setTransientMsg] = useState<string | null>(null);

  const [presetMenuOpen, setPresetMenuOpen] = useState(false);

  const [saveDialog, setSaveDialog] = useState<
    | null
    | { stage: "form"; warnings: string[] }
    | { stage: "confirmWarnings"; warnings: string[]; name: string; description: string }
  >(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const historyRef = useRef<{ nodes: NodePos[]; edges: [number, number][] }[]>([]);

  const pushHistory = useCallback(() => {
    historyRef.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    if (historyRef.current.length > 100) historyRef.current.shift();
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) {
      setTransientMsg("אין עוד פעולה לבטל.");
      setTimeout(() => setTransientMsg((m) => (m === "אין עוד פעולה לבטל." ? null : m)), 1200);
      return;
    }
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setPendingEdgeStart(null);
    setDrag(null);
    setTransientMsg("בוטל");
    setTimeout(() => setTransientMsg((m) => (m === "בוטל" ? null : m)), 1000);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;
      if (e.key !== "z" && e.key !== "Z") return;
      if (e.shiftKey) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const isDirty = nodes.length > 0 || edges.length > 0;

  const flash = useCallback((msg: string) => {
    setTransientMsg(msg);
    setTimeout(() => setTransientMsg((m) => (m === msg ? null : m)), 1800);
  }, []);

  const getMouseUm = useCallback((evt: React.MouseEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const py = evt.clientY - rect.top;
    return pxToUm(px, py);
  }, []);

  const addNodeAt = useCallback(
    (ux: number, uy: number) => {
      const snapped = snapToGrid
        ? snapToGridPoint(ux, uy, gridGeometry, gridStep)
        : { x: ux, y: uy };
      const x = clampUm(snapped.x);
      const y = clampUm(snapped.y);
      if (wouldCollideWithExisting(nodes, x, y)) {
        flash("לא ניתן להניח קודקוד על קודקוד קיים.");
        return;
      }
      pushHistory();
      setNodes((prev) => [...prev, { id: lowestFreeId(prev), x, y }]);
    },
    [nodes, flash, gridGeometry, gridStep, snapToGrid, pushHistory],
  );

  const deleteNode = useCallback(
    (id: number) => {
      pushHistory();
      setNodes((prev) => prev.filter((n) => n.id !== id));
      setEdges((prev) => prev.filter(([a, b]) => a !== id && b !== id));
      setPendingEdgeStart((prev) => (prev === id ? null : prev));
    },
    [pushHistory],
  );

  const deleteEdge = useCallback(
    (a: number, b: number) => {
      pushHistory();
      setEdges((prev) =>
        prev.filter(
          ([x, y]) => !((x === a && y === b) || (x === b && y === a)),
        ),
      );
    },
    [pushHistory],
  );

  const addEdgeIfNew = useCallback(
    (a: number, b: number) => {
      if (a === b) return false;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const exists = edgesRef.current.some(
        ([x, y]) => Math.min(x, y) === lo && Math.max(x, y) === hi,
      );
      if (exists) return false;
      pushHistory();
      setEdges((prev) => [...prev, [lo, hi]]);
      return true;
    },
    [pushHistory],
  );

  const handleNodeClick = useCallback(
    (id: number) => {
      if (tool === "addEdge") {
        if (pendingEdgeStart === null) {
          setPendingEdgeStart(id);
        } else if (pendingEdgeStart === id) {
          setPendingEdgeStart(null);
        } else {
          const ok = addEdgeIfNew(pendingEdgeStart, id);
          if (!ok) flash("הקשת כבר קיימת.");
          setPendingEdgeStart(null);
        }
      } else if (tool === "delete") {
        deleteNode(id);
      }
    },
    [tool, pendingEdgeStart, addEdgeIfNew, deleteNode, flash],
  );

  const handleBackgroundClick = useCallback(
    (evt: React.MouseEvent<SVGElement>) => {
      if (tool !== "addNode") return;
      const coord = getMouseUm(evt);
      if (!coord) return;
      addNodeAt(coord.ux, coord.uy);
    },
    [tool, getMouseUm, addNodeAt],
  );

  const handleEdgeClick = useCallback(
    (a: number, b: number, evt: React.MouseEvent) => {
      if (tool !== "delete") return;
      evt.stopPropagation();
      deleteEdge(a, b);
    },
    [tool, deleteEdge],
  );

  const handleNodeMouseDown = useCallback(
    (id: number, evt: React.MouseEvent<SVGElement>) => {
      if (tool !== "move") return;
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      evt.preventDefault();
      pushHistory();
      setDrag({ id, startUx: node.x, startUy: node.y });
    },
    [tool, nodes, pushHistory],
  );

  const handleSvgMouseMove = useCallback(
    (evt: React.MouseEvent<SVGElement>) => {
      if (!drag) return;
      const coord = getMouseUm(evt);
      if (!coord) return;
      const snapped = snapToGrid
        ? snapToGridPoint(coord.ux, coord.uy, gridGeometry, gridStep)
        : { x: coord.ux, y: coord.uy };
      const x = clampUm(snapped.x);
      const y = clampUm(snapped.y);
      setNodes((prev) =>
        prev.map((n) => (n.id === drag.id ? { ...n, x, y } : n)),
      );
    },
    [drag, getMouseUm, gridGeometry, gridStep, snapToGrid],
  );

  const handleSvgMouseUp = useCallback(() => {
    if (!drag) return;
    setNodes((prev) => {
      const moved = prev.find((n) => n.id === drag.id);
      if (!moved) return prev;
      const colliding = prev.some(
        (n) => n.id !== drag.id && distance(n.x, n.y, moved.x, moved.y) < COLLISION_DISTANCE,
      );
      if (colliding) {
        flash("הקודקודים קרובים מדי — חזרה למיקום הקודם.");
        return prev.map((n) =>
          n.id === drag.id ? { ...n, x: drag.startUx, y: drag.startUy } : n,
        );
      }
      return prev;
    });
    setDrag(null);
  }, [drag, flash]);

  const autoConnect = useCallback(() => {
    const present = new Set(
      edgesRef.current.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`),
    );
    const additions: [number, number][] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (distance(a.x, a.y, b.x, b.y) <= commRadius) {
          const lo = Math.min(a.id, b.id);
          const hi = Math.max(a.id, b.id);
          const key = `${lo}-${hi}`;
          if (!present.has(key)) {
            present.add(key);
            additions.push([lo, hi]);
          }
        }
      }
    }
    if (additions.length === 0) {
      flash("אין קשתות חדשות להוסיף.");
      return;
    }
    pushHistory();
    setEdges((prev) => [...prev, ...additions]);
    flash(`נוספו ${additions.length} קשתות.`);
  }, [nodes, commRadius, flash, pushHistory]);

  const applyPreset = useCallback(
    (spec: PresetSpec, param: number) => {
      if (isDirty && !window.confirm(`לטעון את "${spec.name}"? הגרף הנוכחי יוחלף.`)) return;
      const result = spec.build(param);
      pushHistory();
      setNodes(result.positions);
      setEdges(normalizeEdges(result.edges));
      setPendingEdgeStart(null);
      setPresetMenuOpen(false);
      flash(`נטענה תבנית: ${spec.name}`);
    },
    [isDirty, flash, pushHistory],
  );

  const clearAll = useCallback(() => {
    if (!isDirty) return;
    if (!window.confirm("לנקות את כל הקודקודים והקשתות?")) return;
    pushHistory();
    setNodes([]);
    setEdges([]);
    setPendingEdgeStart(null);
  }, [isDirty, pushHistory]);

  const buildPayload = useCallback((): MANETResponse => {
    const idToIndex = new Map<number, number>();
    nodes.forEach((n, i) => idToIndex.set(n.id, i));
    const positions: NodePos[] = nodes.map((n, i) => ({ id: i, x: n.x, y: n.y }));
    const remappedEdges = normalizeEdges(
      edges
        .map<[number, number] | null>(([a, b]) => {
          const ai = idToIndex.get(a);
          const bi = idToIndex.get(b);
          if (ai === undefined || bi === undefined) return null;
          return [ai, bi];
        })
        .filter((e): e is [number, number] => e !== null),
    );
    return {
      graph: {
        n_nodes: nodes.length,
        edges: remappedEdges,
        node_positions: positions,
      },
      config: {
        n_nodes: nodes.length,
        box_size: BOX_UM,
        comm_radius: commRadius,
        seed: null,
      },
    };
  }, [nodes, edges, commRadius]);

  const tryOpenSave = useCallback(() => {
    const payload = buildPayload();
    const result = validateGraph(payload.graph);
    if (!result.ok) {
      window.alert(result.errors.join("\n"));
      return;
    }
    setSaveDialog({ stage: "form", warnings: result.warnings });
  }, [buildPayload]);

  const confirmSave = useCallback(() => {
    if (!saveDialog) return;
    if (saveDialog.stage === "form") {
      if (saveDialog.warnings.length > 0) {
        setSaveDialog({
          stage: "confirmWarnings",
          warnings: saveDialog.warnings,
          name,
          description,
        });
        return;
      }
      onSave(buildPayload(), name, description);
      setSaveDialog(null);
      return;
    }
    onSave(buildPayload(), saveDialog.name, saveDialog.description);
    setSaveDialog(null);
  }, [saveDialog, name, description, onSave, buildPayload]);

  const handleCancel = useCallback(() => {
    if (isDirty && !window.confirm("לצאת בלי לשמור? כל השינויים יאבדו.")) return;
    onCancel();
  }, [isDirty, onCancel]);

  const nodeById = useMemo(() => {
    const m = new Map<number, NodePos>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const pendingEdgeStartCoord = useMemo(() => {
    if (pendingEdgeStart === null) return null;
    const n = nodeById.get(pendingEdgeStart);
    if (!n) return null;
    return umToPx(n.x, n.y);
  }, [pendingEdgeStart, nodeById]);

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <Toolbar
            tool={tool}
            setTool={setTool}
            onOpenPresets={() => {
              setPresetMenuOpen((v) => !v);
              setGridMenuOpen(false);
            }}
            presetsOpen={presetMenuOpen}
            onOpenGridMenu={() => {
              setGridMenuOpen((v) => !v);
              setPresetMenuOpen(false);
            }}
            gridMenuOpen={gridMenuOpen}
            gridType={gridType}
          />
          {presetMenuOpen && (
            <PresetMenu onApply={applyPreset} onClose={() => setPresetMenuOpen(false)} />
          )}
          {gridMenuOpen && (
            <GridTypeMenu
              gridType={gridType}
              setGridType={(t) => {
                setGridType(t);
                setGridMenuOpen(false);
              }}
              onClose={() => setGridMenuOpen(false)}
            />
          )}
        </div>
        <div
          style={{
            position: "relative",
            width: CANVAS_PX,
            height: CANVAS_PX,
            borderRadius: 12,
            border: `1px solid ${palette.queraPurpleSoft}`,
            background: palette.bgInset,
            overflow: "hidden",
          }}
        >
          <svg
            ref={svgRef}
            width={CANVAS_PX}
            height={CANVAS_PX}
            style={{
              display: "block",
              cursor:
                tool === "addNode"
                  ? "crosshair"
                  : tool === "delete"
                    ? "not-allowed"
                    : tool === "addEdge"
                      ? "alias"
                      : "default",
            }}
            onClick={handleBackgroundClick}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={handleSvgMouseUp}
          >
            {showGrid && <GridLayer geometry={gridGeometry} />}
            <BoxOutline />
            {showCommRadius && <CommRadiusLayer nodes={nodes} commRadius={commRadius} />}
            <EdgesLayer
              edges={edges}
              nodeById={nodeById}
              hoverDelete={tool === "delete"}
              onEdgeClick={handleEdgeClick}
            />
            {pendingEdgeStartCoord && hoverNode === null && (
              <PendingEdgeHint
                from={pendingEdgeStartCoord}
                hoverNode={null}
                nodeById={nodeById}
              />
            )}
            <NodesLayer
              nodes={nodes}
              tool={tool}
              pendingEdgeStart={pendingEdgeStart}
              hoverNode={hoverNode}
              onNodeMouseDown={handleNodeMouseDown}
              onNodeClick={handleNodeClick}
              onNodeHover={setHoverNode}
            />
          </svg>
          {transientMsg && (
            <div
              role="status"
              style={{
                position: "absolute",
                bottom: 10,
                left: "50%",
                transform: "translateX(-50%)",
                background: palette.bgPanel,
                border: `1px solid ${palette.queraPurpleSoft}`,
                color: palette.textPrimary,
                fontSize: 12,
                padding: "6px 12px",
                borderRadius: 6,
              }}
            >
              {transientMsg}
            </div>
          )}
        </div>
      </div>

      <SidePanel
        nNodes={nodes.length}
        nEdges={edges.length}
        commRadius={commRadius}
        setCommRadius={setCommRadius}
        showCommRadius={showCommRadius}
        setShowCommRadius={setShowCommRadius}
        gridStep={gridStep}
        setGridStep={setGridStep}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        snapToGrid={snapToGrid}
        setSnapToGrid={setSnapToGrid}
        onAutoConnect={autoConnect}
        onClear={clearAll}
        onSave={tryOpenSave}
        onCancel={handleCancel}
        tool={tool}
        pendingEdgeStart={pendingEdgeStart}
      />

      {saveDialog && (
        <SaveDialog
          stage={saveDialog.stage}
          warnings={saveDialog.warnings}
          name={saveDialog.stage === "form" ? name : saveDialog.name}
          description={saveDialog.stage === "form" ? description : saveDialog.description}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onClose={() => setSaveDialog(null)}
          onConfirm={confirmSave}
        />
      )}
    </div>
  );
}

function Toolbar({
  tool,
  setTool,
  onOpenPresets,
  presetsOpen,
  onOpenGridMenu,
  gridMenuOpen,
  gridType,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  onOpenPresets: () => void;
  presetsOpen: boolean;
  onOpenGridMenu: () => void;
  gridMenuOpen: boolean;
  gridType: GridType;
}) {
  const activeGridLabel = GRID_TYPES.find((g) => g.id === gridType)?.label ?? "רשת";
  const items: { id: Tool; label: string; hint: string }[] = [
    { id: "addNode", label: "➕ קודקוד", hint: "קליק על הקנבס מוסיף קודקוד" },
    { id: "addEdge", label: "🔗 קשת", hint: "קליק על שני קודקודים מוסיף קשת" },
    { id: "move", label: "✋ הזז", hint: "גרור קודקוד למיקום חדש" },
    { id: "delete", label: "🗑 מחק", hint: "קליק על קודקוד / קשת ימחק אותם" },
  ];
  return (
    <div
      role="toolbar"
      aria-label="כלי עריכה"
      style={{
        display: "flex",
        gap: 6,
        background: palette.bgPanel,
        padding: 6,
        borderRadius: 8,
        border: `1px solid ${palette.queraPurpleSoft}`,
      }}
    >
      {items.map((item) => {
        const active = tool === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setTool(item.id)}
            aria-pressed={active}
            title={item.hint}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: `1px solid ${active ? palette.queraPurpleGlow : palette.queraPurpleSoft}`,
              background: active ? palette.queraPurple : "transparent",
              color: active ? "#fff" : palette.textSecondary,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {item.label}
          </button>
        );
      })}
      <div
        style={{
          width: 1,
          alignSelf: "stretch",
          background: palette.queraPurpleSoft,
          margin: "0 4px",
        }}
        aria-hidden="true"
      />
      <button
        onClick={onOpenPresets}
        aria-expanded={presetsOpen}
        aria-haspopup="menu"
        title="בחר תבנית גרף מוכנה"
        style={{
          padding: "6px 12px",
          borderRadius: 6,
          border: `1px solid ${presetsOpen ? palette.queraPurpleGlow : palette.queraPurpleSoft}`,
          background: presetsOpen ? palette.queraPurple : "transparent",
          color: presetsOpen ? "#fff" : palette.textSecondary,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        📐 תבנית {presetsOpen ? "▴" : "▾"}
      </button>
      <button
        onClick={onOpenGridMenu}
        aria-expanded={gridMenuOpen}
        aria-haspopup="menu"
        title="בחר סוג רשת רקע"
        style={{
          padding: "6px 12px",
          borderRadius: 6,
          border: `1px solid ${gridMenuOpen ? palette.queraPurpleGlow : palette.queraPurpleSoft}`,
          background: gridMenuOpen ? palette.queraPurple : "transparent",
          color: gridMenuOpen ? "#fff" : palette.textSecondary,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        🔲 רשת: {activeGridLabel} {gridMenuOpen ? "▴" : "▾"}
      </button>
    </div>
  );
}

function GridTypeMenu({
  gridType,
  setGridType,
  onClose,
}: {
  gridType: GridType;
  setGridType: (t: GridType) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "transparent", zIndex: 800 }}
        aria-hidden="true"
      />
      <div
        role="menu"
        aria-label="סוג רשת"
        style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          insetInlineEnd: 0,
          background: palette.bgPanel,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 10,
          padding: 8,
          boxShadow: `0 10px 40px ${palette.queraPurple}66`,
          zIndex: 900,
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {GRID_TYPES.map((t) => {
          const active = t.id === gridType;
          return (
            <button
              key={t.id}
              onClick={() => setGridType(t.id)}
              aria-pressed={active}
              style={{
                textAlign: "right",
                padding: "8px 10px",
                borderRadius: 6,
                border: `1px solid ${active ? palette.queraPurpleGlow : "transparent"}`,
                background: active ? palette.bgInset : "transparent",
                color: active ? palette.textPrimary : palette.textSecondary,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                <span>{t.label}</span>
                {active && <span style={{ color: palette.queraPurpleGlow }}>✓</span>}
              </div>
              <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                {t.description}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function PresetMenu({
  onApply,
  onClose,
}: {
  onApply: (spec: PresetSpec, param: number) => void;
  onClose: () => void;
}) {
  const [params, setParams] = useState<Record<string, number>>(() =>
    Object.fromEntries(PRESETS.map((p) => [p.id, p.paramDefault])),
  );
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "transparent", zIndex: 800 }}
        aria-hidden="true"
      />
      <div
        role="menu"
        aria-label="תבניות גרף"
        style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          insetInlineStart: 0,
          background: palette.bgPanel,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 10,
          padding: 10,
          boxShadow: `0 10px 40px ${palette.queraPurple}66`,
          zIndex: 900,
          width: 360,
          maxHeight: 380,
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PRESETS.map((spec) => {
            const value = params[spec.id] ?? spec.paramDefault;
            return (
              <div
                key={spec.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 8,
                  alignItems: "center",
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: palette.bgInset,
                  border: `1px solid ${palette.queraPurpleSoft}`,
                }}
              >
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: palette.textPrimary }}>
                    {spec.name}
                  </div>
                  <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                    {spec.description}
                  </div>
                </div>
                <label
                  style={{ fontSize: 11, color: palette.textMuted, display: "flex", alignItems: "center", gap: 4 }}
                  title={`טווח: ${spec.paramMin}-${spec.paramMax}`}
                >
                  {spec.paramLabel}
                  <input
                    type="number"
                    min={spec.paramMin}
                    max={spec.paramMax}
                    value={value}
                    onChange={(e) =>
                      setParams((prev) => ({
                        ...prev,
                        [spec.id]: Math.max(
                          spec.paramMin,
                          Math.min(spec.paramMax, Number(e.target.value) || spec.paramMin),
                        ),
                      }))
                    }
                    style={{
                      width: 52,
                      padding: "3px 6px",
                      borderRadius: 4,
                      border: `1px solid ${palette.queraPurpleSoft}`,
                      background: palette.bgPanel,
                      color: palette.textPrimary,
                      fontSize: 12,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  />
                </label>
                <button
                  onClick={() => onApply(spec, value)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 5,
                    border: "none",
                    background: palette.queraPurple,
                    color: "#fff",
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  צור
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function GridLayer({ geometry }: { geometry: GridGeometry }) {
  return (
    <g pointerEvents="none" clipPath="url(#editor-box-clip)">
      <defs>
        <clipPath id="editor-box-clip">
          <rect
            x={umToPx(0, BOX_UM).px}
            y={umToPx(0, BOX_UM).py}
            width={umToPx(BOX_UM, 0).px - umToPx(0, 0).px}
            height={umToPx(0, 0).py - umToPx(0, BOX_UM).py}
          />
        </clipPath>
      </defs>
      {geometry.lines.map((l, i) => {
        const a = umToPx(l.x1, l.y1);
        const b = umToPx(l.x2, l.y2);
        return (
          <line
            key={i}
            x1={a.px}
            y1={a.py}
            x2={b.px}
            y2={b.py}
            stroke={palette.queraPurpleSoft}
            strokeOpacity={l.bold ? 0.45 : 0.16}
            strokeWidth={l.bold ? 1 : 0.6}
          />
        );
      })}
    </g>
  );
}

function BoxOutline() {
  const { px: x0, py: y0 } = umToPx(0, BOX_UM);
  const { px: x1, py: y1 } = umToPx(BOX_UM, 0);
  return (
    <rect
      x={x0}
      y={y0}
      width={x1 - x0}
      height={y1 - y0}
      fill="none"
      stroke={palette.queraPurpleSoft}
      strokeDasharray="3 5"
      strokeWidth={1}
    />
  );
}

function CommRadiusLayer({ nodes, commRadius }: { nodes: NodePos[]; commRadius: number }) {
  return (
    <g opacity={0.08}>
      {nodes.map((n) => {
        const { px, py } = umToPx(n.x, n.y);
        return (
          <circle
            key={n.id}
            cx={px}
            cy={py}
            r={commRadius * SCALE}
            fill={palette.queraPurpleGlow}
            stroke={palette.queraPurple}
            strokeWidth={1}
            pointerEvents="none"
          />
        );
      })}
    </g>
  );
}

function EdgesLayer({
  edges,
  nodeById,
  hoverDelete,
  onEdgeClick,
}: {
  edges: [number, number][];
  nodeById: Map<number, NodePos>;
  hoverDelete: boolean;
  onEdgeClick: (a: number, b: number, evt: React.MouseEvent) => void;
}) {
  return (
    <g>
      {edges.map(([a, b], i) => {
        const na = nodeById.get(a);
        const nb = nodeById.get(b);
        if (!na || !nb) return null;
        const pa = umToPx(na.x, na.y);
        const pb = umToPx(nb.x, nb.y);
        return (
          <g key={`${a}-${b}-${i}`}>
            <line
              x1={pa.px}
              y1={pa.py}
              x2={pb.px}
              y2={pb.py}
              stroke={palette.textMuted}
              strokeOpacity={0.55}
              strokeWidth={1.4}
              strokeLinecap="round"
              pointerEvents="none"
            />
            <line
              x1={pa.px}
              y1={pa.py}
              x2={pb.px}
              y2={pb.py}
              stroke="transparent"
              strokeWidth={EDGE_HITBOX_PX * 2}
              style={{ cursor: hoverDelete ? "not-allowed" : "default" }}
              onClick={(evt) => onEdgeClick(a, b, evt)}
            />
          </g>
        );
      })}
    </g>
  );
}

function NodesLayer({
  nodes,
  tool,
  pendingEdgeStart,
  hoverNode,
  onNodeMouseDown,
  onNodeClick,
  onNodeHover,
}: {
  nodes: NodePos[];
  tool: Tool;
  pendingEdgeStart: number | null;
  hoverNode: number | null;
  onNodeMouseDown: (id: number, evt: React.MouseEvent<SVGElement>) => void;
  onNodeClick: (id: number) => void;
  onNodeHover: (id: number | null) => void;
}) {
  return (
    <g>
      {nodes.map((n) => {
        const { px, py } = umToPx(n.x, n.y);
        const isPending = pendingEdgeStart === n.id;
        const isHover = hoverNode === n.id;
        const fill = isPending
          ? palette.queraPurpleGlow
          : isHover && tool === "delete"
            ? palette.err
            : palette.atomGround;
        return (
          <g
            key={n.id}
            onMouseDown={(evt) => onNodeMouseDown(n.id, evt)}
            onClick={(evt) => {
              evt.stopPropagation();
              onNodeClick(n.id);
            }}
            onMouseEnter={() => onNodeHover(n.id)}
            onMouseLeave={() => onNodeHover(null)}
            style={{
              cursor:
                tool === "move"
                  ? "grab"
                  : tool === "delete"
                    ? "not-allowed"
                    : "pointer",
            }}
          >
            <circle
              cx={px}
              cy={py}
              r={NODE_RADIUS_PX}
              fill={fill}
              stroke={isPending ? "#fff" : palette.queraPurpleSoft}
              strokeWidth={isPending ? 2 : 1}
            />
            <text
              x={px}
              y={py + 3}
              textAnchor="middle"
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
              fill="#fff"
              pointerEvents="none"
            >
              {n.id}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function PendingEdgeHint({
  from,
}: {
  from: { px: number; py: number };
  hoverNode: number | null;
  nodeById: Map<number, NodePos>;
}) {
  return (
    <circle
      cx={from.px}
      cy={from.py}
      r={NODE_RADIUS_PX + 4}
      fill="none"
      stroke={palette.queraPurpleGlow}
      strokeWidth={1.5}
      strokeDasharray="3 3"
      pointerEvents="none"
    />
  );
}

function SidePanel({
  nNodes,
  nEdges,
  commRadius,
  setCommRadius,
  showCommRadius,
  setShowCommRadius,
  gridStep,
  setGridStep,
  showGrid,
  setShowGrid,
  snapToGrid,
  setSnapToGrid,
  onAutoConnect,
  onClear,
  onSave,
  onCancel,
  tool,
  pendingEdgeStart,
}: {
  nNodes: number;
  nEdges: number;
  commRadius: number;
  setCommRadius: (v: number) => void;
  showCommRadius: boolean;
  setShowCommRadius: (v: boolean) => void;
  gridStep: number;
  setGridStep: (v: number) => void;
  showGrid: boolean;
  setShowGrid: (v: boolean) => void;
  snapToGrid: boolean;
  setSnapToGrid: (v: boolean) => void;
  onAutoConnect: () => void;
  onClear: () => void;
  onSave: () => void;
  onCancel: () => void;
  tool: Tool;
  pendingEdgeStart: number | null;
}) {
  const hints: Record<Tool, string> = {
    addNode: "קליק על הקנבס מוסיף קודקוד חדש.",
    addEdge:
      pendingEdgeStart === null
        ? "קליק על הקודקוד הראשון של הקשת."
        : `נבחר קודקוד ${pendingEdgeStart} — קליק על קודקוד שני יסגור קשת. קליק שוב על אותו קודקוד מבטל.`,
    move: "גרור קודקוד למיקום חדש. לא ניתן להציב על קודקוד אחר.",
    delete: "קליק על קודקוד מוחק אותו וכל הקשתות שלו. קליק על קשת מוחק רק אותה.",
  };
  return (
    <div
      style={{
        width: 260,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        background: palette.bgPanel,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 11.5,
          color: palette.textSecondary,
          lineHeight: 1.5,
          minHeight: 38,
        }}
      >
        {hints[tool]}
      </div>

      <div style={{ display: "flex", gap: 12, fontSize: 12, color: palette.textSecondary }} dir="ltr">
        <span>
          N = <strong style={{ color: palette.textPrimary }}>{nNodes}</strong>
          {nNodes > SOFT_MAX_NODES && (
            <span style={{ color: palette.warn, marginInlineStart: 4 }}>⚠</span>
          )}
        </span>
        <span>
          |E| = <strong style={{ color: palette.textPrimary }}>{nEdges}</strong>
        </span>
      </div>

      <div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11.5,
            color: palette.textSecondary,
            marginBottom: 6,
            gap: 8,
          }}
        >
          <span>
            טווח תקשורת (µm):{" "}
            <strong style={{ color: palette.textPrimary }} dir="ltr">
              {commRadius.toFixed(0)}
            </strong>
          </span>
          <label
            style={miniCheckboxLabelStyle}
            title="הצג/הסתר את ההילה החצי-שקופה סביב הקודקודים"
          >
            <input
              type="checkbox"
              checked={showCommRadius}
              onChange={(e) => setShowCommRadius(e.target.checked)}
              style={{ margin: 0 }}
            />
            הצג
          </label>
        </label>
        <input
          type="range"
          min={COMM_RADIUS_MIN}
          max={COMM_RADIUS_MAX}
          step={1}
          value={commRadius}
          onChange={(e) => setCommRadius(Number(e.target.value))}
          aria-label="טווח תקשורת"
          style={{ width: "100%" }}
        />
      </div>

      <div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11.5,
            color: palette.textSecondary,
            marginBottom: 6,
            gap: 8,
          }}
        >
          <span>
            רשת (µm):{" "}
            <strong style={{ color: palette.textPrimary }} dir="ltr">
              {gridStep}
            </strong>
          </span>
          <span style={{ display: "inline-flex", gap: 8 }}>
            <label
              style={miniCheckboxLabelStyle}
              title="הצג/הסתר את קווי הרשת ברקע"
            >
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
                style={{ margin: 0 }}
              />
              הצג
            </label>
            <label
              style={miniCheckboxLabelStyle}
              title="הצמד קודקודים חדשים וגרירות לנקודות הרשת"
            >
              <input
                type="checkbox"
                checked={snapToGrid}
                onChange={(e) => setSnapToGrid(e.target.checked)}
                style={{ margin: 0 }}
              />
              הצמד
            </label>
          </span>
        </label>
        <input
          type="range"
          min={GRID_STEP_MIN}
          max={GRID_STEP_MAX}
          step={1}
          value={gridStep}
          onChange={(e) => setGridStep(Number(e.target.value))}
          aria-label="צפיפות רשת"
          style={{ width: "100%" }}
        />
      </div>

      <button onClick={onAutoConnect} disabled={nNodes < 2} style={secondaryBtn(nNodes < 2)}>
        חבר אוטומטית (RGG)
      </button>
      <button onClick={onClear} disabled={nNodes === 0 && nEdges === 0} style={secondaryBtn(nNodes === 0 && nEdges === 0)}>
        נקה הכל
      </button>

      <div style={{ flex: 1 }} />

      <button onClick={onSave} style={primaryBtn(false)}>
        שמור
      </button>
      <button onClick={onCancel} style={secondaryBtn(false)}>
        ביטול
      </button>
    </div>
  );
}

function SaveDialog({
  stage,
  warnings,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onClose,
  onConfirm,
}: {
  stage: "form" | "confirmWarnings";
  warnings: string[];
  name: string;
  description: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="שמירת גרף"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 5, 14, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: palette.bgPanel,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          padding: "20px 24px",
          width: 420,
          maxWidth: "92vw",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {stage === "form" ? (
          <>
            <h3 style={{ margin: 0, fontSize: 15, color: palette.textPrimary }}>שמירת גרף</h3>
            <label style={{ fontSize: 12, color: palette.textSecondary }}>
              שם
              <input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="לדוגמה: רשת משולשת"
                style={inputStyle}
                autoFocus
              />
            </label>
            <label style={{ fontSize: 12, color: palette.textSecondary }}>
              תיאור (לא חובה)
              <textarea
                value={description}
                onChange={(e) => onDescriptionChange(e.target.value)}
                rows={3}
                placeholder="מה מיוחד בגרף הזה?"
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </label>
            {warnings.length > 0 && (
              <div style={warnBoxStyle}>
                {warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={secondaryBtn(false)}>
                ביטול
              </button>
              <button onClick={onConfirm} style={primaryBtn(false)}>
                {warnings.length > 0 ? "המשך לאזהרה" : "שמור"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ margin: 0, fontSize: 15, color: palette.warn }}>אישור אזהרה</h3>
            <div style={warnBoxStyle}>
              {warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: palette.textSecondary }}>
              להמשיך ולשמור בכל זאת?
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={secondaryBtn(false)}>
                ביטול
              </button>
              <button onClick={onConfirm} style={primaryBtn(false)}>
                שמור בכל זאת
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const miniCheckboxLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  color: palette.textMuted,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "6px 8px",
  borderRadius: 6,
  border: `1px solid ${palette.queraPurpleSoft}`,
  background: palette.bgInset,
  color: palette.textPrimary,
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const warnBoxStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  background: "rgba(255, 181, 71, 0.1)",
  border: `1px solid ${palette.warn}`,
  color: palette.warn,
  fontSize: 12,
  lineHeight: 1.5,
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    border: "none",
    borderRadius: 6,
    background: disabled ? "transparent" : palette.queraPurple,
    color: disabled ? palette.textMuted : "#fff",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    border: `1px solid ${palette.queraPurpleSoft}`,
    borderRadius: 6,
    background: "transparent",
    color: disabled ? palette.textMuted : palette.textPrimary,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

export const __testing = {
  pxToUm,
  umToPx,
  distancePointToSegment,
};
