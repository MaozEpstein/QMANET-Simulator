/**
 * "השווה דוגמאות" button + modal — a self-contained research tool that lets
 * the user multi-select several curated examples and see a side-by-side
 * comparison table (structural stats + MIS on both tracks). Deliberately
 * store-free: it never touches usePipeline, so it can never affect Stages
 * 1-8. See frontend/src/lib/compareExamples.ts for the pure computation
 * helpers, and ExamplesButton.tsx for the curated EXAMPLES/CATEGORIES list
 * this reuses (not duplicates).
 *
 * Snapshot, not live: "השווה" runs once per selection (each cell is a real
 * backend call). A per-row ⟲ re-runs just that row's conflict-track numbers
 * at a possibly-edited R', without recomputing anything else.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CATEGORIES,
  EXAMPLES,
  type Example,
} from "./ExamplesButton";
import {
  computeConflictStats,
  computeDirectStats,
  computeStructuralStats,
  type TrackResult,
} from "../lib/compareExamples";
import { palette } from "../theme/palette";

type View = "select" | "results";

interface RowState {
  example: Example;
  n: number;
  m: number;
  density: number;
  avgDeg: number;
  direct: TrackResult | "loading";
  interferenceRadius: number;
  conflict: TrackResult | "loading";
}

const SELECTABLE_EXAMPLES = EXAMPLES.filter((e) => e.build && e.status !== "soon");

export function CompareExamplesButton() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("select");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Map<string, RowState>>(new Map());

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runComparison = useCallback(() => {
    const selected = SELECTABLE_EXAMPLES.filter((e) => selectedIds.has(e.id));
    const initial = new Map<string, RowState>();
    for (const example of selected) {
      const manet = example.build!();
      const { density, avgDeg } = computeStructuralStats(manet.graph.n_nodes, manet.graph.edges);
      initial.set(example.id, {
        example,
        n: manet.graph.n_nodes,
        m: manet.graph.edges.length,
        density,
        avgDeg,
        direct: "loading",
        interferenceRadius: example.interferenceRadius ?? manet.config.comm_radius,
        conflict: "loading",
      });
    }
    setRows(initial);
    setView("results");

    for (const example of selected) {
      const manet = example.build!();
      const row = initial.get(example.id)!;
      computeDirectStats(manet.graph).then((direct) => {
        setRows((prev) => {
          const cur = prev.get(example.id);
          if (!cur) return prev;
          const next = new Map(prev);
          next.set(example.id, { ...cur, direct });
          return next;
        });
      });
      computeConflictStats(manet.graph, row.interferenceRadius).then((conflict) => {
        setRows((prev) => {
          const cur = prev.get(example.id);
          if (!cur) return prev;
          const next = new Map(prev);
          next.set(example.id, { ...cur, conflict });
          return next;
        });
      });
    }
  }, [selectedIds]);

  const refreshConflictRow = useCallback((id: string, newR: number) => {
    setRows((prev) => {
      const cur = prev.get(id);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(id, { ...cur, interferenceRadius: newR, conflict: "loading" });
      return next;
    });
    const row = rows.get(id);
    if (!row) return;
    const manet = row.example.build!();
    computeConflictStats(manet.graph, newR).then((conflict) => {
      setRows((prev) => {
        const cur = prev.get(id);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(id, { ...cur, conflict });
        return next;
      });
    });
  }, [rows]);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const rowList = useMemo(() => Array.from(rows.values()), [rows]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="השווה דוגמאות"
        title="השווה כמה דוגמאות זו לצד זו"
        style={buttonStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = palette.queraPurple;
          e.currentTarget.style.color = "#fff";
          e.currentTarget.style.borderColor = palette.queraPurpleGlow;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = palette.textPrimary;
          e.currentTarget.style.borderColor = palette.queraPurpleSoft;
        }}
      >
        <span style={{ fontSize: 13 }}>⇄</span>
        <span style={{ marginInlineStart: 8 }}>השווה דוגמאות</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="השוואת דוגמאות"
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 5, 14, 0.78)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: palette.bgPanel,
              border: `1px solid ${palette.queraPurpleSoft}`,
              borderRadius: 14,
              padding: "22px 26px",
              maxWidth: "min(1500px, 96vw)",
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              boxShadow: `0 12px 60px ${palette.queraPurple}66`,
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 18,
                gap: 12,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: palette.textPrimary }}>
                  {view === "select" ? "השווה דוגמאות" : "טבלת השוואה"}
                </h2>
                <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 4 }}>
                  {view === "select"
                    ? "בחר כמה דוגמאות (לפחות 2) כדי להשוות ביניהן — מבנה + MIS בשני המסלולים."
                    : "כל שורה חושבה פעם אחת. אפשר לשנות R' לדוגמה ספציפית ולרענן רק אותה."}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {view === "results" && (
                  <button onClick={() => setView("select")} style={secondaryBtn}>
                    ← חזרה לבחירה
                  </button>
                )}
                <button
                  onClick={close}
                  aria-label="סגור"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: `1px solid ${palette.queraPurpleSoft}`,
                    background: "transparent",
                    color: palette.textSecondary,
                    fontSize: 16,
                    cursor: "pointer",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            </header>

            {view === "select" ? (
              <SelectView
                selectedIds={selectedIds}
                onToggle={toggleSelected}
                onCompare={runComparison}
              />
            ) : (
              <ResultsTable rows={rowList} onRefresh={refreshConflictRow} onRemove={removeRow} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SelectView({
  selectedIds,
  onToggle,
  onCompare,
}: {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onCompare: () => void;
}) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, paddingBottom: 60 }}>
        {CATEGORIES.filter((cat) => cat.id !== "myGraphs").map((cat) => {
          const items = SELECTABLE_EXAMPLES.filter((e) => e.category === cat.id);
          if (items.length === 0) return null;
          return (
            <section key={cat.id}>
              <div style={{ marginBottom: 10 }}>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: palette.queraPurpleGlow,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                  }}
                >
                  {cat.title}
                </h3>
                <div style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 2 }}>
                  {cat.subtitle}
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                  gap: 10,
                }}
              >
                {items.map((ex) => (
                  <SelectCard
                    key={ex.id}
                    example={ex}
                    checked={selectedIds.has(ex.id)}
                    onToggle={() => onToggle(ex.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div
        style={{
          position: "sticky",
          bottom: -22,
          marginTop: -60,
          padding: "12px 4px",
          background: `linear-gradient(to top, ${palette.bgPanel} 70%, transparent)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 14,
        }}
      >
        <span style={{ fontSize: 12, color: palette.textSecondary }} dir="ltr">
          {selectedIds.size} נבחרו
        </span>
        <button
          onClick={onCompare}
          disabled={selectedIds.size < 2}
          style={primaryBtn(selectedIds.size < 2)}
        >
          השווה
        </button>
      </div>
    </>
  );
}

function SelectCard({
  example,
  checked,
  onToggle,
}: {
  example: Example;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        background: checked ? palette.bgPanelElevated : palette.bgInset,
        border: `1px solid ${checked ? palette.queraPurpleGlow : palette.queraPurpleSoft}`,
        borderRadius: 10,
        padding: "10px 12px",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ marginTop: 3, flexShrink: 0 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 12.5, color: palette.textPrimary }}>
            {example.name}
          </span>
          <span
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 10.5,
              color: palette.queraPurpleGlow,
            }}
            dir="ltr"
          >
            N={example.n}
          </span>
        </div>
        <div style={{ fontSize: 11, color: palette.textSecondary, lineHeight: 1.4 }}>
          {example.description}
        </div>
      </div>
    </label>
  );
}

function ResultsTable({
  rows,
  onRefresh,
  onRemove,
}: {
  rows: RowState[];
  onRefresh: (id: string, r: number) => void;
  onRemove: (id: string) => void;
}) {
  const [rEdits, setREdits] = useState<Record<string, number>>({});

  if (rows.length === 0) {
    return <div style={{ color: palette.textMuted, fontSize: 12 }}>אין שורות להצגה.</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, whiteSpace: "nowrap" }}>
        <thead>
          <tr style={{ background: palette.bgInset }}>
            <Th>שם</Th>
            <Th>N</Th>
            <Th>M</Th>
            <Th>צפיפות</Th>
            <Th>דרגה ממ.</Th>
            <Th>Direct |MIS|</Th>
            <Th>Direct α</Th>
            <Th>Direct χ</Th>
            <Th>R'</Th>
            <Th></Th>
            <Th>Conflict |MIS|</Th>
            <Th>Conflict α</Th>
            <Th>Conflict χ</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rEdit = rEdits[row.example.id] ?? row.interferenceRadius;
            return (
              <tr key={row.example.id} style={{ borderBottom: `1px solid ${palette.queraPurpleSoft}33` }}>
                <Td bold>{row.example.name}</Td>
                <Td mono>{row.n}</Td>
                <Td mono>{row.m}</Td>
                <Td mono>{row.density.toFixed(2)}</Td>
                <Td mono>{row.avgDeg.toFixed(2)}</Td>
                <TrackCells result={row.direct} />
                <Td mono>
                  <input
                    type="number"
                    min={0}
                    value={rEdit}
                    onChange={(e) =>
                      setREdits((prev) => ({ ...prev, [row.example.id]: Number(e.target.value) }))
                    }
                    style={{
                      width: 60,
                      padding: "3px 6px",
                      borderRadius: 4,
                      border: `1px solid ${palette.queraPurpleSoft}`,
                      background: palette.bgPanel,
                      color: palette.textPrimary,
                      fontFamily: "inherit",
                      fontSize: 13,
                      textAlign: "center",
                    }}
                    dir="ltr"
                  />
                </Td>
                <Td>
                  <button
                    onClick={() => onRefresh(row.example.id, rEdit)}
                    title="חשב מחדש את מסלול הקונפליקט עם R' הזה"
                    style={iconBtn}
                  >
                    ⟲
                  </button>
                </Td>
                <TrackCells result={row.conflict} />
                <Td>
                  <button onClick={() => onRemove(row.example.id)} title="הסר שורה" style={iconBtn}>
                    ✕
                  </button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TrackCells({ result }: { result: TrackResult | "loading" }) {
  if (result === "loading") {
    return (
      <>
        <Td mono muted>…</Td>
        <Td mono muted>…</Td>
        <Td mono muted>…</Td>
      </>
    );
  }
  if (!result.ok) {
    return (
      <Td colSpan={3}>
        <span style={{ color: palette.err, fontSize: 11 }} dir="ltr">
          {result.error}
        </span>
      </Td>
    );
  }
  return (
    <>
      <Td mono>{result.stats.size}</Td>
      <Td mono>{result.stats.alpha}</Td>
      <Td mono>
        {result.stats.chromaticLo}–{result.stats.chromaticHi}
      </Td>
    </>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "center",
        padding: "10px 12px",
        fontWeight: 600,
        fontSize: 13,
        color: palette.queraPurpleGlow,
        borderBottom: `1px solid ${palette.queraPurpleSoft}`,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  bold,
  mono,
  muted,
  colSpan,
}: {
  children?: React.ReactNode;
  bold?: boolean;
  mono?: boolean;
  muted?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "9px 12px",
        textAlign: "center",
        fontWeight: bold ? 600 : 400,
        fontFamily: mono ? "JetBrains Mono, monospace" : undefined,
        color: muted ? palette.textMuted : palette.textPrimary,
      }}
      dir={mono ? "ltr" : undefined}
    >
      {children}
    </td>
  );
}

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "7px 14px",
  borderRadius: 8,
  border: `1px solid ${palette.queraPurpleSoft}`,
  background: "transparent",
  color: palette.textPrimary,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 140ms ease",
};

const secondaryBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: `1px solid ${palette.queraPurpleSoft}`,
  background: "transparent",
  color: palette.textSecondary,
  fontSize: 12,
  cursor: "pointer",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 18px",
    borderRadius: 8,
    border: "none",
    background: disabled ? "transparent" : palette.queraPurple,
    color: disabled ? palette.textMuted : "#fff",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

const iconBtn: React.CSSProperties = {
  padding: "2px 6px",
  borderRadius: 5,
  border: `1px solid ${palette.queraPurpleSoft}`,
  background: "transparent",
  color: palette.textSecondary,
  fontSize: 12,
  cursor: "pointer",
};
