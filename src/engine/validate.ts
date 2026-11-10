import type { ClassStats, Course, Item, Section } from "./types";

/**
 * Input checks for a course. Errors are values that can't be right (negative marks, a max of 0,
 * "best 3 of 2"). Warnings are unusual but possible (a score above the max can be bonus marks).
 */
export type Issue = {
  level: "error" | "warn";
  sectionId?: string;
  itemId?: string;
  field: "weight" | "rule" | "score" | "whatIf" | "max" | "stats" | "total";
  message: string;
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function validateItem(item: Item, sectionId?: string): Issue[] {
  const out: Issue[] = [];
  const at = { sectionId, itemId: item.id };
  if (!finite(item.max) || item.max <= 0) out.push({ ...at, level: "error", field: "max", message: "Max must be more than 0" });
  for (const field of ["score", "whatIf"] as const) {
    const v = item[field];
    if (v == null) continue;
    const label = field === "score" ? "Score" : "What-if score";
    if (!finite(v)) out.push({ ...at, level: "error", field, message: `${label} isn't a number` });
    else if (v < 0) out.push({ ...at, level: "error", field, message: `${label} can't be negative` });
    else if (finite(item.max) && item.max > 0 && v > item.max) {
      out.push({ ...at, level: "warn", field, message: `${label} is above the max of ${item.max}. Fine if it includes bonus marks.` });
    }
  }
  const sm = statsIssue(item.stats, item.max);
  if (sm) out.push({ ...at, level: "warn", field: "stats", message: sm });
  return out;
}

/** Class stats must be within 0..max and in order: low <= lower quartile <= median <= upper quartile <= high. */
export function statsIssue(s: ClassStats | undefined, max: number): string | null {
  if (!s) return null;
  const order: [keyof ClassStats, string][] = [
    ["low", "Low"],
    ["lower", "Lower quartile"],
    ["median", "Median"],
    ["upper", "Upper quartile"],
    ["high", "High"],
  ];
  for (const k of ["low", "lower", "median", "mean", "upper", "high"] as const) {
    const v = s[k];
    if (v == null) continue;
    if (!finite(v) || v < 0) return "Class stats can't be negative";
    if (finite(max) && max > 0 && v > max) return `Class stats can't be above the max of ${max}`;
  }
  let prev: [string, number] | null = null;
  for (const [k, label] of order) {
    const v = s[k];
    if (v == null) continue;
    if (prev && v < prev[1]) return `${label} (${v}) is below ${prev[0]} (${prev[1]}). Check the class stats.`;
    prev = [label, v];
  }
  if (s.mean != null && ((s.low != null && s.mean < s.low) || (s.high != null && s.mean > s.high))) {
    return "Mean must be between Low and High";
  }
  return null;
}

export function validateSection(s: Section): Issue[] {
  const out: Issue[] = [];
  const at = { sectionId: s.id };
  if (!finite(s.weight) || s.weight < 0) out.push({ ...at, level: "error", field: "weight", message: "Weight can't be negative" });
  else if (s.weight > 100) out.push({ ...at, level: "error", field: "weight", message: "Weight can't be more than 100%" });
  const r = s.rule;
  if (r.kind === "bestN") {
    if (!Number.isInteger(r.n) || r.n < 1) out.push({ ...at, level: "error", field: "rule", message: "Best N needs a whole number of 1 or more" });
    else if (r.total != null && (!Number.isInteger(r.total) || r.total < r.n)) {
      out.push({ ...at, level: "error", field: "rule", message: `Best ${r.n} of ${r.total} isn't possible. The total must be at least ${r.n}.` });
    } else if (r.total != null && s.items.length > r.total) {
      out.push({ ...at, level: "warn", field: "rule", message: `There are ${s.items.length} items but the rule says ${r.total} in total.` });
    }
  } else if (r.kind === "dropLowest") {
    if (!Number.isInteger(r.k) || r.k < 0) out.push({ ...at, level: "error", field: "rule", message: "Drop lowest needs a whole number of 0 or more" });
    else if (s.items.length > 0 && r.k >= s.items.length) {
      out.push({ ...at, level: "warn", field: "rule", message: `Dropping ${r.k} of ${s.items.length} items. The best one always counts.` });
    }
  }
  for (const it of s.items) out.push(...validateItem(it, s.id));
  return out;
}

export function validateCourse(c: Course): Issue[] {
  const out: Issue[] = [];
  for (const s of c.sections) out.push(...validateSection(s));
  const total = c.sections.reduce((a, s) => a + (finite(s.weight) ? s.weight : 0), 0);
  if (c.sections.length > 0 && Math.abs(total - 100) > 0.01) {
    out.push({ level: "warn", field: "total", message: `Weights add up to ${Math.round(total * 100) / 100}%, not 100%.` });
  }
  return out;
}
