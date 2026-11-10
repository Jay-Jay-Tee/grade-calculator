import { describe, expect, it } from "vitest";
import { parseText, parseWeightLine } from "./textParser";

const CANVAS = `Grades for Student
Course
CS1101S Programming Methodology
Arrange By
Due Date
Apply
Name	Due	Submitted	Status	Score	Out of	Details	Submission Progress Status
Check-In 1
Check-Ins
Aug 15 by 23:59
Click to test a different score
1
/ 1
Score Details
Mean:
0.95
High:
1
Low:
0
RA1
RA/PA
Sep 20 by 10:00	Sep 20 at 10:02
Click to test a different score
Score: 60 out of 60 points.
60 / 60
Score Details
Mean:
51.2
High:
60
Low:
18
PA2
RA/PA
Nov 1 by 12:00
Click to test a different score
0
/ 100
Score Details
Mean:
61.1
High:
100
Low:
22
Midterm
Midterm
Oct 4 by 12:00
Click to test a different score
72.5 / 100
Final
Final
Nov 29 by 17:00
-
/ 100
Assignments are weighted by group:
Group	Weight
Check-Ins	3%
RA/PA	24%
Midterm	20%
Final	30%
Total	100%`;

describe("Canvas paste parser", () => {
  const r = parseText(CANVAS);

  it("finds items with names, groups and scores", () => {
    expect(r.items.map((i) => [i.name, i.section, i.score, i.max])).toEqual([
      ["Check-In 1", "Check-Ins", 1, 1],
      ["RA1", "RA/PA", 60, 60],
      ["PA2", "RA/PA", 0, 100],
      ["Midterm", "Midterm", 72.5, 100],
      ["Final", "Final", null, 100],
    ]);
  });

  it("flags a 0 when the class low is above 0", () => {
    expect(r.items.find((i) => i.name === "PA2")!.flags).toContain("suspicious_zero");
    expect(r.items.find((i) => i.name === "Check-In 1")!.flags).not.toContain("suspicious_zero");
  });

  it("keeps class stats for curved grading", () => {
    expect(r.items.find((i) => i.name === "RA1")!.stats).toEqual({ mean: 51.2, high: 60, low: 18 });
  });

  it("reads quartiles and median", () => {
    const q = parseText("Quiz 3\nQuizzes\n7 / 10\nScore Details\nMean:\n6.1\nMedian:\n6\nUpper Quartile:\n8\nLower Quartile: 5\nHigh:\n10\nLow:\n1");
    expect(q.items[0].stats).toEqual({ mean: 6.1, median: 6, upper: 8, lower: 5, high: 10, low: 1 });
  });

  it("reads name and group for a single pasted Canvas item", () => {
    const one = parseText("Quiz 3\nQuizzes\n7 / 10\nScore Details\nMedian:\n6");
    expect(one.items.map((i) => [i.name, i.section])).toEqual([["Quiz 3", "Quizzes"]]);
  });

  it("reads the group weight table", () => {
    expect(r.sections.map((s) => [s.name, s.weight])).toEqual([
      ["Check-Ins", 3],
      ["RA/PA", 24],
      ["Midterm", 20],
      ["Final", 30],
    ]);
  });

  it("guesses the course code", () => {
    expect(r.courseName).toBe("CS1101S");
  });
});

describe("syllabus weight lines", () => {
  it("pools 'x% each, best n of m'", () => {
    const s = parseWeightLine("RA1, PA1, RA2, PA2 at 8% each, best 3 of 4 count")!;
    expect(s.name).toBe("RA1/PA1/RA2/PA2");
    expect(s.weight).toBe(24);
    expect(s.rule).toEqual({ kind: "bestN", n: 3, total: 4 });
  });
  it("reads best-of with a section weight", () => {
    const s = parseWeightLine("Check-Ins 3% (best 18 of 20)")!;
    expect(s).toMatchObject({ name: "Check-Ins", weight: 3, rule: { kind: "bestN", n: 18, total: 20 } });
  });
  it("reads plain and drop-lowest lines", () => {
    expect(parseWeightLine("Final Exam - 30%")).toMatchObject({ name: "Final Exam", weight: 30, rule: null });
    expect(parseWeightLine("Tutorials: 10% (lowest 2 dropped)")).toMatchObject({
      name: "Tutorials",
      weight: 10,
      rule: { kind: "dropLowest", k: 2 },
    });
    expect(parseWeightLine("Total 100%")).toBeNull();
  });
});

describe("results email lines", () => {
  it("reads 'Name score/max' and 'Name: x out of y'", () => {
    const r = parseText("Hi all,\nMidterm: 72.5/100\nRA2 57 / 72 marks\nPA1 - 49 out of 50");
    expect(r.items.map((i) => [i.name, i.score, i.max])).toEqual([
      ["Midterm", 72.5, 100],
      ["RA2", 57, 72],
      ["PA1", 49, 50],
    ]);
  });
});
