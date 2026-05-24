/**
 * Reusable "Export JSON" button used by each stage panel.
 * Renders compact in the Panel's `right` slot.
 */

import { exportJSON } from "../lib/exportJson";
import { palette } from "../theme/palette";

interface Props {
  /** Base filename — a timestamp suffix is appended automatically. */
  filename: string;
  /** The data to serialize. `null` disables the button. */
  data: unknown;
  label?: string;
}

export function ExportButton({ filename, data, label = "Export JSON" }: Props) {
  const enabled = data != null;
  return (
    <button
      onClick={() => enabled && exportJSON(filename, data)}
      disabled={!enabled}
      title={enabled ? "Download a JSON snapshot of this stage" : "No data yet"}
      style={{
        padding: "6px 12px",
        background: enabled ? palette.bgInset : "transparent",
        color: enabled ? palette.queraPurpleGlow : palette.textMuted,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 6,
        fontSize: 11,
        fontFamily: "JetBrains Mono, monospace",
        cursor: enabled ? "pointer" : "not-allowed",
      }}
    >
      ⤓ {label}
    </button>
  );
}
