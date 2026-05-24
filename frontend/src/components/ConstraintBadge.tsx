/**
 * Inline badge for Aquila constraint violations.
 * Shows the code in Hebrew with the measured/limit numeric values in LTR.
 */

import { palette } from "../theme/palette";
import type { ViolationDTO } from "../api/rest";

const HE_BY_CODE: Record<string, string> = {
  too_many_atoms: "יותר מדי אטומים",
  width_exceeded: "חריגה ברוחב האזור",
  height_exceeded: "חריגה בגובה האזור",
  site_too_close: "מרחק בין אטומים קטן מהמינימום",
  row_too_close: "שורות קרובות מדי",
  position_negative: "קואורדינטה שלילית",
  duplicate_position: "אטומים על אותה נקודה",
  rabi_exceeds_max: "Rabi מעל המקסימום",
  rabi_negative: "Rabi שלילי",
  slew_rate_exceeded: "שינוי Ω מהיר מדי",
  detuning_out_of_range: "Detuning מחוץ לטווח",
  duration_exceeded: "משך אבולוציה מעבר ל-4µs",
};

export function ConstraintBadge({ violation }: { violation: ViolationDTO }) {
  const label = HE_BY_CODE[violation.code] ?? violation.code;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "rgba(255,84,112,0.08)",
        border: `1px solid ${palette.err}`,
        borderRadius: 8,
        fontSize: 12,
      }}
      role="alert"
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          background: palette.err,
          color: "#fff",
          borderRadius: "50%",
          fontWeight: 700,
        }}
      >
        !
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ color: palette.err, fontWeight: 600 }}>{label}</div>
        <div style={{ color: palette.textSecondary, marginTop: 2 }} dir="ltr">
          {violation.measured.toFixed(3)} vs limit {violation.limit.toFixed(3)}
          {" · "}
          {violation.message}
        </div>
      </div>
    </div>
  );
}

export function ConstraintSummary({ violations }: { violations: ViolationDTO[] }) {
  if (violations.length === 0) {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          background: "rgba(61,220,151,0.1)",
          border: `1px solid ${palette.ok}`,
          color: palette.ok,
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        ✓ עומד באילוצי Aquila
      </div>
    );
  }
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: "rgba(255,84,112,0.1)",
        border: `1px solid ${palette.err}`,
        color: palette.err,
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      ✕ {violations.length} הפרות
    </div>
  );
}
