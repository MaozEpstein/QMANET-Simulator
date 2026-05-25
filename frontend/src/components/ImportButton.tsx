import { useRef, useState } from "react";
import { importJSON, type SavedGraph } from "../lib/savedGraphs";
import { palette } from "../theme/palette";

interface Props {
  /** Called with the freshly-saved graph after successful import. */
  onImported: (saved: SavedGraph) => void;
  label?: string;
}

/**
 * Reads a `.qsim.json` file, validates it, persists it to "הגרפים שלי",
 * and hands the result to the caller. Errors surface as a small inline
 * message that clears on the next attempt.
 */
export function ImportButton({ onImported, label = "Import JSON" }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setErr(null);
    try {
      const text = await file.text();
      const saved = importJSON(text);
      onImported(saved);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        onClick={() => fileRef.current?.click()}
        title="טען גרף מקובץ JSON (יישמר ב'הגרפים שלי' וייטען מיד לעורך)"
        style={{
          padding: "6px 12px",
          background: palette.bgInset,
          color: palette.queraPurpleGlow,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 6,
          fontSize: 11,
          fontFamily: "JetBrains Mono, monospace",
          cursor: "pointer",
        }}
      >
        ⤒ {label}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      {err && (
        <span
          role="alert"
          style={{ fontSize: 11, color: palette.err, maxWidth: 240 }}
          dir="ltr"
        >
          ⚠ {err}
        </span>
      )}
    </span>
  );
}
