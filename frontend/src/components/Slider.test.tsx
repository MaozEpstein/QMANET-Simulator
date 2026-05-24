import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Slider } from "./Slider";

describe("Slider", () => {
  it("renders label, value and unit", () => {
    render(
      <Slider label="טווח" value={35} onChange={() => {}} min={0} max={100} step={1} unit="m" />,
    );
    expect(screen.getByText("טווח")).toBeInTheDocument();
    expect(screen.getByText("35 m")).toBeInTheDocument();
  });

  it("fires onChange with a number when slid", () => {
    const onChange = vi.fn();
    render(<Slider label="N" value={5} onChange={onChange} min={0} max={20} step={1} />);
    const range = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(range, { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it("respects min/max/step on the underlying input", () => {
    render(<Slider label="x" value={5} onChange={() => {}} min={1} max={50} step={0.5} />);
    const range = screen.getByRole("slider") as HTMLInputElement;
    expect(range.min).toBe("1");
    expect(range.max).toBe("50");
    expect(range.step).toBe("0.5");
  });

  it("displays value without unit when none provided", () => {
    render(<Slider label="seed" value={42} onChange={() => {}} min={0} max={999} step={1} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
