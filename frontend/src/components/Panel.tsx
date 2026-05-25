import { useEffect, useState, type ReactNode } from "react";
import { palette } from "../theme/palette";

const COLLAPSE_EVENT = "qsim:panel-collapse";
const STORAGE_PREFIX = "qsim.panel.collapsed:";

/**
 * Read the collapsed state for a given key, defaulting to false. Wrapped in
 * try/catch because localStorage can throw in private-browsing mode.
 */
function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

/**
 * useCollapsibleState — shared collapsed flag across Panel instances that
 * pass the same `collapseGroup`. When a user toggles one "הסבר" panel, all
 * other panels in the same group flip too, so the preference applies across
 * the whole stage stepper without per-stage plumbing.
 */
function useCollapsibleState(
  group: string,
  defaultCollapsed: boolean,
): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + group);
      if (stored === null) return defaultCollapsed;
      return stored === "1";
    } catch {
      return defaultCollapsed;
    }
  });

  // Sync across instances within the tab — a CustomEvent is lighter than a
  // global store and matches how the rest of the app already wires light
  // cross-component signals (cf. usePipeline persistence).
  useEffect(() => {
    const onChange = (e: Event) => {
      const ev = e as CustomEvent<{ key: string; value: boolean }>;
      if (ev.detail.key === group) setCollapsed(ev.detail.value);
    };
    window.addEventListener(COLLAPSE_EVENT, onChange);
    return () => window.removeEventListener(COLLAPSE_EVENT, onChange);
  }, [group]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_PREFIX + group, next ? "1" : "0");
      } catch {
        /* ignore storage errors */
      }
      window.dispatchEvent(
        new CustomEvent(COLLAPSE_EVENT, { detail: { key: group, value: next } }),
      );
      return next;
    });
  };

  return [collapsed, toggle];
}

export function Panel({
  title,
  subtitle,
  children,
  right,
  collapsible = false,
  collapseGroup,
  defaultCollapsed = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
  /** When true, a chevron toggle appears in the header. */
  collapsible?: boolean;
  /** Panels sharing the same group toggle together (and persist across reloads).
   *  Default groups by title — explanation panels named "הסבר" share state. */
  collapseGroup?: string;
  defaultCollapsed?: boolean;
}) {
  const group = collapseGroup ?? title;
  const [collapsed, toggle] = useCollapsibleState(group, defaultCollapsed);
  const showToggle = collapsible;

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
          marginBottom: collapsed ? 0 : 14,
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          {showToggle && (
            <button
              onClick={toggle}
              aria-label={collapsed ? "expand" : "collapse"}
              style={{
                width: 22,
                height: 22,
                border: `1px solid ${palette.queraPurpleSoft}`,
                background: "transparent",
                borderRadius: 5,
                color: palette.textSecondary,
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "transform 150ms ease",
                transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              }}
            >
              ▾
            </button>
          )}
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
            {subtitle && !collapsed && (
              <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 3 }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
        {!collapsed && right}
      </header>
      {!collapsed && children}
    </section>
  );
}

// Exported helper so non-Panel components (e.g. a "hide all explanations"
// command palette item) can drive the same flag programmatically.
export function setPanelCollapsedGlobally(group: string, value: boolean): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + group, value ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent(COLLAPSE_EVENT, { detail: { key: group, value } }),
  );
}

export function isPanelCollapsed(group: string): boolean {
  return readCollapsed(group);
}
