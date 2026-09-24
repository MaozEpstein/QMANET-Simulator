/**
 * Small "i" button + modal for a short, focused explanation attached to one
 * specific piece of UI (e.g. one of several graph panels on the same page).
 * Same visual language as StagesInfoButton, just lighter — a single block
 * of text instead of a tabbed table/diagram.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { palette } from "../theme/palette";

export function InfoButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={title}
        title={title}
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: `1px solid ${palette.queraPurpleSoft}`,
          background: "transparent",
          color: palette.textSecondary,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontStyle: "italic",
          fontSize: 11,
          fontWeight: 600,
          lineHeight: "16px",
          padding: 0,
          cursor: "pointer",
          flexShrink: 0,
          transition: "all 120ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = palette.queraPurpleSoft;
          e.currentTarget.style.color = palette.queraPurpleGlow;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = palette.textSecondary;
        }}
      >
        i
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 5, 14, 0.78)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: palette.bgPanel,
              border: `1px solid ${palette.queraPurpleSoft}`,
              borderRadius: 14,
              padding: "26px 30px",
              maxWidth: "min(820px, 94vw)",
              width: "100%",
              boxShadow: `0 12px 60px ${palette.queraPurple}66`,
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 12,
                gap: 12,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: palette.textPrimary }}>
                {title}
              </h3>
              <button
                onClick={close}
                aria-label="סגור"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  border: `1px solid ${palette.queraPurpleSoft}`,
                  background: "transparent",
                  color: palette.textSecondary,
                  fontSize: 15,
                  cursor: "pointer",
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </header>
            <div style={{ fontSize: 30, color: palette.textSecondary, lineHeight: 1.6 }}>
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
