import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  describe("collapsible", () => {
    beforeEach(() => {
      try {
        localStorage.clear();
      } catch {
        /* jsdom should always succeed */
      }
    });

    afterEach(() => {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
    });

    it("hides children when collapsed and shows them again on expand", () => {
      render(
        <Panel title="הסבר" collapsible>
          <div data-testid="body">explanation body</div>
        </Panel>,
      );
      expect(screen.getByTestId("body")).toBeInTheDocument();
      const toggle = screen.getByRole("button", { name: /collapse/i });
      fireEvent.click(toggle);
      expect(screen.queryByTestId("body")).not.toBeInTheDocument();
      // Re-expand
      fireEvent.click(screen.getByRole("button", { name: /expand/i }));
      expect(screen.getByTestId("body")).toBeInTheDocument();
    });

    it("syncs collapsed state across panels in the same collapseGroup", () => {
      render(
        <>
          <Panel title="A" collapsible collapseGroup="shared">
            <div data-testid="body-a">A body</div>
          </Panel>
          <Panel title="B" collapsible collapseGroup="shared">
            <div data-testid="body-b">B body</div>
          </Panel>
        </>,
      );
      // Click A's collapse button — both bodies should disappear.
      const aToggle = screen.getAllByRole("button", { name: /collapse/i })[0];
      fireEvent.click(aToggle);
      expect(screen.queryByTestId("body-a")).not.toBeInTheDocument();
      expect(screen.queryByTestId("body-b")).not.toBeInTheDocument();
    });

    it("persists the collapsed state via localStorage", () => {
      const { unmount } = render(
        <Panel title="persisted" collapsible collapseGroup="persisted-group">
          <div data-testid="body">x</div>
        </Panel>,
      );
      fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
      unmount();
      // Mount a fresh instance; without manually setting state it should
      // come up collapsed because localStorage said so.
      render(
        <Panel title="persisted" collapsible collapseGroup="persisted-group">
          <div data-testid="body">x</div>
        </Panel>,
      );
      expect(screen.queryByTestId("body")).not.toBeInTheDocument();
    });

    it("non-collapsible panels never render a toggle button", () => {
      render(
        <Panel title="static">
          <div>body</div>
        </Panel>,
      );
      expect(screen.queryByRole("button", { name: /collapse/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /expand/i })).toBeNull();
    });
  });
});
