import type { ReactNode } from "react";
import { palette } from "../theme/palette";

export type UdgBannerKind = "found" | "not_found" | "impossible" | "unknown";

const TONE: Record<UdgBannerKind, { color: string; icon: string; title: string }> = {
  found: { color: palette.ok, icon: "✓", title: "F ניתן להטמעה כגרף unit-disk" },
  not_found: { color: palette.warn, icon: "?", title: "לא נמצאה הטמעה מדויקת" },
  impossible: { color: palette.err, icon: "✗", title: "F אינו UDG — לא ניתן להריץ אותו על Aquila" },
  unknown: { color: palette.textSecondary, icon: "·", title: "לא נפסל — ייתכן שניתן להטמעה" },
};

/**
 * Verdict banner for the "can this conflict graph run on the quantum computer"
 * question. Shared by Stage 2 (cheap certificate check → impossible/unknown)
 * and Stage 3 (placement search → found/not_found/impossible).
 */
export function UdgVerdictBanner({
  kind,
  reason,
  children,
}: {
  kind: UdgBannerKind;
  reason?: string;
  children?: ReactNode;
}) {
  const tone = TONE[kind];
  return (
    <div
      role="status"
      style={{
        padding: "10px 14px",
        background: `${tone.color}15`,
        border: `1px solid ${tone.color}66`,
        borderRadius: 8,
        fontSize: 12,
        color: palette.textPrimary,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <span style={{ fontSize: 16, color: tone.color, lineHeight: 1.2 }}>{tone.icon}</span>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontWeight: 600, color: tone.color }}>{tone.title}</div>
        {reason && <div style={{ color: palette.textSecondary, lineHeight: 1.5 }}>{reason}</div>}
        {children}
      </div>
    </div>
  );
}
