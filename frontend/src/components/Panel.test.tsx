import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

describe("Panel", () => {
  it("renders title, subtitle, and children", () => {
    render(
      <Panel title="כותרת" subtitle="הסבר קצר">
        <div>תוכן</div>
      </Panel>,
    );
    expect(screen.getByText("כותרת")).toBeInTheDocument();
    expect(screen.getByText("הסבר קצר")).toBeInTheDocument();
    expect(screen.getByText("תוכן")).toBeInTheDocument();
  });

  it("subtitle is optional", () => {
    render(
      <Panel title="solo">
        <span>x</span>
      </Panel>,
    );
    expect(screen.getByText("solo")).toBeInTheDocument();
  });

  it("renders the right-slot when given", () => {
    render(
      <Panel title="t" right={<span data-testid="badge">42</span>}>
        <div>c</div>
      </Panel>,
    );
    expect(screen.getByTestId("badge")).toHaveTextContent("42");
  });
});
