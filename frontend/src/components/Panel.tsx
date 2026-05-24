import type { ReactNode } from "react";
import { palette } from "../theme/palette";

export function Panel({
  title,
  subtitle,
  children,
  right,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section
      style={{
        background: palette.bgPanel,
        borderRadius: 14,
        border: `1px solid ${palette.queraPurpleSoft}`,
        padding: "18px 22px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: palette.textPrimary,
            }}
          >
            {title}
          </h2>
          {subtitle && (
            <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 3 }}>
              {subtitle}
            </div>
          )}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}
