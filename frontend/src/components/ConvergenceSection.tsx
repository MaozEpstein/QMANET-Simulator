/**
 * "Bounds vs. Effort" section of the throughput-bounds panel: fetches the
 * column-generation trace, renders ConvergenceChart, and adds the controls —
 * x-axis (oracle calls / runtime), start (from zero like the paper / from
 * the coloring), and step-by-step playback that highlights each added
 * independent set on F.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api/rest";
import type { ConvergenceResponse, ConvergenceStart, GraphDTO } from "../api/rest";
import { palette } from "../theme/palette";
import { BOUND_COLORS } from "./BoundsBandChart";
import { ConvergenceChart, type EffortAxis } from "./ConvergenceChart";
import { InfoButton } from "./InfoButton";

const MONO = "var(--font-mono)";
const TABULAR = '"tnum" 1, "zero" 1';

interface Props {
  f: GraphDTO;
  linkLabel?: (id: number) => string;
  /** Highlight an independent set on F (null clears). */
  onFocusSet: (focus: { links: number[]; label: string } | null) => void;
}

export function ConvergenceSection({ f, linkLabel, onFocusSet }: Props) {
  const [axis, setAxis] = useState<EffortAxis>("calls");
  const [start, setStart] = useState<ConvergenceStart>("singletons");
  const [res, setRes] = useState<ConvergenceResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reveal, setReveal] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const reqId = useRef(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(wrapRef);

  useEffect(() => {
    const id = ++reqId.current;
    setRes(null);
    setErr(null);
    setReveal(null);
    setPlaying(false);
    setSelected(null);
    setLoading(true);
    api
      .throughputConvergence(f, start)
      .then((r) => id === reqId.current && setRes(r))
      .catch((e: Error) => id === reqId.current && setErr(e.message))
      .finally(() => id === reqId.current && setLoading(false));
  }, [f, start]);

  const points = res?.points ?? null;
  const n = points?.length ?? 0;

  const focusPoint = (idx: number | null) => {
    setSelected(idx);
    const p = idx !== null && points ? points[idx] : null;
    onFocusSet(
      p?.added ? { links: p.added, label: `הקבוצה שנוספה בפנייה #${p.calls} ל-MWIS` } : null,
    );
  };

  // Playback: reveal one oracle call at a time and follow it on F.
  useEffect(() => {
    if (!playing || !points) return;
    const cur = reveal ?? 1;
    if (cur >= n) {
      setPlaying(false);
      return;
    }
    const delay = Math.max(90, Math.min(420, 4200 / n));
    const t = setTimeout(() => {
      setReveal(cur + 1);
      focusPoint(cur);
    }, delay);
    return () => clearTimeout(t);
    // focusPoint is stable enough for playback; omitting it avoids restarting the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, reveal, n, points]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (reveal === null || reveal >= n) {
      setReveal(1);
      focusPoint(0);
    }
    setPlaying(true);
  };

  const shownCount = reveal ?? n;

  return (
    <div
      style={{
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 12,
        padding: "16px 20px 14px",
        display: "grid",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15.5, fontWeight: 700, color: palette.textPrimary }}>
              התכנסות החסמים לפי Effort
            </span>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                border: `1px solid ${palette.queraPurpleSoft}`,
                color: palette.textSecondary,
              }}
              dir="ltr"
            >
              Jain et al. · Fig 5
            </span>
            <InfoButton title="מה רואים בתרשים ההתכנסות">
              <ConvergenceInfo />
            </InfoButton>
          </div>
          <div style={{ fontSize: 13, color: palette.textMuted, marginTop: 4 }}>
            כל נקודה = פנייה אחת לפותר ה-MWIS. כל קבוצה בלתי-תלויה שנמצאת מעלה את החסם התחתון; כשהפותר
            המדויק רץ, גם החסם העליון יורד — עד שהם נפגשים.
          </div>
        </div>
        {res?.points && <StatusChip res={res} />}
      </div>

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
        <Segmented
          label="ציר X"
          value={axis}
          onChange={(v) => setAxis(v as EffortAxis)}
          options={[
            { id: "calls", label: "פניות ל-MWIS" },
            { id: "time", label: "זמן ריצה" },
          ]}
        />
        <Segmented
          label="התחלה"
          value={start}
          onChange={(v) => setStart(v as ConvergenceStart)}
          options={[
            { id: "singletons", label: "מאפס · כמו במאמר" },
            { id: "coloring", label: "מהצביעה" },
          ]}
        />
        {points && n > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginInlineStart: "auto" }}>
            <button onClick={togglePlay} style={playBtn(playing)}>
              {playing ? "❚❚ השהה" : reveal !== null && reveal < n ? "▶ המשך" : "▶ הפעל צעד-צעד"}
            </button>
            <input
              type="range"
              min={1}
              max={n}
              value={shownCount}
              onChange={(e) => {
                const v = Number(e.target.value);
                setPlaying(false);
                setReveal(v === n ? null : v);
                focusPoint(v - 1);
              }}
              aria-label="מספר פניות מוצגות"
              style={{ width: 170, accentColor: BOUND_COLORS.exact }}
            />
            <span dir="ltr" style={{ fontFamily: MONO, fontSize: 12.5, color: palette.textSecondary, minWidth: 64, fontFeatureSettings: TABULAR }}>
              {points[shownCount - 1].calls}/{points[n - 1].calls} calls
            </span>
            {(reveal !== null || selected !== null) && (
              <button
                onClick={() => {
                  setPlaying(false);
                  setReveal(null);
                  focusPoint(null);
                }}
                style={ghostBtn}
              >
                ↺ הצג הכל
              </button>
            )}
          </div>
        )}
      </div>

      <Legend />

      <div ref={wrapRef} style={{ minHeight: 320 }}>
        {loading && <div style={{ color: palette.textMuted, fontSize: 13.5 }}>מריץ column generation…</div>}
        {err && (
          <div style={{ color: palette.err, fontSize: 13 }} dir="ltr">
            {err}
          </div>
        )}
        {res && res.points === null && (
          <div style={{ color: palette.warn, fontSize: 13.5 }}>
            ל-F יש {res.n_vertices} קודקודים — מעל למקסימום ({res.max_vertices}) לתרשים ההתכנסות.
          </div>
        )}
        {points && res?.omega && width > 0 && (
          <ConvergenceChart
            points={points}
            omega={res.omega}
            axis={axis}
            revealCount={shownCount}
            selectedIdx={selected !== null && selected < shownCount ? selected : null}
            onSelect={focusPoint}
            certified={res.certified}
            linkLabel={linkLabel}
            pixelWidth={Math.max(560, width)}
            pixelHeight={330}
          />
        )}
      </div>

      {points && res && <Stats res={res} />}
      <div style={{ fontSize: 12, color: palette.textMuted }}>
        יחידת ה-Effort כאן היא פנייה לפותר ה-MWIS — אותה יחידה גם לפותר קלאסי וגם למערך Rydberg, ולכן
        היא הבסיס להשוואה בשלב 8. היא אינה זהה ליחידה שבמאמר, אבל צורת העקומה ברת-השוואה.
      </div>
    </div>
  );
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setW(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function StatusChip({ res }: { res: ConvergenceResponse }) {
  const pts = res.points!;
  const last = pts[pts.length - 1];
  const ok = res.certified;
  const color = ok ? palette.ok : palette.warn;
  const reason: Record<string, string> = {
    optimal: "אופטימום הוכח",
    no_improving_column: "נעצר — הפותר החמדני לא מצא שיפור (F גדול, ללא הוכחה)",
    time_budget: "נעצר — תקציב זמן",
    iteration_cap: "נעצר — מגבלת פניות",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 999,
        background: `${color}14`,
        border: `1px solid ${color}66`,
        color,
        fontSize: 13,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <span>{ok ? "✓" : "⏸"}</span>
      <span>{reason[res.stop_reason ?? ""] ?? res.stop_reason}</span>
      <span dir="ltr" style={{ fontFamily: MONO, color: palette.textSecondary, fontFeatureSettings: TABULAR }}>
        {last.calls} calls · {last.time_ms < 10 ? last.time_ms.toFixed(1) : Math.round(last.time_ms)} ms
      </span>
    </div>
  );
}

function Stats({ res }: { res: ConvergenceResponse }) {
  const pts = res.points!;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const gap0 = first.upper - first.lower;
  const closed = gap0 > 1e-12 ? (1 - (last.upper - last.lower) / gap0) * 100 : 100;
  const exactCalls = pts.filter((p) => p.pricer === "exact").length;
  const items: [string, string, string][] = [
    ["חסם תחתון בהתחלה", first.lower.toFixed(3), BOUND_COLORS.lower],
    ["חסם תחתון בסוף", last.lower.toFixed(3), BOUND_COLORS.lower],
    ["חסם עליון בסוף", last.upper.toFixed(3), BOUND_COLORS.upper],
    ["פער שנסגר", `${closed.toFixed(0)}%`, closed >= 99.9 ? palette.ok : palette.textPrimary],
    ["פניות (מדויק / חמדני)", `${exactCalls} / ${last.calls - exactCalls}`, palette.textPrimary],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
      {items.map(([k, v, c]) => (
        <div
          key={k}
          style={{
            background: palette.bgPanel,
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 9,
            padding: "8px 12px",
          }}
        >
          <div style={{ fontSize: 12, color: palette.textMuted }}>{k}</div>
          <div
            dir="ltr"
            style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600, color: c, marginTop: 2, textAlign: "right", fontFeatureSettings: TABULAR }}
          >
            {v}
          </div>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  const item = (swatch: React.ReactNode, text: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      {swatch}
      {text}
    </span>
  );
  const line = (color: string, dashed = false, w = 2.5) => (
    <span style={{ width: 20, height: 0, borderTop: `${w}px ${dashed ? "dashed" : "solid"} ${color}` }} />
  );
  return (
    <div
      dir="ltr"
      style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: 12.5, color: palette.textSecondary }}
    >
      {item(line(BOUND_COLORS.upper), "1/ω · clique bound")}
      {item(line(BOUND_COLORS.upper, true), "Lagrangian upper bound")}
      {item(line(BOUND_COLORS.lower), "LP lower bound 1/z")}
      {item(
        <span style={{ width: 16, height: 11, borderRadius: 2, background: `linear-gradient(${BOUND_COLORS.upper}33, ${BOUND_COLORS.lower}33)` }} />,
        "gap",
      )}
      {item(<span style={{ width: 9, height: 9, borderRadius: "50%", background: BOUND_COLORS.lower }} />, "greedy oracle")}
      {item(
        <span style={{ width: 9, height: 9, transform: "rotate(45deg)", border: `2px solid ${BOUND_COLORS.exact}` }} />,
        "exact oracle (B&B)",
      )}
    </div>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 13, color: palette.textSecondary, fontWeight: 600 }}>{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        style={{
          display: "flex",
          gap: 3,
          padding: 3,
          background: palette.bgPanel,
          borderRadius: 9,
          border: `1px solid ${palette.queraPurpleSoft}`,
        }}
      >
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.id)}
              style={{
                padding: "6px 13px",
                border: "none",
                borderRadius: 7,
                background: active ? palette.queraPurple : "transparent",
                color: active ? "#fff" : palette.textSecondary,
                fontWeight: active ? 600 : 400,
                fontSize: 13,
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: "6px 11px",
  borderRadius: 8,
  border: `1px solid ${palette.queraPurpleSoft}`,
  background: "transparent",
  color: palette.textSecondary,
  fontSize: 12.5,
  cursor: "pointer",
};

function playBtn(playing: boolean): React.CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 8,
    border: `1px solid ${BOUND_COLORS.exact}`,
    background: playing ? `${BOUND_COLORS.exact}22` : palette.queraPurple,
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    minWidth: 128,
  };
}

function ConvergenceInfo() {
  return (
    <div style={{ fontSize: 15, lineHeight: 1.8 }}>
      <p style={{ marginTop: 0 }}>
        זהו שחזור של Fig 5 במאמר של Jain et al., מחושב בזמן אמת. ה-LP מתחיל עם מעט קבוצות
        בלתי-תלויות ובכל צעד שואל את פותר ה-MWIS: &quot;איזו קבוצה הכי משתלם להוסיף?&quot; (המשקלות
        הם המשתנים הדואליים — כמה כל קישור חסר זמן שידור).
      </p>
      <ul style={{ paddingInlineStart: 20 }}>
        <li>
          <b>חסם תחתון (תכלת):</b> הקצב שלוח הזמנים הנוכחי כבר מבטיח. עולה בכל פעם שנוספת קבוצה.
        </li>
        <li>
          <b>1/ω (כתום רציף):</b> חסם הקליקה — קבוע, כמו במאמר.
        </li>
        <li>
          <b>חסם עליון Lagrangian (כתום מקווקו):</b> בכל פעם שהפותר <em>המדויק</em> רץ (מעוין סגול), ערך
          ה-MWIS שהוא מוצא מוכיח חסם עליון חדש. כשהוא נפגש עם התחתון — הוכחנו אופטימום.
        </li>
      </ul>
      <p style={{ marginBottom: 0 }}>
        <b>ציר X:</b> &quot;פניות ל-MWIS&quot; זהה בקלאסי ובקוונטי ולכן הוגן להשוואה. &quot;זמן ריצה&quot;
        מראה איפה הזמן באמת הולך — פניות מדויקות יקרות יותר מחמדניות.
      </p>
    </div>
  );
}
