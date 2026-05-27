/**
 * "Run on Aquila" panel — Phase 7 bridge UI.
 *
 * Shows the Braket payload that *would* be submitted, with cost / runtime
 * estimates, preflight constraint check, and a submit button. When the SDK
 * or AWS credentials aren't available, the submit returns {submitted:false,
 * message:...} which we render as a friendly explanation — so the user can
 * still inspect the payload offline.
 */

import { useCallback, useState } from "react";
import { api } from "../api/rest";
import type {
  BraketPayloadResponse,
  BraketSubmitResponse,
  NodePos,
  ScheduleDTO,
} from "../api/rest";
import { ConstraintBadge } from "./ConstraintBadge";
import { Panel } from "./Panel";
import { palette } from "../theme/palette";

interface Props {
  positions: NodePos[];
  schedule: ScheduleDTO;
  defaultShots?: number;
}

export function BraketPanel({ positions, schedule, defaultShots = 200 }: Props) {
  const [shots, setShots] = useState(defaultShots);
  const [region, setRegion] = useState("us-east-1");
  const [preview, setPreview] = useState<BraketPayloadResponse | null>(null);
  const [submit, setSubmit] = useState<BraketSubmitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyPayload = useCallback(async () => {
    if (!preview) return;
    const text = JSON.stringify(preview.payload, null, 2);
    try {
      // Modern clipboard API; falls back to a temp textarea for older / insecure-context cases.
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* swallow — the JSON is still visible on screen */
    }
  }, [preview]);

  const buildPayload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setSubmit(null);
    try {
      const res = await api.braketPayload({ positions, schedule, shots });
      setPreview(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [positions, schedule, shots]);

  const runSubmit = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.braketSubmit({ positions, schedule, shots, region });
      setSubmit(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [positions, schedule, shots, region]);

  return (
    <Panel
      title="Run on Aquila (Phase 7 · Amazon Braket bridge)"
      subtitle="בנה payload, ראה עלות + זמן צפויים, ושלח לחומרה האמיתית"
      right={
        preview && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: palette.queraPurpleGlow,
              background: palette.bgInset,
              padding: "6px 12px",
              borderRadius: 8,
            }}
            dir="ltr"
          >
            ${preview.cost_estimate.total_usd.toFixed(2)} · ~
            {preview.runtime_estimate_seconds.toFixed(0)}s
          </div>
        )
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 320px) 1fr",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 12, color: palette.textSecondary }}>
            shots
            <input
              type="number"
              min={1}
              max={1000}
              value={shots}
              onChange={(e) => setShots(Number(e.target.value))}
              style={inputStyle}
              dir="ltr"
            />
          </label>
          <label style={{ fontSize: 12, color: palette.textSecondary }}>
            AWS region
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              style={inputStyle}
              dir="ltr"
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={buildPayload}
              disabled={loading}
              style={{ ...btnStyle, background: palette.queraPurple }}
            >
              {loading ? "בונה…" : "🧮 Build payload"}
            </button>
            <button
              onClick={runSubmit}
              disabled={loading || !preview}
              style={{
                ...btnStyle,
                background: preview ? palette.ok : palette.bgInset,
                color: preview ? "#000" : palette.textMuted,
                cursor: preview ? "pointer" : "not-allowed",
              }}
            >
              🚀 Submit to Aquila
            </button>
          </div>
          {err && (
            <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
              {err}
            </div>
          )}
          {preview && (
            <div
              style={{
                marginTop: 8,
                padding: 12,
                background: palette.bgInset,
                borderRadius: 8,
                fontSize: 12,
                color: palette.textSecondary,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <Stat label="task fee" value={`$${preview.cost_estimate.task_fee_usd.toFixed(2)}`} />
              <Stat
                label={`${preview.cost_estimate.shots} × shot`}
                value={`$${preview.cost_estimate.shot_fee_usd.toFixed(2)}`}
              />
              <Stat
                label="total"
                value={`$${preview.cost_estimate.total_usd.toFixed(2)}`}
                color={palette.ok}
              />
              <Stat
                label="runtime"
                value={`~${preview.runtime_estimate_seconds.toFixed(0)} s`}
              />
            </div>
          )}
          {preview && (
            <div style={{ fontSize: 11, color: palette.textMuted }} dir="ltr">
              device: {preview.device_arn}
            </div>
          )}
        </div>

        <div>
          {preview && preview.preflight_violations.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              {preview.preflight_violations.map((v, i) => (
                <ConstraintBadge key={i} violation={v} />
              ))}
            </div>
          )}
          {preview && (
            <div style={{ position: "relative" }}>
              <button
                onClick={copyPayload}
                aria-label="העתק את ה-payload"
                title={copied ? "Copied!" : "Copy payload JSON"}
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  zIndex: 2,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: `1px solid ${
                    copied ? palette.ok : palette.queraPurpleSoft
                  }`,
                  background: copied
                    ? "rgba(61,220,151,0.18)"
                    : "rgba(20,12,40,0.72)",
                  backdropFilter: "blur(6px)",
                  color: copied ? palette.ok : palette.queraPurpleGlow,
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: 0.3,
                  cursor: "pointer",
                  transition:
                    "background 160ms ease, border-color 160ms ease, color 160ms ease, transform 120ms ease",
                  boxShadow: copied
                    ? `0 0 16px ${palette.ok}55`
                    : `0 2px 10px rgba(0,0,0,0.35)`,
                }}
                onMouseEnter={(e) => {
                  if (!copied) {
                    e.currentTarget.style.background = "rgba(155,107,255,0.22)";
                    e.currentTarget.style.borderColor = palette.queraPurpleGlow;
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!copied) {
                    e.currentTarget.style.background = "rgba(20,12,40,0.72)";
                    e.currentTarget.style.borderColor = palette.queraPurpleSoft;
                    e.currentTarget.style.transform = "translateY(0)";
                  }
                }}
                data-testid="braket-payload-copy"
              >
                {copied ? (
                  <>
                    <CheckIcon />
                    <span dir="ltr">Copied!</span>
                  </>
                ) : (
                  <>
                    <ClipboardIcon />
                    <span dir="ltr">Copy</span>
                  </>
                )}
              </button>
              <pre
                style={{
                  background: palette.bgInset,
                  color: palette.queraPurpleGlow,
                  padding: 14,
                  paddingTop: 44,
                  borderRadius: 8,
                  fontSize: 11,
                  fontFamily: "JetBrains Mono, monospace",
                  maxHeight: 320,
                  overflow: "auto",
                  margin: 0,
                }}
                dir="ltr"
                data-testid="braket-payload"
              >
                {JSON.stringify(preview.payload, null, 2)}
              </pre>
            </div>
          )}
          {submit && (
            <div
              role="status"
              style={{
                marginTop: 12,
                padding: 12,
                background: submit.submitted
                  ? "rgba(61,220,151,0.1)"
                  : "rgba(255,181,71,0.1)",
                border: `1px solid ${submit.submitted ? palette.ok : palette.warn}`,
                borderRadius: 8,
                fontSize: 12,
                color: submit.submitted ? palette.ok : palette.warn,
              }}
              dir="ltr"
            >
              <div style={{ fontWeight: 600 }}>
                {submit.submitted ? "✓ submitted" : "⚠ not submitted"}
              </div>
              <div style={{ marginTop: 4, color: palette.textSecondary }}>
                {submit.message}
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Stat({
  label,
  value,
  color = palette.queraPurpleGlow,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div style={{ color: palette.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", color, fontSize: 16 }} dir="ltr">
        {value}
      </div>
    </div>
  );
}

function ClipboardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="4" width="10" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="5" y="7" width="10" height="14" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12l4 4 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 4,
  padding: "6px 8px",
  background: palette.bgInset,
  color: palette.textPrimary,
  border: `1px solid ${palette.queraPurpleSoft}`,
  borderRadius: 6,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 12,
};

const btnStyle: React.CSSProperties = {
  padding: "8px 14px",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
  flex: 1,
};
