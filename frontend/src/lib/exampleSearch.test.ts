import { describe, expect, it } from "vitest";
import { matchesExampleQuery } from "./exampleSearch";

const pentagon = {
  name: "מחומש הקונפליקטים",
  englishName: "Pentagon conflict graph (odd hole)",
  description: "5 קישורים קצרים מסודרים בטבעת — F יוצא C₅ בדיוק.",
  n: 10,
};
const k5 = { name: "קליק שלם — K₅", englishName: "Complete graph K₅", description: "גרף שלם.", n: 5 };

describe("matchesExampleQuery", () => {
  it("empty query matches everything", () => {
    expect(matchesExampleQuery(pentagon, "   ")).toBe(true);
  });

  it("matches Hebrew and English names case-insensitively", () => {
    expect(matchesExampleQuery(pentagon, "מחומש")).toBe(true);
    expect(matchesExampleQuery(pentagon, "PENTAGON")).toBe(true);
    expect(matchesExampleQuery(k5, "pentagon")).toBe(false);
  });

  it("folds subscripts so K5 finds K₅ and C5 finds C₅", () => {
    expect(matchesExampleQuery(k5, "k5")).toBe(true);
    expect(matchesExampleQuery(pentagon, "c5")).toBe(true);
  });

  it("requires every term", () => {
    expect(matchesExampleQuery(pentagon, "odd hole")).toBe(true);
    expect(matchesExampleQuery(pentagon, "odd petersen")).toBe(false);
  });

  it("matches size as a bare number or n=", () => {
    expect(matchesExampleQuery(pentagon, "n=10")).toBe(true);
    expect(matchesExampleQuery(pentagon, "N10")).toBe(true);
    expect(matchesExampleQuery(k5, "n=10")).toBe(false);
  });

  it("matches the category title", () => {
    expect(matchesExampleQuery(k5, "conflict", "גרף הקונפליקטים · Conflict Graph")).toBe(true);
  });
});
