import { describe, expect, it } from "vitest";
import { stableHash } from "./stageHash";

describe("stableHash", () => {
  it("returns the same hash for equal inputs", () => {
    expect(stableHash({ a: 1, b: [1, 2] })).toBe(stableHash({ a: 1, b: [1, 2] }));
  });

  it("is independent of key order", () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
  });

  it("quantises floats to 6 decimals", () => {
    expect(stableHash({ x: 1.0 })).toBe(stableHash({ x: 1.0000001 }));
  });

  it("distinguishes different content", () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });

  it("handles arrays and nesting", () => {
    expect(stableHash([{ k: "v", n: 1 }])).toBe(stableHash([{ n: 1.000000001, k: "v" }]));
  });

  it("handles null/undefined without crashing", () => {
    expect(stableHash(null)).toBe(stableHash(null));
    expect(stableHash(undefined)).toBe(stableHash(undefined));
    expect(stableHash({ a: null })).not.toBe(stableHash({ a: 1 }));
  });
});
