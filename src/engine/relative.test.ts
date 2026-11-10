import { describe, expect, it } from "vitest";
import { DEFAULT_BANDS } from "./bands";
import { normCdf, normInv, Z_QUARTILE } from "./normal";
import {
  courseStanding,
  percentileOf,
  placementHint,
  relativeBandFor,
  relativeNeed,
  spreadOf,
  tailZ,
  validateTop,
  withTopCutoffs,
  zOf,
} from "./relative";
import { summarize } from "./calc";
import type { ClassStats, Course, Item, Section } from "./types";

const stats: ClassStats = { low: 10, lower: 40, median: 55, upper: 70, high: 95 };
const zn = tailZ(100);

describe("item z-scores", () => {
  it("puts quartiles and median at their normal positions", () => {
    expect(zOf(40, 100, stats)).toBeCloseTo(-Z_QUARTILE, 9);
    expect(zOf(55, 100, stats)).toBeCloseTo(0, 9);
    expect(zOf(70, 100, stats)).toBeCloseTo(Z_QUARTILE, 9);
    expect(percentileOf(70, 100, stats)).toBeCloseTo(75, 4);
  });
  it("interpolates in z and clamps to the class tails", () => {
    expect(zOf(62.5, 100, stats)).toBeCloseTo(Z_QUARTILE / 2, 9);
    expect(zOf(99, 100, stats)).toBeCloseTo(zn, 9);
    expect(zOf(0, 100, stats)).toBeCloseTo(-zn, 9);
    expect(tailZ(100)).toBeCloseTo(normInv(1 - 1 / 200), 9);
  });
  it("with only a mean, uses 0 and full marks as the tails", () => {
    expect(zOf(80, 100, { mean: 60 })).toBeCloseTo(zn / 2, 9);
  });
  it("needs a middle stat", () => {
    expect(zOf(50, 100, { low: 0, high: 100 })).toBeNull();
    expect(zOf(50, 100, undefined)).toBeNull();
  });
  it("splits ties (many students on full marks)", () => {
    // the tied group runs from the 75th percentile to the top: its middle is ~87th
    expect(zOf(10, 10, { median: 8, upper: 10, high: 10 })).toBeCloseTo(normInv((0.75 + normCdf(zn)) / 2), 6);
  });
  it("full marks with the class high at full marks sits in the middle of the capped group", () => {
    // median 85, IQR 15 -> sd ~11.1; share at 100 ~ 9%: middle of that group ~ 95.5th percentile
    const s: ClassStats = { lower: 77.5, median: 85, upper: 92.5, high: 100 };
    const sd = 15 / (2 * Z_QUARTILE);
    const share = 1 - normCdf(15 / sd);
    expect(zOf(100, 100, s)).toBeCloseTo(normInv(1 - share / 2), 6);
    expect(zOf(100, 100, s)!).toBeLessThan(zn);
  });
  it("estimates spread from the stats", () => {
    expect(spreadOf(stats)).toBeCloseTo(30 / (2 * Z_QUARTILE), 9);
    expect(spreadOf({ median: 55, upper: 70 })).toBeCloseTo(15 / Z_QUARTILE, 9);
    expect(spreadOf({ low: 10, high: 90, mean: 50 })).toBeCloseTo(80 / (2 * zn), 9);
    expect(spreadOf({ median: 50 })).toBeNull();
  });
});

const item = (score: number | null, s?: ClassStats, max = 100, id = Math.random().toString()): Item => ({ id, name: id, max, score, whatIf: null, stats: s });
const sec = (weight: number, items: Item[], rule: Section["rule"] = { kind: "sum" }): Section => ({ id: Math.random().toString(), name: "S", weight, rule, items });
const course = (sections: Section[]): Course => ({ id: "c", name: "C", grading: "relative", bands: DEFAULT_BANDS, sections });

describe("course standing", () => {
  it("rule of thumb: at the upper quartile on everything is top 25% or better (an A)", () => {
    const c = course([sec(30, [item(70, stats)]), sec(30, [item(70, stats)]), sec(40, [item(70, stats)])]);
    const st = courseStanding(c, false);
    expect(st.low!).toBeGreaterThanOrEqual(75 - 1e-9);
    expect(st.pct!).toBeGreaterThan(75);
    expect(relativeBandFor(c.bands, 100 - st.pct!)?.label).toBe("A");
  });

  it("steady performers aren't understated: 90th percentile everywhere ranks above 90th overall", () => {
    const z90 = normInv(0.9);
    const s: ClassStats = { lower: 50 - Z_QUARTILE * 10, median: 50, upper: 50 + Z_QUARTILE * 10, low: 50 - zn * 10, high: 50 + zn * 10 };
    const score = 50 + z90 * 10;
    const c = course([sec(50, [item(score, s)]), sec(50, [item(score, s)])]);
    const st = courseStanding(c, false);
    expect(st.pct!).toBeGreaterThan(90);
    expect(st.low!).toBeLessThan(st.high!);
  });

  it("a test with a wide spread moves your rank more than a tight one", () => {
    const wide: ClassStats = { lower: 40, median: 55, upper: 70 };
    const tight: ClassStats = { lower: 52, median: 55, upper: 58 };
    // +1 IQR-step above median on the wide test vs on the tight test, same weights
    const aheadOnWide = course([sec(50, [item(70, wide)]), sec(50, [item(55, tight)])]);
    const aheadOnTight = course([sec(50, [item(55, wide)]), sec(50, [item(58, tight)])]);
    expect(courseStanding(aheadOnWide, false).pct!).toBeGreaterThan(courseStanding(aheadOnTight, false).pct!);
  });

  it("dropped best-N items and items without stats don't count", () => {
    const c = course([
      sec(40, [item(90, stats, 100, "a"), item(20, stats, 100, "b")], { kind: "bestN", n: 1 }),
      sec(60, [item(60)]),
    ]);
    const st = courseStanding(c, false);
    expect(st.itemsWithStats).toBe(2);
    expect(st.covered).toBeCloseTo(40);
    expect(st.pct!).toBeCloseTo(percentileOf(90, 100, stats)!, 6); // only one item counts
  });
});

describe("what you need (curved)", () => {
  const c = course([sec(40, [item(75, stats)]), sec(60, [item(null)])]);
  const st = courseStanding(c, false);
  const remaining = summarize(c, false).remaining;

  it("with no stats you need to be in the target group on the rest", () => {
    const none = courseStanding(course([sec(100, [item(null)])]), false);
    const r = relativeNeed(none, 100, 25);
    expect(r.status).toBe("needed");
    if (r.status === "needed") {
      // normCdf is accurate to ~1e-7, i.e. ~1e-5 percentage points
      expect(r.top).toBeCloseTo(25, 4);
      expect(r.topLow).toBeCloseTo(25, 4);
      expect(r.topHigh).toBeCloseTo(25, 4);
    }
  });
  it("being ahead already means a lower bar on the rest, with a range", () => {
    const r = relativeNeed(st, remaining, 25);
    expect(r.status).toBe("needed");
    if (r.status === "needed") {
      expect(r.top).toBeGreaterThan(25); // can afford a bit worse than top 25% on the rest
      expect(r.topLow).toBeLessThanOrEqual(r.top + 1e-9);
      expect(r.topHigh).toBeGreaterThanOrEqual(r.top - 1e-9);
    }
  });
  it("harder targets need better placements", () => {
    const tops = [5, 25, 55, 80].map((t) => relativeNeed(st, remaining, t)).map((r) => (r.status === "needed" ? r.top : r.status === "secured" ? 100 : 0));
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]);
  });
  it("secured and out of reach at the extremes", () => {
    expect(relativeNeed(st, remaining, 100).status).toBe("secured");
    expect(relativeNeed(courseStanding(course([sec(90, [item(10, stats)]), sec(10, [item(null)])]), false), 10, 5).status).toBe("out_of_reach");
  });
  it("plain-word hints", () => {
    expect(placementHint(20)).toBe("above the upper quartile");
    expect(placementHint(40)).toBe("above the median");
    expect(placementHint(80)).toBe("stay out of the bottom 20%");
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
