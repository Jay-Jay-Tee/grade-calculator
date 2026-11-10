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

import { matchSection, similarity } from "./draft";
import type { DraftSection } from "./types";

describe("section matching", () => {
  const ds = (name: string, key = name, existingId: string | null = null): DraftSection => ({
    key,
    existingId,
    name,
    weight: 10,
    weightKnown: true,
    rule: { kind: "sum" },
    evidence: "",
    include: true,
  });
  it("scores names by shared words and prefixes", () => {
    expect(similarity("Midterm", "Midterm Exam")).toBeGreaterThan(0.5);
    expect(similarity("Quizzes", "Quiz")).toBeGreaterThan(0.5);
    expect(similarity("Lab 3", "Labs")).toBeGreaterThan(0.5);
    expect(similarity("Final", "Midterm")).toBe(0);
  });
  it("picks the best section, not the first that contains the name", () => {
    const secs = [ds("Lab Reports"), ds("Labs")];
    expect(matchSection("Labs", "Lab 2", secs)).toBe("Labs");
    expect(matchSection(null, "Midterm Exam", [ds("Final Exam"), ds("Midterm")])).toBe("Midterm");
  });
  it("leaves near-ties unassigned instead of guessing", () => {
    expect(matchSection("Exam", "Exam", [ds("Exam A"), ds("Exam B")])).toBeNull();
  });
  it("uses a remembered mapping first", () => {
    const secs = [ds("Tutorial Work", "t", "sec-tut"), ds("Quizzes", "q", "sec-q")];
    expect(matchSection("Weekly Problem Sets", "PS 1", secs)).toBeNull();
    expect(matchSection("Weekly Problem Sets", "PS 1", secs, { weeklyproblemset: "sec-tut" })).toBe("t");
  });
});

describe("learning mappings on apply", () => {
  it("remembers where a source group's items were moved", () => {
    const d = buildDraft([parseText("PS 1\nWeekly Problem Sets\n8 / 10\nPS 2\nWeekly Problem Sets\n9 / 10", "lms")], null);
    const tut = { key: "t", existingId: null, name: "Tutorial Work", weight: 100, weightKnown: true, rule: { kind: "sum" as const }, evidence: "", include: true };
    d.sections = [tut];
    for (const it of d.items) it.sectionKey = "t";
    const course = applyDraft(d, null, DEFAULT_PRESET);
    const secId = course.sections[0].id;
    expect(course.aliases).toEqual({ weeklyproblemset: secId });
    // next import into this course goes straight to Tutorial Work
    const again = buildDraft([parseText("PS 3\nWeekly Problem Sets\nClick to test a different score\n7 / 10", "lms")], course);
    expect(again.items[0].sectionKey).toBe(again.sections.find((s) => s.existingId === secId)!.key);
  });
});

describe("excused items", () => {
  it("reads EX scores and Excused status from Canvas", () => {
    const r = parseText("Lab 4\nLabs\nEX\n/ 10\nLab 5\nLabs\nEX / 10\nLab 6\nLabs\nExcused\n- / 10\nLab 7\nLabs\n6 / 10");
    expect(r.items.map((i) => [i.name, !!i.excused])).toEqual([
      ["Lab 4", true],
      ["Lab 5", true],
      ["Lab 6", true],
      ["Lab 7", false],
    ]);
    const course = applyDraft(buildDraft([r], null), null, DEFAULT_PRESET);
    expect(course.sections[0].items.filter((i) => i.excused)).toHaveLength(3);
  });
  it("flags items Canvas says are dropped", () => {
    const r = parseText("Quiz 1\nQuizzes\n2 / 10\nThis assignment is dropped and will not be considered in the total calculation\nQuiz 2\nQuizzes\n9 / 10");
    expect(r.items[0].flags).toContain("dropped");
    expect(r.items[1].flags).not.toContain("dropped");
  });
});
