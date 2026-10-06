/**
 * Stage 2 (conflict track) — classical throughput bounds on the conflict
 * graph F, after Jain, Padhye, Padmanabhan & Qiu (MobiCom 2003) §4:
 *
 *   1/χ(F)  ≤  x* = 1/χ_f(F)  ≤  1/ω(F)
 *
 * x is the rate every link gets under a common TDMA frame (unit capacity).
 * Each bound comes with its certificate drawn on F: the max clique (why
 * nobody can do better than 1/ω), the coloring (a schedule achieving 1/χ),
 * and the LP time-share (the optimal schedule, achieving 1/χ_f).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/rest";
import type {
  ConflictGraphResponse,
  ConflictMode,
  GraphDTO,
  InterferenceSweepResponse,
  ThroughputBounds,
  ThroughputBoundsResponse,
  TimeShareSlot,
} from "../api/rest";
import { palette } from "../theme/palette";
import {
  allBoundsCoincide,
  boundGaps,
  boundsAxisMax,
  fmtChiF,
  fmtRate,
  slotsForView,
  type BoundsView,
} from "../lib/throughputBounds";
import { BOUND_COLORS, BoundsBandChart } from "./BoundsBandChart";
import { GraphView } from "./GraphView";
import { InfoButton } from "./InfoButton";
import { Panel } from "./Panel";

const MONO = "var(--font-mono)";
const TABULAR = '"tnum" 1, "zero" 1';

// Fixed-order slot hues for drawing a full coloring on F. Past this many
// colors the graph shows one slot at a time instead of inventing hues.
const SLOT_PALETTE = [
  "#3ed3ff",
  "#b388ff",
  "#ffb547",
  "#3ddc97",
  "#ff5470",
  "#ec4899",
  "#14b8a6",
  "#9aa6bf",
];

const VIEW_COLOR: Record<BoundsView, string> = {
  coloring: BOUND_COLORS.lower,
  lp: BOUND_COLORS.exact,
  clique: BOUND_COLORS.upper,
};

interface Props {
  manetGraph: GraphDTO;
  conflictGraph: ConflictGraphResponse | null;
  conflictMode: ConflictMode;
  interferenceRadius: number;
  onInterferenceRadiusChange: (r: number) => void;
  linkLabel?: (id: number) => string;
}

export function ThroughputBoundsPanel({
  manetGraph,
  conflictGraph,
  conflictMode,
  interferenceRadius,
  onInterferenceRadiusChange,
  linkLabel,
}: Props) {
  const [res, setRes] = useState<ThroughputBoundsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<BoundsView>("lp");
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!conflictGraph) return;
    const id = ++requestId.current;
    setRes(null);
    setErr(null);
    setActiveSlot(null);
    setLoading(true);
    api
      .throughputBounds(conflictGraph.conflict_graph)
      .then((r) => {
        if (id === requestId.current) setRes(r);
      })
      .catch((e: Error) => {
        if (id === requestId.current) setErr(e.message);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [conflictGraph]);

  const f = conflictGraph?.conflict_graph ?? null;
  // Guard against a response for a previous F (e.g. mid mode switch).
  const bounds: ThroughputBounds | null =
    res?.bounds && f && res.bounds.coloring.length === f.n_nodes ? res.bounds : null;

  const coincide = bounds ? allBoundsCoincide(bounds) : false;

  return (
    <Panel
      title="שלב 2 · חסמי Throughput — המודל הקלאסי (Jain et al. §4)"
      subtitle="כמה קצב x יכול כל קישור לקבל, אם כולם חולקים את אותה מסגרת TDMA (קיבולת קישור = 1)? כל קליקה ב-F נותנת חסם עליון, כל צביעה נותנת חסם תחתון, וה-LP על הקבוצות הבלתי-תלויות נותן את הערך המדויק."
      collapsible
      collapseGroup="throughput-bounds"
      right={bounds ? <GapBadge bounds={bounds} /> : null}
    >
      {loading && <div style={{ color: palette.textMuted, fontSize: 13.5 }}>מחשב חסמים…</div>}
      {err && (
        <div style={{ color: palette.err, fontSize: 13.5 }} dir="ltr">
          {err}
        </div>
      )}
      {res && res.bounds === null && (
        <div style={{ color: palette.warn, fontSize: 13.5 }}>
          ל-F יש {res.n_vertices} קודקודים — מעל למקסימום ({res.max_vertices}) לחישוב החסמים.
        </div>
      )}

      {bounds && f && (
        <div style={{ display: "grid", gap: 18 }}>
          <BoundsBar bounds={bounds} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }} dir="ltr">
            <BoundCard
              active={view === "coloring"}
              onClick={() => {
                setView("coloring");
                setActiveSlot(null);
              }}
              color={BOUND_COLORS.lower}
              role="חסם תחתון"
              symbol={bounds.chi_exact ? `χ(F) = ${bounds.chi}` : `χ(F) ≤ ${bounds.chi}`}
              rate={`x ≥ 1/${bounds.chi} = ${fmtRate(bounds.lower_bound)}`}
              caption={`צביעה (${strategyName(bounds.coloring_strategy)}) — כל צבע הוא חלון זמן`}
              chip={bounds.chi_exact ? "χ מדויק" : undefined}
            />
            <BoundCard
              active={view === "lp"}
              onClick={() => {
                setView("lp");
                setActiveSlot(null);
              }}
              color={BOUND_COLORS.exact}
              role={bounds.chi_f_exact ? "ערך מדויק" : "חסם תחתון משופר"}
              symbol={`χ_f(F) ${bounds.chi_f_exact ? "=" : "≤"} ${fmtChiF(bounds.chi_f)}`}
              rate={`x${bounds.chi_f_exact ? "*" : ""} ${bounds.chi_f_exact ? "=" : "≥"} ${fmtRate(bounds.lp_bound)}`}
              caption={
                coincide
                  ? "הצביעה כבר אופטימלית — אין צורך ב-LP"
                  : `LP על קבוצות בלתי-תלויות · ${bounds.lp_iterations} איטרציות`
              }
              chip={bounds.chi_f_exact ? "אופטימום מוכח" : "לא הוכח"}
            />
            <BoundCard
              active={view === "clique"}
              onClick={() => {
                setView("clique");
                setActiveSlot(null);
              }}
              color={BOUND_COLORS.upper}
              role="חסם עליון"
              symbol={`ω(F) = ${bounds.omega}`}
              rate={`x ≤ 1/${bounds.omega} = ${fmtRate(bounds.upper_bound)}`}
              caption="קליקה מקסימלית — קישורים שמתנגשים כולם בכולם"
            />
          </div>

          <CertificateView
            bounds={bounds}
            f={f}
            view={view}
            activeSlot={activeSlot}
            onSlotChange={setActiveSlot}
            linkLabel={linkLabel}
          />

          <BandSection
            manetGraph={manetGraph}
            conflictMode={conflictMode}
            interferenceRadius={interferenceRadius}
            onInterferenceRadiusChange={onInterferenceRadiusChange}
          />
        </div>
      )}
    </Panel>
  );
}

function strategyName(s: string): string {
  const names: Record<string, string> = {
    saturation_largest_first: "DSATUR",
    largest_first: "Largest-First",
    smallest_last: "Smallest-Last",
    independent_set: "Independent-Set",
    connected_sequential_bfs: "BFS",
  };
  return names[s] ?? s;
}

// --------------------------------------------------------------------------- //
// Header badge
// --------------------------------------------------------------------------- //

function GapBadge({ bounds }: { bounds: ThroughputBounds }) {
  const coincide = allBoundsCoincide(bounds);
  const color = coincide ? palette.ok : palette.queraPurpleGlow;
  return (
    <div
      dir="ltr"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: MONO,
        fontSize: 14,
        color,
        background: palette.bgInset,
        padding: "6px 12px",
        borderRadius: 8,
        whiteSpace: "nowrap",
        fontFeatureSettings: TABULAR,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
      {coincide
        ? `x* = ${fmtRate(bounds.upper_bound)} · bounds tight`
        : `gap = ${fmtRate(bounds.upper_bound - bounds.lower_bound)}`}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Bound bar — the number line 0..axisMax with the three markers
// --------------------------------------------------------------------------- //

function BoundsBar({ bounds }: { bounds: ThroughputBounds }) {
  const axisMax = boundsAxisMax(bounds.upper_bound);
  const pct = (x: number) => `${(Math.min(x, axisMax) / axisMax) * 100}%`;
  const coincide = allBoundsCoincide(bounds);
  const lpOnLower = Math.abs(bounds.lp_bound - bounds.lower_bound) < 1e-9;
  const lpOnUpper = Math.abs(bounds.lp_bound - bounds.upper_bound) < 1e-9;
  const ticks = useMemo(() => {
    const step = axisMax <= 0.1 ? 0.02 : axisMax <= 0.3 ? 0.05 : 0.1;
    const out: number[] = [];
    for (let v = 0; v <= axisMax + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }, [axisMax]);
  const gaps = boundGaps(bounds);

  return (
    <div
      style={{
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 12,
        padding: "16px 28px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
          fontSize: 14,
          color: palette.textSecondary,
        }}
      >
        <span>קצב אחיד לכל קישור (חלק מהזמן שבו הוא משדר)</span>
        <InfoButton title="למה זה עובד — חסמי Jain et al.">
          <BoundsMath />
        </InfoButton>
      </div>

      <div dir="ltr" style={{ position: "relative", height: 132, fontFeatureSettings: TABULAR }}>
        {/* Track */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 62,
            height: 8,
            borderRadius: 4,
            background: palette.bgPanel,
            border: `1px solid ${palette.queraPurpleSoft}`,
          }}
        />
        {/* Uncertainty band */}
        {!coincide && (
          <div
            style={{
              position: "absolute",
              left: pct(bounds.lower_bound),
              width: `calc(${pct(bounds.upper_bound)} - ${pct(bounds.lower_bound)})`,
              top: 60,
              height: 12,
              borderRadius: 4,
              background: `linear-gradient(90deg, ${BOUND_COLORS.lower}55, ${BOUND_COLORS.exact}66, ${BOUND_COLORS.upper}55)`,
            }}
          />
        )}

        {coincide ? (
          <Marker x={pct(bounds.upper_bound)} color={palette.ok} above={`x* = ${fmtRate(bounds.upper_bound)}`} below="1/χ = 1/χ_f = 1/ω" align="center" />
        ) : (
          <>
            <Marker
              x={pct(bounds.lower_bound)}
              color={BOUND_COLORS.lower}
              below={`1/χ = ${fmtRate(bounds.lower_bound)}`}
              sub="חסם תחתון"
              align="end"
            />
            <Marker
              x={pct(bounds.upper_bound)}
              color={BOUND_COLORS.upper}
              below={`1/ω = ${fmtRate(bounds.upper_bound)}`}
              sub="חסם עליון"
              align="start"
            />
            {!lpOnLower && !lpOnUpper ? (
              <Marker
                x={pct(bounds.lp_bound)}
                color={BOUND_COLORS.exact}
                above={`1/χ_f = ${fmtRate(bounds.lp_bound)}`}
                sub={bounds.chi_f_exact ? "ערך מדויק" : "LP"}
                align="center"
                big
              />
            ) : (
              <Marker
                x={pct(bounds.lp_bound)}
                color={BOUND_COLORS.exact}
                above={`${lpOnLower ? "= 1/χ" : "= 1/ω"} · ${bounds.chi_f_exact ? "ערך מדויק" : "LP"}`}
                align="center"
                big
              />
            )}
          </>
        )}

        {/* Axis ticks */}
        {ticks.map((t) => (
          <div
            key={t}
            style={{
              position: "absolute",
              left: pct(t),
              top: 118,
              transform: "translateX(-50%)",
              fontSize: 12,
              fontFamily: MONO,
              color: palette.textMuted,
            }}
          >
            {t === 0 ? "0" : t.toFixed(2)}
          </div>
        ))}
      </div>

      {!coincide && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 18px",
            marginTop: 8,
            fontSize: 14.5,
            color: palette.textSecondary,
          }}
        >
          <span>
            רוחב אזור אי-הוודאות:{" "}
            <b dir="ltr" style={{ color: palette.textPrimary, fontFamily: MONO }}>
              {fmtRate(gaps.band)}
            </b>
          </span>
          <span>
            החסם התחתון רחוק{" "}
            <b style={{ color: BOUND_COLORS.lower, fontFamily: MONO }}>{(gaps.lower * 100).toFixed(1)}%</b>{" "}
            מה-LP
          </span>
          <span>
            החסם העליון רחוק{" "}
            <b style={{ color: BOUND_COLORS.upper, fontFamily: MONO }}>{(gaps.upper * 100).toFixed(1)}%</b>{" "}
            מה-LP
          </span>
          {!bounds.chi_f_exact && (
            <span style={{ color: palette.warn }}>
              ה-LP לא הוכח אופטימלי (גרף גדול) — הערך המדויק נמצא ב-[{fmtRate(bounds.lp_bound)},{" "}
              {fmtRate(1 / bounds.chi_f_lower)}]
            </span>
          )}
        </div>
      )}
      {coincide && (
        <div style={{ marginTop: 8, fontSize: 14, color: palette.textSecondary }}>
          כאן ω(F) = χ(F) = {bounds.omega}, ולכן שלושת החסמים מתלכדים — השיטה הקלאסית נותנת את
          התשובה המדויקת. נסה R' קטן יותר, מצב MAC אחר, או את דוגמת ה-Pentagon כדי לראות פער.
        </div>
      )}
    </div>
  );
}

function Marker({
  x,
  color,
  above,
  below,
  sub,
  align,
  big = false,
}: {
  x: string;
  color: string;
  above?: string;
  below?: string;
  sub?: string;
  align: "start" | "center" | "end";
  big?: boolean;
}) {
  const shift = align === "center" ? "-50%" : align === "end" ? "-100%" : "0";
  const labelStyle: React.CSSProperties = {
    position: "absolute",
    left: x,
    transform: `translateX(${shift})`,
    whiteSpace: "nowrap",
    fontFamily: MONO,
    fontSize: 14.5,
    color: palette.textPrimary,
    textAlign: align === "center" ? "center" : align === "end" ? "right" : "left",
    padding: align === "end" ? "0 6px 0 0" : align === "start" ? "0 0 0 6px" : 0,
  };
  const size = big ? 18 : 14;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: x,
          top: 36,
          height: 56,
          width: 2,
          transform: "translateX(-1px)",
          background: color,
          borderRadius: 1,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x,
          top: 66 - size / 2,
          width: size,
          height: size,
          transform: "translateX(-50%)",
          borderRadius: "50%",
          background: color,
          border: `2px solid ${palette.bgInset}`,
          boxShadow: `0 0 10px ${color}aa`,
        }}
      />
      {above && (
        <div style={{ ...labelStyle, top: 0 }}>
          <span style={{ color, fontWeight: 600 }}>{above}</span>
          {sub && <span style={{ color: palette.textMuted, fontSize: 12, fontFamily: "inherit" }}> · {sub}</span>}
        </div>
      )}
      {below && (
        <div style={{ ...labelStyle, top: 96 }}>
          <span style={{ color, fontWeight: 600 }}>{below}</span>
          {sub && <span style={{ color: palette.textMuted, fontSize: 12 }}> · {sub}</span>}
        </div>
      )}
    </>
  );
}

// --------------------------------------------------------------------------- //
// Bound cards
// --------------------------------------------------------------------------- //

function BoundCard({
  active,
  onClick,
  color,
  role,
  symbol,
  rate,
  caption,
  chip,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  role: string;
  symbol: string;
  rate: string;
  caption: string;
  chip?: string;
}) {
  const side = active ? color : palette.queraPurpleSoft;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        textAlign: "start",
        background: active ? `${color}14` : palette.bgInset,
        borderStyle: "solid",
        borderColor: `${color} ${side} ${side} ${side}`,
        borderWidth: "3px 1px 1px 1px",
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        color: palette.textPrimary,
        transition: "all 150ms ease",
        boxShadow: active ? `0 0 0 1px ${color}55, 0 6px 22px ${color}22` : "none",
        display: "grid",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }} dir="rtl">
        <span style={{ fontSize: 13, color: palette.textSecondary, fontWeight: 600 }}>{role}</span>
        {chip && (
          <span
            style={{
              fontSize: 11.5,
              padding: "1px 7px",
              borderRadius: 999,
              border: `1px solid ${color}88`,
              color,
            }}
          >
            {chip}
          </span>
        )}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, color, fontFeatureSettings: TABULAR }}>
        {symbol}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 15, color: palette.textPrimary, fontFeatureSettings: TABULAR }}>
        {rate}
      </div>
      <div style={{ fontSize: 13, color: palette.textMuted }} dir="rtl">
        {caption}
      </div>
      <div style={{ fontSize: 12, color: active ? color : palette.textMuted, marginTop: 2 }} dir="rtl">
        {active ? "● מוצג על F למטה" : "○ הצג על F"}
      </div>
    </button>
  );
}

// --------------------------------------------------------------------------- //
// Certificate view — F with the certificate drawn on it + the TDMA frame
// --------------------------------------------------------------------------- //

function CertificateView({
  bounds,
  f,
  view,
  activeSlot,
  onSlotChange,
  linkLabel,
}: {
  bounds: ThroughputBounds;
  f: GraphDTO;
  view: BoundsView;
  activeSlot: number | null;
  onSlotChange: (i: number | null) => void;
  linkLabel?: (id: number) => string;
}) {
  const slots = useMemo(() => slotsForView(bounds, view), [bounds, view]);
  const color = VIEW_COLOR[view];
  const fullPalette = slots.length <= SLOT_PALETTE.length;
  const slotColor = (i: number) => (fullPalette ? SLOT_PALETTE[i] : color);
  // With many slots, default to showing the first one rather than a wash of one color.
  const shownSlot = activeSlot ?? (view !== "clique" && !fullPalette ? 0 : null);

  const highlight = useMemo(() => {
    if (shownSlot !== null && slots[shownSlot]) return new Set(slots[shownSlot].links);
    if (view === "clique") return new Set(bounds.max_clique);
    return new Set<number>();
  }, [view, bounds, shownSlot, slots]);

  // Full coloring on F only when no single slot is focused and hues suffice.
  const nodeColor = useMemo(() => {
    if (view !== "coloring" || shownSlot !== null || !fullPalette) return undefined;
    const c = bounds.coloring;
    return (id: number) => (c[id] !== undefined ? SLOT_PALETTE[c[id]] : undefined);
  }, [view, shownSlot, fullPalette, bounds]);

  const label = (v: number) => linkLabel?.(v) ?? String(v);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
      <div>
        <div style={{ fontSize: 14, color: palette.textSecondary, marginBottom: 8 }}>
          <b style={{ color }}>{viewTitle(view)}</b> — {viewHint(view, bounds)}
        </div>
        <GraphView
          graph={f}
          mode="geometric"
          highlight={highlight}
          highlightColor={shownSlot !== null ? slotColor(shownSlot) : color}
          emphasizeHighlightedEdges={view === "clique" && shownSlot === null}
          nodeColor={nodeColor}
          caption="F  (conflict graph)"
          width={620}
          height={440}
          nodeLabel={linkLabel}
        />
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <TdmaFrame
          slots={slots}
          view={view}
          shownSlot={shownSlot}
          onSlotChange={onSlotChange}
          slotColor={slotColor}
          label={label}
        />
        <ViewExplanation bounds={bounds} view={view} />
      </div>
    </div>
  );
}

function viewTitle(view: BoundsView): string {
  if (view === "coloring") return "צביעה של F";
  if (view === "lp") return "לוח זמנים אופטימלי (LP)";
  return "קליקה מקסימלית ב-F";
}

function viewHint(view: BoundsView, b: ThroughputBounds): string {
  if (view === "coloring")
    return `${b.chi} צבעים; קישורים באותו צבע לא מתנגשים ולכן משדרים יחד.`;
  if (view === "lp") return "לחץ על חלון במסגרת כדי לראות אילו קישורים משדרים בו.";
  return `${b.omega} קישורים שכל זוג מהם מתנגש — רק אחד יכול לשדר בכל רגע.`;
}

function TdmaFrame({
  slots,
  view,
  shownSlot,
  onSlotChange,
  slotColor,
  label,
}: {
  slots: TimeShareSlot[];
  view: BoundsView;
  shownSlot: number | null;
  onSlotChange: (i: number | null) => void;
  slotColor: (i: number) => string;
  label: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const focus = hover ?? shownSlot;
  return (
    <div
      style={{
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 14,
          color: palette.textSecondary,
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 600, color: palette.textPrimary }}>
          {view === "clique" ? "מסגרת זמן לקישורי הקליקה" : "מסגרת TDMA אחת"}
        </span>
        <span dir="ltr" style={{ fontFamily: MONO, fontSize: 12.5 }}>
          {slots.length} slots
        </span>
      </div>

      <div dir="ltr" style={{ display: "flex", gap: 2, height: 40 }}>
        {slots.map((s, i) => {
          const c = slotColor(i);
          const on = focus === i;
          const dim = focus !== null && !on;
          return (
            <button
              key={i}
              onClick={() => onSlotChange(shownSlot === i ? null : i)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              title={`S${i + 1} · ${(s.fraction * 100).toFixed(1)}% · ${s.links.map(label).join(", ")}`}
              style={{
                flex: `${s.fraction} 0 0`,
                minWidth: 3,
                border: "none",
                padding: 0,
                borderRadius: 4,
                background: c,
                opacity: dim ? 0.3 : on ? 1 : 0.75,
                cursor: "pointer",
                color: "#0a0f1e",
                fontFamily: MONO,
                fontSize: 12,
                fontWeight: 700,
                overflow: "hidden",
                whiteSpace: "nowrap",
                boxShadow: on ? `0 0 0 2px ${palette.bgInset}, 0 0 0 3px ${c}` : "none",
                transition: "opacity 120ms ease",
              }}
            >
              {s.fraction >= 0.07 ? `S${i + 1}` : ""}
            </button>
          );
        })}
      </div>
      <div dir="ltr" style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: palette.textMuted, fontFamily: MONO, marginTop: 4 }}>
        <span>t = 0</span>
        <span>t = 1 frame</span>
      </div>

      <div style={{ marginTop: 10, maxHeight: 190, overflowY: "auto", display: "grid", gap: 3 }} dir="ltr">
        {slots.map((s, i) => {
          const on = focus === i;
          return (
            <div
              key={i}
              onClick={() => onSlotChange(shownSlot === i ? null : i)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 64px 1fr",
                gap: 10,
                alignItems: "center",
                padding: "3px 8px",
                borderRadius: 6,
                background: on ? `${slotColor(i)}1f` : "transparent",
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 13.5,
                fontFeatureSettings: TABULAR,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: palette.textPrimary }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: slotColor(i) }} />
                S{i + 1}
              </span>
              <span style={{ color: palette.textSecondary, textAlign: "right" }}>
                {(s.fraction * 100).toFixed(1)}%
              </span>
              <span style={{ color: palette.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.links.map(label).join("  ")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ViewExplanation({ bounds, view }: { bounds: ThroughputBounds; view: BoundsView }) {
  const box: React.CSSProperties = {
    fontSize: 14.5,
    lineHeight: 1.75,
    color: palette.textSecondary,
    padding: "10px 14px",
    borderInlineStart: `3px solid ${VIEW_COLOR[view]}`,
    background: `${VIEW_COLOR[view]}0d`,
    borderRadius: 6,
  };
  const m = (s: string) => (
    <span dir="ltr" style={{ fontFamily: MONO, color: palette.textPrimary }}>
      {s}
    </span>
  );
  if (view === "clique") {
    return (
      <div style={box}>
        <b style={{ color: palette.textPrimary }}>למה זה חסם עליון:</b> כל שני קישורים בקליקה מתנגשים,
        ולכן בכל רגע לכל היותר אחד מהם משדר. סכום חלקי הזמן שלהם הוא לכל היותר 1, כלומר{" "}
        {m(`${bounds.omega}·x ≤ 1`)}, ומכאן {m(`x ≤ 1/ω = ${fmtRate(bounds.upper_bound)}`)}. זהו{" "}
        <em>תנאי הכרחי</em>: אף לוח זמנים לא יכול לעבור אותו. כל קליקה נותנת חסם תקף; המקסימלית נותנת
        את ההדוק ביותר.
      </div>
    );
  }
  if (view === "coloring") {
    return (
      <div style={box}>
        <b style={{ color: palette.textPrimary }}>למה זה חסם תחתון:</b> כל מחלקת צבע היא קבוצה
        בלתי-תלויה, כלומר קישורים שיכולים לשדר יחד. מסגרת עם {bounds.chi} חלונות שווים, חלון לכל צבע,
        היא לוח זמנים חוקי שבו כל קישור מקבל {m(`1/${bounds.chi} = ${fmtRate(bounds.lower_bound)}`)}.
        זהו <em>תנאי מספיק</em>: הוכחה בבנייה שהקצב הזה בר-השגה. צביעה טובה יותר (פחות צבעים) הייתה
        מעלה את החסם.
      </div>
    );
  }
  if (allBoundsCoincide(bounds)) {
    return (
      <div style={box}>
        <b style={{ color: palette.textPrimary }}>אין צורך ב-LP:</b> הצביעה משתמשת ב-{bounds.chi} צבעים
        בדיוק כגודל הקליקה המקסימלית ({m(`ω = χ = ${bounds.omega}`)}). לכן לוח הזמנים של הצביעה כבר
        פוגע בחסם העליון ואין מה לשפר: {m(`x* = 1/${bounds.omega} = ${fmtRate(bounds.upper_bound)}`)}. כדי
        לראות את ה-LP עובד, צריך גרף שבו {m("ω < χ")}, למשל חור אי-זוגי כמו בדוגמת ה-Pentagon.
      </div>
    );
  }
  return (
    <div style={box}>
      <b style={{ color: palette.textPrimary }}>ה-LP:</b> {m("min Σ y_I  s.t.  Σ_{I∋ℓ} y_I ≥ 1")} —
      חלוקת זמן בין <em>כל</em> הקבוצות הבלתי-תלויות, לא רק מחלקות הצבע, עם חלונות לא שווים. נפתר
      ב-column generation: {bounds.lp_iterations} איטרציות, {bounds.lp_columns} עמודות. בכל איטרציה
      בעיית ה-pricing היא{" "}
      <b style={{ color: BOUND_COLORS.exact }}>MWIS עם המשתנים הדואליים כמשקלות</b> — בדיוק הבעיה
      שמערך אטומי Rydberg פותר (detuning שונה לכל אטום). כאן היא נפתרה קלאסית
      {bounds.exact_pricing ? " (branch-and-bound מדויק)" : " (היוריסטיקה חמדנית — F גדול)"}; זו נקודת
      החיבור להשוואה מול הצינור הקוונטי בשלב 8.
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Band over R' (on demand)
// --------------------------------------------------------------------------- //

function BandSection({
  manetGraph,
  conflictMode,
  interferenceRadius,
  onInterferenceRadiusChange,
}: {
  manetGraph: GraphDTO;
  conflictMode: ConflictMode;
  interferenceRadius: number;
  onInterferenceRadiusChange: (r: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sweep, setSweep] = useState<InterferenceSweepResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSweep(null);
    setErr(null);
  }, [manetGraph, conflictMode]);

  useEffect(() => {
    if (!open || sweep || loading) return;
    setLoading(true);
    api
      .conflictGraphSweep(manetGraph, undefined, conflictMode)
      .then(setSweep)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [open, sweep, loading, manetGraph, conflictMode]);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: `1px solid ${open ? palette.queraPurpleGlow : palette.queraPurpleSoft}`,
          background: open ? `${palette.queraPurple}55` : "transparent",
          color: open ? palette.textPrimary : palette.textSecondary,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        📈 {open ? "הסתר" : "הצג"} את החסמים כפונקציה של R'
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          {loading && <div style={{ color: palette.textMuted, fontSize: 13.5 }}>מריץ סוויפ על R'…</div>}
          {err && (
            <div style={{ color: palette.err, fontSize: 13.5 }} dir="ltr">
              {err}
            </div>
          )}
          {sweep && sweep.points === null && (
            <div style={{ color: palette.warn, fontSize: 13.5 }}>
              ל-F יש {sweep.n_links} קודקודים — מעל למקסימום ({sweep.max_links}) לסוויפ.
            </div>
          )}
          {sweep && sweep.points !== null && (
            <>
              {sweep.timed_out && (
                <div style={{ color: palette.warn, fontSize: 13.5, marginBottom: 6 }}>
                  הסוויפ נעצר מוקדם (נקודה אחת ארכה יותר מדי) — מוצגות {sweep.points.length} נקודות.
                </div>
              )}
              <div style={{ fontSize: 13.5, color: palette.textSecondary, marginBottom: 8 }}>
                ככל ש-R' גדל, יותר קישורים מתנגשים: הקליקות גדלות והחסמים יורדים. הרצועה הסגולה היא
                המקום שבו השיטה הקלאסית הפשוטה לא יודעת את התשובה המדויקת.
              </div>
              <BoundsBandChart
                points={sweep.points}
                currentR={interferenceRadius}
                onPick={onInterferenceRadiusChange}
                pixelWidth={1100}
                pixelHeight={240}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Info modal content
// --------------------------------------------------------------------------- //

function BoundsMath() {
  const m = (s: string) => (
    <span dir="ltr" style={{ fontFamily: MONO, color: palette.textPrimary }}>
      {s}
    </span>
  );
  return (
    <div style={{ fontSize: 15, lineHeight: 1.8 }}>
      <p style={{ marginTop: 0 }}>
        השאלה: כל קישור (קודקוד ב-F) צריך לקבל אותו קצב {m("x")}. מה ה-{m("x")} המקסימלי? זהו
        מקרה פרטי של ה-LP של Jain et al. (§4), עם דרישה אחידה ובלי מסלולים.
      </p>
      <p>
        {m("1/χ(F)  ≤  x* = 1/χ_f(F)  ≤  1/ω(F)")}
      </p>
      <ul style={{ paddingInlineStart: 20 }}>
        <li>
          <b>חסם עליון (קליקות):</b> רלקסציה. אילוץ {m("Σ_{ℓ∈C} x ≤ 1")} לכל קליקה הוא הכרחי אך לא
          מספיק, ולכן האופטימום שלו גבוה או שווה לאמת.
        </li>
        <li>
          <b>חסם תחתון (קבוצות בלתי-תלויות):</b> צמצום. משתמשים רק בחלק מהקבוצות הבלתי-תלויות (מחלקות
          הצבע), ולכן כל פתרון ניתן לביצוע אך ייתכן שלא אופטימלי.
        </li>
        <li>
          <b>ערך מדויק:</b> ה-LP על <em>כל</em> הקבוצות הבלתי-תלויות, {m("χ_f")} (המספר הכרומטי
          השברי). מספר הקבוצות אקספוננציאלי, ולכן מייצרים אותן לפי הצורך (column generation) — וכל
          עמודה חדשה היא פתרון של MWIS ממושקל.
        </li>
      </ul>
      <p style={{ marginBottom: 0 }}>
        כאשר {m("ω = χ")} (למשל גרפים מושלמים) שלושת החסמים מתלכדים. פער מופיע כשיש ב-F "חור אי-זוגי",
        כמו {m("C₅")} בדוגמת ה-Pentagon: {m("1/3 < 2/5 < 1/2")}.
      </p>
    </div>
  );
}
