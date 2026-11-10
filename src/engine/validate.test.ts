import { describe, expect, it } from "vitest";
import { cs1101sFixture } from "./fixtures";
import { statsIssue, validateCourse, validateItem, validateSection } from "./validate";
import type { Item, Section } from "./types";

const item = (p: Partial<Item>): Item => ({ id: "i", name: "x", max: 10, score: null, whatIf: null, ...p });
const section = (p: Partial<Section>): Section => ({ id: "s", name: "S", weight: 10, rule: { kind: "sum" }, items: [], ...p });
const msgs = (xs: { level: string; message: string }[]) => xs.map((x) => `${x.level}: ${x.message}`);

describe("input checks", () => {
  it("the fixture is clean", () => {
    expect(validateCourse(cs1101sFixture())).toEqual([]);
  });
  it("rejects negative scores and a max of 0", () => {
    expect(msgs(validateItem(item({ score: -1 })))).toEqual(["error: Score can't be negative"]);
    expect(msgs(validateItem(item({ max: 0 })))).toEqual(["error: Max must be more than 0"]);
    expect(msgs(validateItem(item({ whatIf: -5 })))).toEqual(["error: What-if score can't be negative"]);
  });
  it("warns, not errors, on a score above max", () => {
    expect(validateItem(item({ score: 11 }))[0].level).toBe("warn");
  });
  it("checks weights and rules", () => {
    expect(validateSection(section({ weight: -2 }))[0].message).toBe("Weight can't be negative");
    expect(validateSection(section({ weight: 120 }))[0].message).toBe("Weight can't be more than 100%");
    expect(validateSection(section({ rule: { kind: "bestN", n: 3, total: 2 } }))[0].level).toBe("error");
    expect(validateSection(section({ rule: { kind: "bestN", n: 0 } }))[0].level).toBe("error");
    expect(validateSection(section({ rule: { kind: "bestN", n: 2.5 } }))[0].level).toBe("error");
    expect(validateSection(section({ rule: { kind: "dropLowest", k: -1 } }))[0].level).toBe("error");
    expect(validateSection(section({ rule: { kind: "dropLowest", k: 2 }, items: [item({ id: "a" }), item({ id: "b" })] }))[0].level).toBe("warn");
  });
  it("checks class stats are in order and in range", () => {
    expect(statsIssue({ low: 2, median: 6, upper: 5 }, 10)).toMatch(/Upper quartile \(5\) is below Median/);
    expect(statsIssue({ median: 12 }, 10)).toMatch(/above the max/);
    expect(statsIssue({ low: 1, lower: 3, median: 5, mean: 5.2, upper: 7, high: 10 }, 10)).toBeNull();
  });
  it("flags weights that don't add to 100", () => {
    const c = cs1101sFixture();
    c.sections[0].weight = 10;
    expect(msgs(validateCourse(c))).toEqual(["warn: Weights add up to 105%, not 100%."]);
  });
});
