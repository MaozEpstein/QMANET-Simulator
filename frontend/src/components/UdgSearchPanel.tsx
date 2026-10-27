import { useCallback, useState } from "react";
import { api, type EmbedConfigDTO, type GraphDTO } from "../api/rest";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";
import { UdgVerdictBanner } from "./UdgVerdictBanner";

// Budgets (seconds). The quick run solves every instance the benchmark could
// solve with a median < 1 s; "search more" is the cap for the rare hard one.
const QUICK_BUDGET_S = 5;
const LONG_BUDGET_S = 20;

export function graphKey(g: GraphDTO | null | undefined): string | null {
  return g ? `${g.n_nodes}:${g.edges.map((e) => `${e[0]}-${e[1]}`).join(",")}` : null;
}

/**
 * "Search for an exact UDG placement" — the button, verdict banner, "search
 * more" and "restore previous" controls. Shared by Stage 2 and Stage 3: both
 * read/write the same store fields, so a placement found in one stage is shown
 * (and can be undone) in the other.
 */
function useUdgSearch(targetGraph: GraphDTO | null, cfg: EmbedConfigDTO) {
  const embed = usePipeline((s) => s.embed);
  const setEmbed = usePipeline((s) => s.setEmbed);
  const udgResult = usePipeline((s) => s.udgResult);
  const udgKey = usePipeline((s) => s.udgKey);
  const udgBackup = usePipeline((s) => s.udgBackup);
  const setUdgResult = usePipeline((s) => s.setUdgResult);
  const setUdgBackup = usePipeline((s) => s.setUdgBackup);
  const [searching, setSearching] = useState(false);
  const [budget, setBudget] = useState(QUICK_BUDGET_S);
  const [err, setErr] = useState<string | null>(null);

  const key = graphKey(targetGraph);
  const udg = udgKey === key ? udgResult : null;
  const canRestore = udgKey === key && udgBackup !== null;

  const run = useCallback(
    async (b: number) => {
      if (!targetGraph || searching) return;
      setSearching(true);
      setBudget(b);
      setErr(null);
      try {
        const res = await api.embedUdg(targetGraph, cfg, b);
        // Remember what was on screen only the first time, so repeated
        // searches ("search more") still restore to the original state.
        if (res.embed && !canRestore) setUdgBackup({ embed });
        setUdgResult(res, key);
        // Best placement found (exact when found, best-effort when not); an
        // "impossible" verdict has none, so the current embedding stays.
        if (res.embed) setEmbed(res.embed);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setSearching(false);
      }
    },
    [targetGraph, cfg, searching, canRestore, embed, key, setEmbed, setUdgBackup, setUdgResult],
  );

  const restore = () => {
    if (!udgBackup) return;
    setEmbed(udgBackup.embed);
    setUdgBackup(null);
    setUdgResult(null, null);
  };

  return { udg, searching, budget, err, canRestore, run, restore, hasTarget: !!targetGraph };
}

type UdgSearch = ReturnType<typeof useUdgSearch>;

function Controls({ u, disabled }: { u: UdgSearch; disabled: boolean }) {
  const { searching, budget, canRestore, run, restore, hasTarget } = u;
  return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => run(QUICK_BUDGET_S)}
          disabled={disabled || searching || !hasTarget}
          title="מחפש הטמעה מדויקת (UDG): קודם תנאים הכרחיים שמוכיחים אי-אפשרות, ואז חיפוש מרובה-התחלות בכפוף לאילוצי Aquila (מרחק ≥ 4 µm, שורות, אזור 75×76)"
          style={{
            padding: "10px 14px",
            background: searching ? palette.bgInset : "transparent",
            color: palette.highlight,
            border: `1px solid ${palette.highlight}`,
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 12,
            cursor: searching ? "wait" : "pointer",
          }}
        >
          {searching ? `מחפש הטמעת UDG… (עד ${budget} שנ')` : "🔎 חפש הטמעת UDG מדויקת"}
        </button>
        {canRestore && !searching && (
          <button
            onClick={restore}
            title="מחזיר את ההשמה (והגרף המוצג) למצב שלפני חיפוש ה-UDG"
            style={{
              padding: "10px 14px",
              background: "transparent",
              color: palette.textSecondary,
              border: `1px solid ${palette.queraPurpleSoft}`,
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ↩ החזר למצב הקודם
          </button>
        )}
      </div>
  );
}

function Result({ u }: { u: UdgSearch }) {
  const { udg, searching, err, run } = u;
  return (
    <>
      {udg && !searching && (
        <UdgVerdictBanner kind={udg.verdict} reason={udg.reason}>
          {udg.verdict !== "impossible" && (
            <div style={{ color: palette.textMuted, fontSize: 11 }} dir="ltr">
              {udg.attempts} starts · {udg.elapsed_s.toFixed(1)}s · R_b ={" "}
              {udg.blockade_radius_um.toFixed(2)} µm
            </div>
          )}
          {udg.verdict === "not_found" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <button
                onClick={() => run(LONG_BUDGET_S)}
                style={{
                  padding: "4px 10px",
                  background: "transparent",
                  border: `1px solid ${palette.queraPurpleSoft}`,
                  borderRadius: 6,
                  color: palette.textSecondary,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                חפש עוד ({LONG_BUDGET_S} שנ')
              </button>
              <span style={{ color: palette.textMuted, fontSize: 11 }}>
                טיפ: Ω נמוך יותר מגדיל את R_b ומרחיב את מה שניתן להטמעה (שלב 3).
              </span>
            </div>
          )}
        </UdgVerdictBanner>
      )}
      {err && (
        <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
          {err}
        </div>
      )}
    </>
  );
}

/**
 * Shared by Stage 2 and Stage 3 (same store state, so a placement found in one
 * is shown and undoable in the other). 
 */
export function UdgSearchPanel({
  targetGraph,
  cfg,
  disabled = false,
}: {
  targetGraph: GraphDTO | null;
  cfg: EmbedConfigDTO;
  disabled?: boolean;
}) {
  const u = useUdgSearch(targetGraph, cfg);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Controls u={u} disabled={disabled} />
      <Result u={u} />
    </div>
  );
}

/** Buttons + result split for callers that lay them out separately. */
export function UdgSearchRow({
  targetGraph,
  cfg,
  left,
}: {
  targetGraph: GraphDTO | null;
  cfg: EmbedConfigDTO;
  left: React.ReactNode;
}) {
  const u = useUdgSearch(targetGraph, cfg);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        {left}
        <Controls u={u} disabled={false} />
      </div>
      <Result u={u} />
    </div>
  );
}
