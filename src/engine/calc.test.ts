import { describe, expect, it } from "vitest";
import { validateBands, DEFAULT_BANDS } from "./bands";
import {
  bandFor,
  coursePointsFilled,
  neededForTarget,
  sectionPct,
  sectionPctFilled,
  singleRemaining,
  summarize,
} from "./calc";
import { cs1101sFixture } from "./fixtures";
import type { Course, Item, Section } from "./types";

const it_ = (score: number | null, max = 100, whatIf: number | null = null): Item => ({
  id: Math.random().toString(),
  name: "x",
  max,
  score,
  whatIf,
});
const sec = (rule: Section["rule"], items: Item[], weight = 100): Section => ({ id: "s", name: "S", weight, rule, items });
const course = (sections: Section[]): Course => ({ id: "c", name: "C", sections, bands: DEFAULT_BANDS });

describe("CS1101S acceptance fixture", () => {
  const c = cs1101sFixture();
  const s = summarize(c, false);
  const ra = c.sections.find((x) => x.name === "RA/PA")!;

  it("RA/PA counts the best 3 and drops PA2", () => {
    const pts = (sectionPct(ra, false)! * ra.weight) / 100;
    expect(pts).toBeCloseTo(8 + 7.84 + 6.3333, 3);
    expect(pts).toBeCloseTo(22.17, 2);
  });

  it("locked points and current %", () => {
    expect(s.locked).toBeCloseTo(62.67, 2);
    expect(s.assessedWeight).toBe(70);
    expect(s.current!).toBeCloseTo(89.53, 2);
    expect(s.current!.toFixed(1)).toBe("89.5");
  });

  it("max and min possible", () => {
    expect(s.maxPossible).toBeCloseTo(92.67, 2);
    expect(coursePointsFilled(c, false, 0)).toBeCloseTo(62.67, 2);
  });

  it("needed on the Final for A and A+", () => {
    const a = s.needs.find((n) => n.band.label === "A")!;
    const aplus = s.needs.find((n) => n.band.label === "A+")!;
    expect(a.result.status).toBe("needed");
    expect(aplus.result.status).toBe("needed");
    if (a.result.status === "needed") expect(a.result.pct.toFixed(1)).toBe("74.4");
    if (aplus.result.status === "needed") expect(aplus.result.pct.toFixed(1)).toBe("91.1");
  });

  it("single-remaining solver targets the Final with raw marks", () => {
    expect(s.single?.label).toBe("Final");
    expect(s.single?.max).toBe(100);
    const a = s.needs.find((n) => n.band.label === "A")!;
    expect(a.raw).toBeCloseTo(74.42, 2);
  });

  it("lower bands are already secured", () => {
    expect(s.needs.find((n) => n.band.label === "C+")!.result.status).toBe("secured");
    expect(s.needs.find((n) => n.band.label === "B-")!.result.status).toBe("needed"); // 62.67 < 65
  });

  it("current band is A (89.5)", () => {
    expect(s.currentBand?.label).toBe("A");
  });

  it("what-if on the Final drives projected %", () => {
    const c2 = cs1101sFixture();
    c2.sections.find((x) => x.name === "Final")!.items[0].whatIf = 80;
    const off = summarize(c2, false);
    const on = summarize(c2, true);
    expect(off.projected).toBeCloseTo(off.current!, 6);
    expect(on.current).toBeCloseTo(off.current!, 6); // current never uses what-ifs
    expect(on.projected!).toBeCloseTo(62.6733 + 24, 2);
    expect(on.single).toBeNull();
    expect(on.needs.find((n) => n.band.label === "A")!.result.status).toBe("secured");
  });
});

describe("section rules", () => {
  it("sum uses total earned / total max over graded items", () => {
    const s = sec({ kind: "sum" }, [it_(5, 10), it_(30, 40), it_(null, 50)]);
    expect(sectionPct(s, false)).toBeCloseTo(70);
    expect(sectionPctFilled(s, false, 0)).toBeCloseTo(35);
    expect(sectionPctFilled(s, false, 100)).toBeCloseTo(85);
  });

  it("average is the mean of item percentages", () => {
    const s = sec({ kind: "average" }, [it_(5, 10), it_(40, 40)]);
    expect(sectionPct(s, false)).toBeCloseTo(75);
  });

  it("bestN with fewer than n graded uses what's graded", () => {
    const s = sec({ kind: "bestN", n: 3, total: 4 }, [it_(80), it_(60)]);
    expect(sectionPct(s, false)).toBeCloseTo(70);
    // two planned slots: min treats them as 0, best 3 of [80, 60, 0, 0]
    expect(sectionPctFilled(s, false, 0)).toBeCloseTo(140 / 3);
    expect(sectionPctFilled(s, false, 100)).toBeCloseTo(280 / 3); // best 3 of [80, 60, 100, 100]
  });

  it("dropLowest drops k lowest but keeps at least one", () => {
    expect(sectionPct(sec({ kind: "dropLowest", k: 1 }, [it_(50), it_(90), it_(70)]), false)).toBeCloseTo(80);
    expect(sectionPct(sec({ kind: "dropLowest", k: 2 }, [it_(50)]), false)).toBeCloseTo(50);
  });

  it("empty section counts as fully unknown", () => {
    const s = sec({ kind: "sum" }, []);
    expect(sectionPct(s, false)).toBeNull();
    expect(sectionPctFilled(s, false, 42)).toBe(42);
  });

  it("what-if overrides only when what-if mode is on", () => {
    const s = sec({ kind: "sum" }, [it_(50, 100, 90)]);
    expect(sectionPct(s, false)).toBeCloseTo(50);
    expect(sectionPct(s, true)).toBeCloseTo(90);
  });
});

describe("needed math", () => {
  it("matches (band - locked) / remaining for linear courses", () => {
    const c = course([sec({ kind: "sum" }, [it_(80)], 60), sec({ kind: "sum" }, [it_(null)], 40)]);
    const r = neededForTarget(c, false, 85);
    expect(r.status).toBe("needed");
    if (r.status === "needed") expect(r.pct).toBeCloseTo((85 - 48) / 40 * 100, 6);
  });

  it("best-N: a low new score can be dropped, so need is solved against the best set", () => {
    // best 3 of 4: graded 100, 98, 79.17. Fourth only counts if it beats 79.17.
    const s = sec({ kind: "bestN", n: 3, total: 4 }, [it_(60, 60), it_(49, 50), it_(57, 72), it_(null, 100)]);
    const c = course([s]);
    const lo = coursePointsFilled(c, false, 0);
    expect(lo).toBeCloseTo((100 + 98 + 79.1667) / 3, 3); // already locked, nothing lost by a bad 4th
    const r = neededForTarget(c, false, 95);
    expect(r.status).toBe("needed");
    // need (95*3 - 100 - 98) = 87 on the 4th; naive "remaining weight 25%" math would say otherwise
    if (r.status === "needed") expect(r.pct).toBeCloseTo(87, 4);
    expect(neededForTarget(c, false, 92).status).toBe("secured");
    expect(neededForTarget(c, false, 99.5).status).toBe("out_of_reach");
  });

  it("drop-lowest respects the drop", () => {
    const c = course([sec({ kind: "dropLowest", k: 1 }, [it_(90), it_(80), it_(null)])]);
    // x = 0 is dropped, leaving (90+80)/2 = 85 locked. Reaching 87 needs (90+x)/2 >= 87, x = 84
    expect(neededForTarget(c, false, 85).status).toBe("secured");
    const r = neededForTarget(c, false, 87);
    if (r.status !== "needed") throw new Error(r.status);
    expect(r.pct).toBeCloseTo(84, 4);
  });

  it("single remaining needs a real item to give raw marks", () => {
    const c = course([sec({ kind: "sum" }, [it_(40, 50), it_(null, 50)])]);
    const single = singleRemaining(c, false);
    expect(single?.max).toBe(50);
    const s = summarize(c, false);
    const b = s.needs.find((n) => n.band.label === "A")!;
    expect(b.raw).toBeCloseTo(45, 6); // 85 of 100 total, have 40
  });

  it("out of reach reports the best possible", () => {
    const c = course([sec({ kind: "sum" }, [it_(10, 50), it_(null, 50)])]);
    const r = neededForTarget(c, false, 90);
    expect(r).toEqual({ status: "out_of_reach", best: 60 });
  });
});

describe("bands", () => {
  it("default preset is valid", () => {
    expect(validateBands(DEFAULT_BANDS)).toEqual([]);
  });
  it("rejects non-descending thresholds", () => {
    const issues = validateBands([
      { label: "A", min: 80 },
      { label: "B", min: 80 },
      { label: "C", min: 85 },
    ]);
    expect(issues.map((i) => i.index)).toEqual([1, 2]);
  });
  it("bandFor picks the highest band met (inclusive)", () => {
    expect(bandFor(DEFAULT_BANDS, 85)?.label).toBe("A");
    expect(bandFor(DEFAULT_BANDS, 84.99)?.label).toBe("A-");
    expect(bandFor(DEFAULT_BANDS, 3)?.label).toBe("F");
    expect(bandFor(DEFAULT_BANDS, null)).toBeNull();
  });
});

describe("countedItemIds", () => {
  it("marks PA2 as dropped in the fixture", async () => {
    const { countedItemIds } = await import("./calc");
    const c = cs1101sFixture();
    const ra = c.sections.find((x) => x.name === "RA/PA")!;
    const counted = countedItemIds(ra, false);
    expect(ra.items.filter((i) => !counted.has(i.id)).map((i) => i.name)).toEqual(["PA2"]);
  });
});

describe("fully excused sections", () => {
  it("drop out, and their weight is spread over the rest", async () => {
    const c = cs1101sFixture();
    const fin = c.sections.find((x) => x.name === "Final")!;
    fin.items[0].excused = true;
    const s = summarize(c, false);
    expect(s.remaining).toBeCloseTo(0, 9); // nothing left to do
    expect(s.single).toBeNull();
    // 62.67 of the 70 points still in play, scaled to the whole course
    expect(s.locked).toBeCloseTo((62.6733 * 100) / 70, 2);
    expect(s.current!).toBeCloseTo(89.53, 2);
  });
});
