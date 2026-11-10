import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET } from "../engine/bands";
import { summarize } from "../engine/calc";
import { applyDraft, buildDraft, checkWeights, draftProblems, itemFlags } from "./draft";
import { parseText } from "./textParser";

const SYLLABUS = `CS1101S Assessment
Source Academy XP 5%
Studio 5%
Reflection 5%
Check-Ins 3% (best 18 of 20)
RA1, PA1, RA2, PA2 at 8% each, best 3 of 4 count
Mastery Checks 8%
Midterm 20%
Final 30%`;

const GRADES = `RA1
RA/PA
Click to test a different score
60 / 60
PA1
RA/PA
49 / 50
RA2
RA/PA
57 / 72
PA2
RA/PA
57 / 100
Midterm
Midterm
72.5 / 100
Final
Final
- / 100
Mystery Quiz
Quizzes
3 / 10`;

describe("import draft", () => {
  const draft = buildDraft([parseText(SYLLABUS, "syllabus"), parseText(GRADES, "grades")], null);

  it("proposes the pooled best-N section from syllabus text", () => {
    const ra = draft.sections.find((s) => s.name === "RA1/PA1/RA2/PA2")!;
    expect(ra.weight).toBe(24);
    expect(ra.rule).toEqual({ kind: "bestN", n: 3, total: 4 });
    expect(checkWeights(draft.sections)).toEqual({ ok: true, sum: 100 });
  });

  it("assigns items to sections, leaves unknown groups unassigned", () => {
    const raKey = draft.sections.find((s) => s.name.startsWith("RA1"))!.key;
    expect(draft.items.filter((i) => i.sectionKey === raKey).map((i) => i.name)).toEqual(["RA1", "PA1", "RA2", "PA2"]);
    const mystery = draft.items.find((i) => i.name === "Mystery Quiz")!;
    expect(mystery.sectionKey).toBeNull();
    expect(itemFlags(mystery)).toContain("unmatched_item");
    expect(draftProblems(draft).unassigned).toBe(1);
  });

  it("suggests the pooled weight when best-N explains weights_not_100", () => {
    const d = structuredClone(draft);
    d.sections.find((s) => s.name.startsWith("RA1"))!.weight = 32;
    const c = checkWeights(d.sections);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.suggestion?.weight).toBe(24);
  });

  it("applies into a course that reproduces the fixture numbers", () => {
    const d = structuredClone(draft);
    // fill in the full-marks sections by hand, as a user would in review
    const course = applyDraft(d, null, DEFAULT_PRESET);
    for (const name of ["Source Academy XP", "Studio", "Reflection", "Mastery Checks"]) {
      course.sections.find((s) => s.name === name)!.items.push({ id: name, name, max: 100, score: 100, whatIf: null });
    }
    const ci = course.sections.find((s) => s.name === "Check-Ins")!;
    for (let i = 0; i < 20; i++) ci.items.push({ id: `ci${i}`, name: `CI${i}`, max: 1, score: 1, whatIf: null });
    expect(course.name).toBe("CS1101S");
    const s = summarize(course, false);
    expect(s.current!.toFixed(1)).toBe("89.5");
    expect(s.maxPossible).toBeCloseTo(92.67, 2);
    expect(course.sections.flatMap((x) => x.items).some((i) => i.name === "Mystery Quiz")).toBe(false);
  });

  it("merging into an existing course updates scores and keeps what-ifs", () => {
    const course = applyDraft(structuredClone(draft), null, DEFAULT_PRESET);
    course.sections.find((s) => s.name === "Final")!.items[0].whatIf = 80;
    const again = buildDraft([parseText("Final\nFinal\n81 / 100", "email")], course);
    const merged = applyDraft(again, course, DEFAULT_PRESET);
    const fin = merged.sections.find((s) => s.name === "Final")!;
    expect(fin.items).toHaveLength(1);
    expect(fin.items[0]).toMatchObject({ score: 81, whatIf: 80 });
    expect(merged.id).toBe(course.id);
  });
});
