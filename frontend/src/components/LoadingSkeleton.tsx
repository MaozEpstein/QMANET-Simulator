/**
 * Lightweight loading skeleton with a shimmering gradient — used during
 * long simulate/postprocess calls to give the user immediate feedback that
 * something is happening.
 */

import { palette } from "../theme/palette";

interface Props {
  height?: number;
  width?: number | string;
  label?: string;
  rounded?: boolean;
}

export function LoadingSkeleton({
  height = 24,
  width = "100%",
  label,
  rounded = true,
}: Props) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label ?? "loading"}
      style={{ display: "inline-block", width, position: "relative" }}
    >
      <div
        style={{
          width: "100%",
          height,
          borderRadius: rounded ? 8 : 0,
          background: `linear-gradient(90deg, ${palette.bgInset} 0%, ${palette.queraPurpleSoft} 50%, ${palette.bgInset} 100%)`,
          backgroundSize: "200% 100%",
          animation: "qsim-skeleton-shimmer 1.4s linear infinite",
        }}
      />
      {label && (
        <div
          style={{
            fontSize: 11,
            color: palette.textMuted,
            marginTop: 4,
          }}
        >
          {label}
        </div>
      )}
      <style>
        {`@keyframes qsim-skeleton-shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }`}
      </style>
    </div>
  );
}

/** Multi-line skeleton for big content areas (plots, atom arrays). */
export function SkeletonBlock({
  width = 600,
  height = 400,
  label,
}: {
  width?: number;
  height?: number;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      style={{
        width,
        height,
        background: palette.bgInset,
        border: `1px dashed ${palette.queraPurpleSoft}`,
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <LoadingSkeleton width={Math.min(width * 0.5, 280)} height={10} />
      <LoadingSkeleton width={Math.min(width * 0.35, 200)} height={10} />
      {label && (
        <div style={{ color: palette.textMuted, fontSize: 12 }}>{label}</div>
      )}
    </div>
  );
}
