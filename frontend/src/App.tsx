import { useCallback, useEffect, useState } from "react";
import { api, type AquilaSpec } from "./api/rest";
import { StageErrorBoundary } from "./components/StageErrorBoundary";
import { ExamplesButton } from "./components/ExamplesButton";
import { StagesInfoButton } from "./components/StagesInfoButton";
import { Stage1_MANET } from "./stages/Stage1_MANET";
import { Stage2_Complement } from "./stages/Stage2_Complement";
import { Stage3_Embedding } from "./stages/Stage3_Embedding";
import { Stage4_Schedule } from "./stages/Stage4_Schedule";
import { Stage5_Evolution } from "./stages/Stage5_Evolution";
import { Stage6_Measurement } from "./stages/Stage6_Measurement";
import { Stage7_PostProcess } from "./stages/Stage7_PostProcess";
import { Stage8_Routing } from "./stages/Stage8_Routing";
import { STAGES, usePipeline, type StageId } from "./store/pipeline";
import { palette } from "./theme/palette";

export function App() {
  const { currentStage, setStage } = usePipeline();
  const [spec, setSpec] = useState<AquilaSpec | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchSpec = useCallback(() => {
    api
      .aquila()
      .then((s) => {
        setSpec(s);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(() => {
    fetchSpec();
  }, [fetchSpec]);

  // Auto-retry every 3s while disconnected so the UI recovers automatically
  // when the dev server bounces (common during Phase development).
  useEffect(() => {
    if (!err) return;
    const id = window.setInterval(fetchSpec, 3000);
    return () => window.clearInterval(id);
  }, [err, fetchSpec]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Header />
      <StageStepper current={currentStage} onPick={setStage} />
      <main
        style={{
          flex: 1,
          padding: "24px 32px",
          overflow: "auto",
          background: palette.bgDeep,
        }}
      >
        {err && <BackendError msg={err} onRetry={fetchSpec} />}
        {!err && <StageBody stage={currentStage} />}
      </main>
      <Footer spec={spec} />
    </div>
  );
}

function StageBody({ stage }: { stage: StageId }) {
  const stageMeta = STAGES.find((s) => s.id === stage)!;
  // key=stage so navigating away resets the error boundary on the previous stage
  return (
    <StageErrorBoundary key={stage} stageName={stageMeta.he}>
      {renderStage(stage)}
    </StageErrorBoundary>
  );
}

function renderStage(stage: StageId) {
  switch (stage) {
    case "manet":
      return <Stage1_MANET />;
    case "complement":
      return <Stage2_Complement />;
    case "embedding":
      return <Stage3_Embedding />;
    case "schedule":
      return <Stage4_Schedule />;
    case "evolution":
      return <Stage5_Evolution />;
    case "measurement":
      return <Stage6_Measurement />;
    case "postprocess":
      return <Stage7_PostProcess />;
    case "routing":
      return <Stage8_Routing />;
  }
}

function BackendError({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div
      style={{
        background: palette.bgPanel,
        border: `1px solid ${palette.err}`,
        borderRadius: 12,
        padding: 20,
      }}
    >
      <h2 style={{ margin: "0 0 10px", color: palette.err, fontSize: 16 }}>
        אין חיבור ל-backend
      </h2>
      <div style={{ color: palette.textMuted, fontSize: 13 }}>
        ודאו ש-<span className="mono" dir="ltr">uvicorn api.server:app --port 8000</span> רץ.
      </div>
      <div style={{ color: palette.err, fontSize: 12, marginTop: 6 }} dir="ltr">
        {msg}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 14,
        }}
      >
        <button
          onClick={onRetry}
          style={{
            padding: "8px 16px",
            background: palette.queraPurple,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ↻ נסה שוב
        </button>
        <span style={{ color: palette.textMuted, fontSize: 11 }}>
          ניסיון אוטומטי כל 3 שניות…
        </span>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header
      style={{
        padding: "14px 28px",
        background: palette.bgPanel,
        borderBottom: `1px solid ${palette.queraPurpleSoft}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${palette.queraPurpleGlow} 0%, ${palette.queraPurple} 60%, transparent 100%)`,
            boxShadow: `0 0 20px ${palette.queraPurpleGlow}`,
          }}
        />
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Qsimulator</div>
          <div style={{ fontSize: 12, color: palette.textMuted }}>
            Neutral-Atom Routing · MANET → MIS → Aquila
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <ExamplesButton />
        <ResetPipelineButton />
        <div style={{ fontSize: 12, color: palette.textSecondary }} dir="ltr">
          v0.1.0 · Bloqade + QuTiP
        </div>
      </div>
    </header>
  );
}

function ResetPipelineButton() {
  return (
    <button
      onClick={() => {
        if (!window.confirm("לאפס את כל הצינור (גרף + תוצאות)?")) return;
        // Wipe the persisted store and reload fresh.
        try {
          window.localStorage.removeItem("qsim.pipeline.v1");
        } catch {
          /* private mode etc — nothing to clear */
        }
        window.location.reload();
      }}
      title="מוחק את הגרף הפעיל ואת כל התוצאות בכל השלבים (לא נוגע ב'הגרפים שלי')"
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        border: `1px solid ${palette.queraPurpleSoft}`,
        background: "transparent",
        color: palette.textSecondary,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      ♻ אפס צינור
    </button>
  );
}

function StageStepper({
  current,
  onPick,
}: {
  current: StageId;
  onPick: (s: StageId) => void;
}) {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "10px 28px",
        background: palette.bgPanelElevated,
        borderBottom: `1px solid ${palette.queraPurpleSoft}`,
        overflowX: "auto",
      }}
    >
      {STAGES.map((s, i) => {
        const active = s.id === current;
        return (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            style={{
              padding: "8px 14px",
              border: "none",
              borderRadius: 8,
              background: active ? palette.queraPurple : "transparent",
              color: active ? "#fff" : palette.textSecondary,
              fontWeight: active ? 600 : 400,
              fontSize: 13,
              whiteSpace: "nowrap",
              transition: "all 160ms ease",
            }}
          >
            <span style={{ opacity: 0.6, marginInlineEnd: 6 }} dir="ltr">
              {i + 1}
            </span>
            {s.he}
            <span style={{ opacity: 0.5, marginInlineStart: 6, fontSize: 11 }} dir="ltr">
              · {s.label}
            </span>
          </button>
        );
      })}
      <StagesInfoButton />
    </nav>
  );
}

function Footer({ spec }: { spec: AquilaSpec | null }) {
  return (
    <footer
      style={{
        padding: "10px 28px",
        background: palette.bgPanel,
        borderTop: `1px solid ${palette.queraPurpleSoft}`,
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
        color: palette.textMuted,
      }}
    >
      <span>Maoz Epstein · Ori Kessous · Adi Pick PhD</span>
      <span dir="ltr">
        backend: {spec ? "🟢 connected" : "🟠 disconnected"}
        {spec && (
          <>
            {" · "}Ω≤{spec.max_rabi_rad_us} rad/µs · {spec.min_site_spacing_um}µm spacing
          </>
        )}
      </span>
    </footer>
  );
}
