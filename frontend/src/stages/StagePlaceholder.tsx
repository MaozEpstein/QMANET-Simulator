import { Panel } from "../components/Panel";
import { palette } from "../theme/palette";

export function StagePlaceholder({ stage, eta }: { stage: string; eta: string }) {
  return (
    <Panel title={stage} subtitle={`בפיתוח · ${eta}`}>
      <div
        style={{
          padding: "40px 20px",
          textAlign: "center",
          color: palette.textMuted,
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>⧗</div>
        <div style={{ fontSize: 14 }}>שלב זה יבנה בהמשך לפי התוכנית.</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>
          ראו <span dir="ltr" className="mono">~/.claude/plans/declarative-dancing-brook.md</span>
        </div>
      </div>
    </Panel>
  );
}
