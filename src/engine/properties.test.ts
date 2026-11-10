import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_BANDS } from "./bands";
import { coursePointsFilled, effectiveCutoff, neededForTarget, roundForBand, summarize } from "./calc";
import type { AggregationRule, Course, Item, Section } from "./types";

// ---- generators ----
const itemArb = (i: number) =>
  fc
    .record({
      max: fc.integer({ min: 1, max: 100 }),
      frac: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
      excused: fc.boolean().map((b) => b && Math.random() < 0.2),
    })
    .map(({ max, frac, excused }): Item => ({
      id: `i${i}-${Math.random()}`,
      name: `I${i}`,
      max,
      score: frac == null ? null : Math.round(frac * max * 2) / 2,
      whatIf: null,
      excused,
    }));

const ruleArb: fc.Arbitrary<AggregationRule> = fc.oneof(
  fc.constant({ kind: "sum" as const }),
  fc.constant({ kind: "average" as const }),
  fc.record({ n: fc.integer({ min: 1, max: 4 }), extra: fc.integer({ min: 0, max: 2 }) }).map(({ n, extra }) => ({ kind: "bestN" as const, n, total: n + extra })),
  fc.integer({ min: 0, max: 2 }).map((k) => ({ kind: "dropLowest" as const, k })),
);

const sectionArb = (si: number) =>
  fc
    .record({ weight: fc.integer({ min: 1, max: 40 }), rule: ruleArb, n: fc.integer({ min: 0, max: 5 }) })
    .chain(({ weight, rule, n }) =>
      fc.tuple(...Array.from({ length: n }, (_, i) => itemArb(i))).map((items): Section => ({ id: `s${si}`, name: `S${si}`, weight, rule, items })),
    );

const courseArb: fc.Arbitrary<Course> = fc
  .integer({ min: 1, max: 4 })
  .chain((k) => fc.tuple(...Array.from({ length: k }, (_, i) => sectionArb(i))))
  .map((sections) => ({ id: "c", name: "C", sections, bands: DEFAULT_BANDS }));

// Old bisection solver, kept as an oracle for the exact one.
function bisect(course: Course, target: number): number | null {
  const f = (x: number) => coursePointsFilled(course, false, x);
  if (f(0) >= target - 1e-9 || f(100) < target - 1e-9) return null;
  let a = 0;
  let b = 100;
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    if (f(m) >= target - 1e-9) b = m;
    else a = m;
  }
  return b;
}

const RUNS = { numRuns: 400 };

describe("engine properties", () => {
  it("locked <= current-scale max, and total is non-decreasing in fill", () => {
    fc.assert(
      fc.property(courseArb, fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), (c, x, y) => {
        const [a, b] = x <= y ? [x, y] : [y, x];
        expect(coursePointsFilled(c, false, a)).toBeLessThanOrEqual(coursePointsFilled(c, false, b) + 1e-9);
        const s = summarize(c, false);
        expect(s.locked).toBeLessThanOrEqual(s.maxPossible + 1e-9);
      }),
      RUNS,
    );
  });

  it("exact solver hits the target and matches bisection", () => {
    fc.assert(
      fc.property(courseArb, fc.double({ min: 1, max: 99, noNaN: true }), (c, frac) => {
        const lo = coursePointsFilled(c, false, 0);
        const hi = coursePointsFilled(c, false, 100);
        const target = lo + ((hi - lo) * frac) / 100;
        const r = neededForTarget(c, false, target);
        const ref = bisect(c, target);
        if (r.status !== "needed") {
          expect(ref).toBeNull();
          return;
        }
        expect(coursePointsFilled(c, false, r.pct)).toBeGreaterThanOrEqual(target - 1e-7);
        if (r.pct > 0.01) expect(coursePointsFilled(c, false, r.pct - 0.01)).toBeLessThan(target + 1e-9);
        expect(ref).not.toBeNull();
        // Compare in course points: on a very flat course a tiny points tolerance is a wide fill range.
        expect(Math.abs(coursePointsFilled(c, false, r.pct) - coursePointsFilled(c, false, ref!))).toBeLessThan(1e-7);
      }),
      RUNS,
    );
  });

  it("raising a score never lowers current, locked or max", () => {
    fc.assert(
      fc.property(courseArb, fc.nat(), fc.double({ min: 0, max: 1, noNaN: true }), (c, pick, bump) => {
        const items = c.sections.flatMap((s) => s.items.filter((i) => !i.excused && i.score != null));
        if (items.length === 0) return;
        const before = summarize(c, false);
        const it = items[pick % items.length];
        it.score = Math.min(it.max, it.score! + bump * it.max);
        const after = summarize(c, false);
        expect(after.locked).toBeGreaterThanOrEqual(before.locked - 1e-9);
        expect(after.maxPossible).toBeGreaterThanOrEqual(before.maxPossible - 1e-9);
        // current % is per assessed section; a raise within a graded item can't lower it
        if (before.current != null) expect(after.current!).toBeGreaterThanOrEqual(before.current - 1e-9);
      }),
      RUNS,
    );
  });

  it("best-N: a new score below the lowest counted one doesn't change locked points", () => {
    const sec: Section = {
      id: "s",
      name: "S",
      weight: 100,
      rule: { kind: "bestN", n: 2, total: 3 },
      items: [
        { id: "a", name: "a", max: 10, score: 9, whatIf: null },
        { id: "b", name: "b", max: 10, score: 7, whatIf: null },
        { id: "c", name: "c", max: 10, score: null, whatIf: null },
      ],
    };
    const c: Course = { id: "c", name: "C", sections: [sec], bands: DEFAULT_BANDS };
    const before = summarize(c, false).locked;
    sec.items[2].score = 5;
    expect(summarize(c, false).locked).toBeCloseTo(before, 9);
  });

  it("excused items count nowhere", () => {
    fc.assert(
      fc.property(courseArb, (c) => {
        const withEx = summarize(c, false);
        // Same course with excused items removed, and sections that were entirely excused dropped.
        const stripped: Course = {
          ...c,
          sections: c.sections
            .filter((s) => !(s.items.length > 0 && s.items.every((i) => i.excused)))
            .map((s) => ({ ...s, items: s.items.filter((i) => !i.excused) })),
        };
        const without = summarize(stripped, false);
        if (without.totalWeight === 0) return;
        // Compare as a share of the course: dropped sections' weight is spread over the rest.
        expect(withEx.locked / withEx.totalWeight).toBeCloseTo(without.locked / without.totalWeight, 9);
        expect(withEx.maxPossible / withEx.totalWeight).toBeCloseTo(without.maxPossible / without.totalWeight, 9);
        expect(withEx.current ?? -1).toBeCloseTo(without.current ?? -1, 9);
      }),
      RUNS,
    );
  });
});

describe("rounding before banding", () => {
  it("rounds half up, with float safety", () => {
    expect(roundForBand(84.5, "int")).toBe(85);
    expect(roundForBand(84.49, "int")).toBe(84);
    expect(roundForBand(84.95, "1dp")).toBe(85);
    expect(roundForBand(84.94, "1dp")).toBe(84.9);
    expect(roundForBand(84.94, "none")).toBe(84.94);
    expect(effectiveCutoff(85, "int")).toBe(84.5);
  });
  it("an 84.6% total is an A with whole-number rounding, A- without", () => {
    const c: Course = {
      id: "c",
      name: "C",
      bands: DEFAULT_BANDS,
      sections: [{ id: "s", name: "S", weight: 100, rule: { kind: "sum" }, items: [{ id: "i", name: "i", max: 100, score: 84.6, whatIf: null }] }],
    };
    expect(summarize(c, false).currentBand?.label).toBe("A-");
    expect(summarize({ ...c, rounding: "int" }, false).currentBand?.label).toBe("A");
  });
  it("needed targets the rounded cutoff", () => {
    const c: Course = {
      id: "c",
      name: "C",
      bands: DEFAULT_BANDS,
      rounding: "int",
      sections: [
        { id: "a", name: "A", weight: 50, rule: { kind: "sum" }, items: [{ id: "i", name: "i", max: 100, score: 80, whatIf: null }] },
        { id: "b", name: "B", weight: 50, rule: { kind: "sum" }, items: [{ id: "j", name: "j", max: 100, score: null, whatIf: null }] },
      ],
    };
    const a = summarize(c, false).needs.find((n) => n.band.label === "A")!;
    expect(a.result).toEqual({ status: "needed", pct: 89 }); // (84.5 - 40) / 50
  });
});
