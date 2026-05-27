import { useState } from "react";
import { palette } from "../theme/palette";

interface Props {
  /** What changed upstream (Hebrew label), e.g. "הגרף". */
  upstreamLabel: string;
  /** Hebrew text for the action button, e.g. "הרץ embedding מחדש". */
  actionLabel: string;
  /** Fires when the user clicks the action button. */
  onAction: () => void;
}

/**
 * Yellow warning strip that appears at the top of a stage when its computed
 * result is older than the upstream data it depends on. Tells the user the
 * displayed results may be stale and offers a one-click re-run.
 *
 * Dismiss "✕" hides the banner for the current session only — it does NOT
 * mark the data as fresh. If the upstream changes again, the banner returns.
 */
export function StaleBanner({ upstreamLabel, actionLabel, onAction }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        marginBottom: 12,
        background: "rgba(255,181,71,0.12)",
        border: `1px solid ${palette.warn}`,
        borderRadius: 8,
        color: palette.warn,
        fontSize: 13,
      }}
    >
      <span>
        ⚠️ {upstreamLabel} השתנה אחרי הריצה האחרונה — התוצאות שמוצגות עשויות
        להיות לא עדכניות.
      </span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={onAction}
          style={{
            background: palette.warn,
            color: "#1a1108",
            border: "none",
            borderRadius: 6,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="הסתר"
          style={{
            background: "transparent",
            color: palette.warn,
            border: `1px solid ${palette.warn}`,
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
