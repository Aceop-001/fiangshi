// Task 1 (2026-11-24): how a refused Surf group is split. Every part is a strict subset (no failed set is re-sent).
import { describe, it, expect } from "vitest";
import { splitPlan } from "../scripts/audit.js";

const sum = (p: number[] | "exclude") => (p === "exclude" ? 0 : p.reduce((a, b) => a + b, 0));

describe("splitPlan", () => {
  it("without --split-to: halves, then exclude at bisect-min (the behaviour every earlier census ran with)", () => {
    expect(splitPlan(50, 25)).toEqual([25, 25]);
    expect(splitPlan(25, 25)).toBe("exclude");
    expect(splitPlan(51, 25)).toEqual([26, 25]);
  });
  it("with --split-to 12: a refused 50 goes straight to groups of at most 12, all strict subsets", () => {
    const p = splitPlan(50, 6, 12);
    expect(p).toEqual([10, 10, 10, 10, 10]);
    expect(sum(p)).toBe(50);
    expect((splitPlan(159, 6, 12) as number[]).every((x) => x <= 12)).toBe(true);
    expect(sum(splitPlan(159, 6, 12))).toBe(159);
  });
  it("a refused group at or under split-to halves, and a refused group at bisect-min is excluded", () => {
    expect(splitPlan(12, 6, 12)).toEqual([6, 6]);
    expect(splitPlan(6, 6, 12)).toBe("exclude");
  });
});
