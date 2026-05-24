import { useEffect, useState } from "react";
import { api, type AquilaSpec } from "./api/rest";
import { Stage1_MANET } from "./stages/Stage1_MANET";
import { Stage2_Complement } from "./stages/Stage2_Complement";
import { StagePlaceholder } from "./stages/StagePlaceholder";
import { STAGES, usePipeline, type StageId } from "./store/pipeline";
import { palette } from "./theme/palette";

export function App() {
  const { currentStage, setStage } = usePipeline();
  const [spec, setSpec] = useState<AquilaSpec | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .aquila()
      .then(setSpec)
      .catch((e: Error) => setErr(e.message));
  }, []);

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
        {err && <BackendError msg={err} />}
        {!err && <StageBody stage={currentStage} />}
      </main>
      <Footer spec={spec} />
    </div>
  );
}

function StageBody({ stage }: { stage: StageId }) {
  switch (stage) {
    case "manet":
      return <Stage1_MANET />;
    case "complement":
      return <Stage2_Complement />;
    case "embedding":
      return <StagePlaceholder stage="שלב 3 · השמת אטומים" eta="Phase 2 בתוכנית" />;
    case "schedule":
      return <StagePlaceholder stage="שלב 4 · פולס אדיאבטי" eta="Phase 3 בתוכנית" />;
    case "evolution":
      return <StagePlaceholder stage="שלב 5 · אבולוציה אדיאבטית" eta="Phase 4 בתוכנית" />;
    case "measurement":
      return <StagePlaceholder stage="שלב 6 · מדידה" eta="Phase 5 בתוכנית" />;
    case "postprocess":
      return <StagePlaceholder stage="שלב 7 · תיקון Post-process" eta="Phase 5 בתוכנית" />;
    case "routing":
      return <StagePlaceholder stage="שלב 8 · ניתוב MANET" eta="Phase 6 בתוכנית" />;
  }
}

function BackendError({ msg }: { msg: string }) {
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
      <div style={{ fontSize: 12, color: palette.textSecondary }} dir="ltr">
        v0.1.0 · Bloqade + QuTiP
      </div>
    </header>
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
