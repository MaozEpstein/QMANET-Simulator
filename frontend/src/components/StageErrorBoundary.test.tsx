import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StageErrorBoundary } from "./StageErrorBoundary";

function Boom({ thrown }: { thrown: boolean }) {
  if (thrown) throw new Error("kaboom");
  return <div>working</div>;
}

describe("StageErrorBoundary", () => {
  it("renders children unchanged when no error", () => {
    render(
      <StageErrorBoundary stageName="MANET">
        <Boom thrown={false} />
      </StageErrorBoundary>,
    );
    expect(screen.getByText("working")).toBeInTheDocument();
  });

  it("renders the fallback UI when a child throws", () => {
    // suppress React's console.error noise during the test
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <StageErrorBoundary stageName="MANET">
        <Boom thrown={true} />
      </StageErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/תקלה בשלב "MANET"/)).toBeInTheDocument();
    expect(screen.getByTestId("error-message").textContent).toMatch(/kaboom/);
    spy.mockRestore();
  });

  it("clicking 'נסה שוב' clears the fallback when the source error is gone", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(
      <StageErrorBoundary stageName="MANET">
        <Boom thrown={true} />
      </StageErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Simulate the user fixing the underlying problem before clicking reset.
    rerender(
      <StageErrorBoundary stageName="MANET">
        <Boom thrown={false} />
      </StageErrorBoundary>,
    );
    fireEvent.click(screen.getByText(/↻ נסה שוב/));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("working")).toBeInTheDocument();

    spy.mockRestore();
  });
});
