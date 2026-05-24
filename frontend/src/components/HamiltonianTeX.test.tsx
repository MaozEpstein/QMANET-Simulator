import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HamiltonianTeX } from "./HamiltonianTeX";

describe("HamiltonianTeX", () => {
  it("renders the symbolic form by default", () => {
    render(<HamiltonianTeX />);
    const sym = screen.getByTestId("symbolic-hamiltonian");
    expect(sym).toBeInTheDocument();
    // KaTeX should populate the div with .katex children
    expect(sym.querySelector(".katex")).toBeTruthy();
  });

  it("does not render the numeric form when params are missing", () => {
    render(<HamiltonianTeX />);
    expect(screen.queryByTestId("numeric-hamiltonian")).toBeNull();
  });

  it("renders the numeric form when Ω, Δ, φ are provided", () => {
    render(<HamiltonianTeX omega={15} delta={2} phi={0} nAtoms={4} />);
    const num = screen.getByTestId("numeric-hamiltonian");
    expect(num).toBeInTheDocument();
    expect(num.querySelector(".katex")).toBeTruthy();
  });

  it("includes the whitepaper §1.3 attribution when showTitle is true", () => {
    render(<HamiltonianTeX showTitle={true} />);
    expect(screen.getByText(/Aquila whitepaper §1\.3/)).toBeInTheDocument();
  });

  it("omits the title when showTitle is false", () => {
    render(<HamiltonianTeX showTitle={false} />);
    expect(screen.queryByText(/Aquila whitepaper §1\.3/)).toBeNull();
  });
});
