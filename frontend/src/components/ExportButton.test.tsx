import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportButton } from "./ExportButton";

describe("ExportButton", () => {
  it("is disabled when data is null", () => {
    render(<ExportButton filename="x" data={null} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
  });

  it("is enabled when data is present", () => {
    render(<ExportButton filename="x" data={{ a: 1 }} />);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("renders the custom label", () => {
    render(<ExportButton filename="x" data={{}} label="הורד" />);
    expect(screen.getByText(/הורד/)).toBeInTheDocument();
  });

  it("triggers a download when clicked with data", () => {
    const clickProbe = vi.fn();
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob://x");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = clickProbe;

    render(<ExportButton filename="x" data={{ a: 1 }} />);
    fireEvent.click(screen.getByRole("button"));
    expect(clickProbe).toHaveBeenCalledTimes(1);

    HTMLAnchorElement.prototype.click = orig;
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it("does nothing on click when disabled", () => {
    const clickProbe = vi.fn();
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = clickProbe;

    render(<ExportButton filename="x" data={null} />);
    fireEvent.click(screen.getByRole("button"));
    expect(clickProbe).not.toHaveBeenCalled();

    HTMLAnchorElement.prototype.click = orig;
  });
});
