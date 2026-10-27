/**
 * Which bundled examples have a conflict graph F that Stage 3's exact-UDG
 * search can place on Aquila (Ω = 15 rad/µs, 5 s budget). Precomputed offline
 * by running `embed_udg` over every example in both conflict modes; only the
 * positives are listed. A lower Ω (larger R_b) admits a few more — Stage 3
 * does the real search, this is just a hint on the example cards.
 */
export interface UdgReadiness {
  bidirectional: boolean;
  unidirectional: boolean;
}

export const UDG_READINESS: Record<string, UdgReadiness> = {
  ApStar: { bidirectional: false, unidirectional: true },
  BernienChain9: { bidirectional: false, unidirectional: true },
  C4: { bidirectional: false, unidirectional: true },
  CommunityMeshSmall: { bidirectional: false, unidirectional: true },
  ConflictPentagon: { bidirectional: true, unidirectional: true },
  HexCellularLarge: { bidirectional: true, unidirectional: true },
  HexCellularSmall: { bidirectional: true, unidirectional: true },
  HiddenTerminal: { bidirectional: true, unidirectional: true },
  InterferenceChain: { bidirectional: false, unidirectional: true },
  ManetRGG12: { bidirectional: false, unidirectional: true },
  PathP8: { bidirectional: false, unidirectional: true },
  TwoHubsReuse: { bidirectional: false, unidirectional: true },
  TwoTriangles: { bidirectional: false, unidirectional: true },
};

export function udgReadinessTitle(r: UdgReadiness): string {
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  return `F ניתן להטמעה על Aquila (Ω=15) — דו-כיווני ${mark(r.bidirectional)} · חד-כיווני ${mark(r.unidirectional)}`;
}
