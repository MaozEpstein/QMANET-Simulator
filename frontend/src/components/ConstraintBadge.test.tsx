import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConstraintBadge, ConstraintSummary } from "./ConstraintBadge";
import type { ViolationDTO } from "../api/rest";

const sample: ViolationDTO = {
  code: "site_too_close",
  message: "Atoms 1 and 2 are 3.000µm apart; minimum is 4.000µm",
  locus: { atom_idx: 1, other_idx: 2, distance_um: 3.0 },
  measured: 3.0,
  limit: 4.0,
};

describe("ConstraintBadge", () => {
  it("renders Hebrew label for known codes", () => {
    render(<ConstraintBadge violation={sample} />);
    expect(screen.getByText("מרחק בין אטומים קטן מהמינימום")).toBeInTheDocument();
  });

  it("falls back to raw code for unknown codes", () => {
    const unknown: ViolationDTO = { ...sample, code: "some_new_code" };
    render(<ConstraintBadge violation={unknown} />);
    expect(screen.getByText("some_new_code")).toBeInTheDocument();
  });

  it("shows the measured vs limit values", () => {
    render(<ConstraintBadge violation={sample} />);
    expect(screen.getByText(/3\.000 vs limit 4\.000/)).toBeInTheDocument();
  });

  it("has role=alert for a11y", () => {
    render(<ConstraintBadge violation={sample} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("ConstraintSummary", () => {
  it("renders the OK pill when there are no violations", () => {
    render(<ConstraintSummary violations={[]} />);
    expect(screen.getByText(/עומד באילוצי Aquila/)).toBeInTheDocument();
  });

  it("renders the violations count when there are violations", () => {
    render(<ConstraintSummary violations={[sample, sample, sample]} />);
    expect(screen.getByText(/3 הפרות/)).toBeInTheDocument();
  });
});
