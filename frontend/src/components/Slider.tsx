import { palette } from "../theme/palette";

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 12,
        color: palette.textSecondary,
        minWidth: 160,
      }}
    >
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span
          dir="ltr"
          style={{
            fontFamily: "var(--font-mono)",
            color: palette.queraPurpleGlow,
          }}
        >
          {value}
          {unit ? ` ${unit}` : ""}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        dir="ltr"
        style={{ accentColor: palette.queraPurpleGlow }}
      />
    </label>
  );
}
