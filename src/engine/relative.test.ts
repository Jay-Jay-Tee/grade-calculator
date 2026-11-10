import { describe, expect, it } from "vitest";
import { DEFAULT_BANDS } from "./bands";
import {
  courseStanding,
  percentileOf,
  placementHint,
  relativeBandFor,
  relativeNeed,
  validateTop,
  withTopCutoffs,
} from "./relative";
import { summarize } from "./calc";
import type { Course, Item } from "./types";

const stats = { low: 10, lower: 40, median: 55, upper: 70, high: 95 };

describe("percentileOf", () => {
  it("hits the quartile anchors exactly", () => {
    expect(percentileOf(40, 100, stats)).toBe(25);
    expect(percentileOf(55, 100, stats)).toBe(50);
    expect(percentileOf(70, 100, stats)).toBe(75);
  });
  it("interpolates between anchors and clamps at the ends", () => {
    expect(percentileOf(62.5, 100, stats)).toBeCloseTo(62.5);
    expect(percentileOf(5, 100, stats)).toBe(0);
    expect(percentileOf(99, 100, stats)).toBe(100);
  });
  it("uses mean when there's no median, and full marks when there's no high", () => {
    expect(percentileOf(60, 100, { mean: 60 })).toBe(50);
    expect(percentileOf(80, 100, { mean: 60 })).toBeCloseTo(75); // halfway from 60 to 100
  });
  it("needs at least one middle stat", () => {
    expect(percentileOf(50, 100, { low: 0, high: 100 })).toBeNull();
    expect(percentileOf(50, 100, undefined)).toBeNull();
  });
  it("splits ties (many students on full marks)", () => {
    expect(percentileOf(10, 10, { median: 8, upper: 10, high: 10 })).toBe(87.5);
  });
});

const it_ = (score: number | null, s?: Item["stats"], max = 100): Item => ({
  id: Math.random().toString(),
  name: "x",
  max,
  score,
  whatIf: null,
  stats: s,
});

describe("course standing (curved)", () => {
  // Above the upper quartile on everything marked => roughly top 25% => A with default cutoffs.
  const course: Course = {
    id: "c",
    name: "C",
    grading: "relative",
    bands: DEFAULT_BANDS,
    sections: [
      { id: "m", name: "Midterm", weight: 30, rule: { kind: "sum" }, items: [it_(75, stats)] },
      { id: "q", name: "Quizzes", weight: 20, rule: { kind: "average" }, items: [it_(8, { median: 6, upper: 7 }, 10), it_(null, undefined, 10)] },
      { id: "f", name: "Final", weight: 50, rule: { kind: "sum" }, items: [it_(null, undefined, 100)] },
    ],
  };

  it("weights item percentiles by course weight", () => {
    const st = courseStanding(course, false);
    // midterm: 75 -> between UQ 70 (75th) and high 95 (100th): 80th, weight 30
    // quiz 1: 8/10 -> between UQ 7 (75th) and max 10 (100th): 83.33rd, weight 10
    expect(st.pct!).toBeCloseTo((80 * 30 + 83.333 * 10) / 40, 2);
    expect(st.covered).toBeCloseTo(40);
    expect(st.itemsWithStats).toBe(2);
    expect(relativeBandFor(course.bands, 100 - st.pct!)?.label).toBe("A");
  });

  it("works out where you need to place on what's left", () => {
    const st = courseStanding(course, false);
    const remaining = summarize(course, false).remaining; // 60 pts: quiz 2 + final
    expect(remaining).toBeCloseTo(60);
    const need = relativeNeed(st, remaining, 25); // stay in the top 25%
    expect(need.status).toBe("needed");
    if (need.status === "needed") {
      // (75*(40+60) - P*40) / 60 percentile on the rest
      const x = (75 * 100 - st.pct! * 40) / 60;
      expect(need.top).toBeCloseTo(100 - x, 6);
      expect(placementHint(need.top)).toBe("above the median");
      expect(placementHint(80)).toBe("stay out of the bottom 20%");
    }
    expect(relativeNeed(st, remaining, 100).status).toBe("secured");
    expect(relativeNeed(st, remaining, 1).status).toBe("out_of_reach");
  });

  it("with no stats, you need to be in the target group on everything", () => {
    const need = relativeNeed({ pct: null, covered: 0, graded: 0, itemsWithStats: 0, itemsGraded: 0 }, 100, 25);
    expect(need).toEqual({ status: "needed", top: 25 });
  });
});

describe("curved cutoffs", () => {
  it("defaults are valid and match the rule of thumb", () => {
    expect(validateTop(DEFAULT_BANDS)).toEqual([]);
    expect(relativeBandFor(DEFAULT_BANDS, 25)?.label).toBe("A");
    expect(relativeBandFor(DEFAULT_BANDS, 4)?.label).toBe("A+");
    expect(relativeBandFor(DEFAULT_BANDS, 99.5)?.label).toBe("F");
  });
  it("fills missing cutoffs for custom bands", () => {
    const b = withTopCutoffs([
      { label: "Pass", min: 50 },
      { label: "A", min: 80 },
      { label: "Fail", min: 0 },
    ]);
    expect(b.map((x) => [x.label, x.top])).toEqual([
      ["A", 25],
      ["Pass", 67],
      ["Fail", 100],
    ]);
    expect(validateTop(b)).toEqual([]);
  });
});
