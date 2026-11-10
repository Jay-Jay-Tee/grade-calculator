import { countedItemIds, effectiveScore } from "./calc";
import type { ClassStats, Course, GradeBand, Item, Section } from "./types";

/**
 * Curved (relative) grading. Your grade depends on where you sit in the class, so this works
 * from the class stats an LMS shows per assessment (low, quartiles, median/mean, high).
 *
 * This is an estimate:
 * - An item's percentile is interpolated between the known stat points.
 * - Course standing is the weighted average of item percentiles, weighted by how much each item
 *   counts toward the course. Averaging percentiles isn't exactly the percentile of the average
 *   (people who do well on one test tend to do well on others), but it's a fair rough guide.
 */

const EPS = 1e-9;

export function hasStats(s: ClassStats | undefined | null): boolean {
  return !!s && [s.lower, s.median, s.mean, s.upper].some((v) => v != null);
}

/**
 * Estimated percentile (0-100, from the bottom) of `score` in the class, or null without
 * enough stats. Missing low/high default to 0 marks (0th) and full marks (100th).
 */
export function percentileOf(score: number, max: number, s: ClassStats | undefined | null): number | null {
  if (!s || !hasStats(s)) return null;
  const raw: [number, number][] = [];
  raw.push([s.low ?? 0, 0]);
  if (s.lower != null) raw.push([s.lower, 25]);
  const mid = s.median ?? s.mean;
  if (mid != null) raw.push([mid, 50]);
  if (s.upper != null) raw.push([s.upper, 75]);
  raw.push([s.high ?? max, 100]);
  // Keep anchors in order; drop any that contradict the ones before (bad data).
  const pts: [number, number][] = [];
  for (const p of raw.sort((a, b) => a[1] - b[1])) {
    if (pts.length === 0 || p[0] >= pts[pts.length - 1][0]) pts.push(p);
  }
  if (score <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (score > last[0]) return 100;
  // Score equal to tied anchors (e.g. many students on full marks): take the middle of the tie.
  const tied = pts.filter((p) => Math.abs(p[0] - score) < EPS);
  if (tied.length > 1) return (tied[0][1] + tied[tied.length - 1][1]) / 2;
  for (let i = 1; i < pts.length; i++) {
    const [v0, p0] = pts[i - 1];
    const [v1, p1] = pts[i];
    if (score <= v1) return v1 - v0 < EPS ? p1 : p0 + ((score - v0) / (v1 - v0)) * (p1 - p0);
  }
  return 100;
}

export function itemPercentile(item: Item, whatIf: boolean): number | null {
  const sc = effectiveScore(item, whatIf);
  if (sc == null || !(item.max > 0)) return null;
  return percentileOf(sc, item.max, item.stats);
}

/** Course points each graded item is worth right now (dropped best-N items count 0). */
export function itemCourseWeights(section: Section, whatIf: boolean): Map<string, number> {
  const out = new Map<string, number>();
  const rule = section.rule;
  if (rule.kind === "sum") {
    const total = section.items.reduce((a, i) => a + Math.max(0, i.max), 0);
    for (const i of section.items) out.set(i.id, total > 0 ? (section.weight * Math.max(0, i.max)) / total : 0);
    return out;
  }
  if (rule.kind === "average") {
    for (const i of section.items) out.set(i.id, section.items.length ? section.weight / section.items.length : 0);
    return out;
  }
  const counted = countedItemIds(section, whatIf);
  const slots =
    rule.kind === "bestN" ? rule.n : Math.max(1, section.items.length - Math.max(0, Math.floor(rule.k)));
  for (const i of section.items) out.set(i.id, counted.has(i.id) ? section.weight / slots : 0);
  return out;
}

export type Standing = {
  /** Estimated percentile from the bottom (0-100), null without any items that have stats. */
  pct: number | null;
  /** Course points of graded items that have class stats. */
  covered: number;
  /** Course points of all graded items. */
  graded: number;
  itemsWithStats: number;
  itemsGraded: number;
};

export function courseStanding(course: Course, whatIf: boolean): Standing {
  let sum = 0;
  let covered = 0;
  let graded = 0;
  let itemsWithStats = 0;
  let itemsGraded = 0;
  for (const s of course.sections) {
    const w = itemCourseWeights(s, whatIf);
    for (const it of s.items) {
      if (effectiveScore(it, whatIf) == null) continue;
      const wi = w.get(it.id) ?? 0;
      itemsGraded++;
      graded += wi;
      const p = itemPercentile(it, whatIf);
      if (p == null) continue;
      itemsWithStats++;
      if (wi <= 0) continue;
      sum += p * wi;
      covered += wi;
    }
  }
  return { pct: covered > 0 ? sum / covered : null, covered, graded, itemsWithStats, itemsGraded };
}

/** Bands that have a "top %" cutoff, best first. */
export function relativeBands(bands: GradeBand[]): GradeBand[] {
  return bands.filter((b) => b.top != null).sort((a, b) => a.top! - b.top!);
}

/** Band for a standing of "top `top`%". */
export function relativeBandFor(bands: GradeBand[], top: number | null): GradeBand | null {
  if (top == null) return null;
  const sorted = relativeBands(bands);
  for (const b of sorted) if (top <= b.top! + EPS) return b;
  return sorted[sorted.length - 1] ?? null;
}

export type RelativeNeed =
  | { status: "secured" }
  | { status: "out_of_reach" }
  | { status: "needed"; top: number }; // place in the top `top`% on what's left

/**
 * Where you need to place on the remaining `remaining` course points to end in the top `t`%.
 * Solves (P*W + x*R) / (W + R) >= 100 - t for x (the percentile needed on the rest).
 */
export function relativeNeed(standing: Standing, remaining: number, t: number): RelativeNeed {
  const target = 100 - t;
  const W = standing.pct == null ? 0 : standing.covered;
  const P = standing.pct ?? 0;
  if (remaining < EPS) return W > 0 && P >= target - EPS ? { status: "secured" } : { status: "out_of_reach" };
  const x = (target * (W + remaining) - P * W) / remaining;
  if (x <= EPS) return { status: "secured" };
  if (x > 100 + EPS) return { status: "out_of_reach" };
  return { status: "needed", top: 100 - x };
}

/** Plain words for a "top x%" placement. */
export function placementHint(top: number): string {
  if (top <= 25) return "above the upper quartile";
  if (top <= 50) return "above the median";
  if (top <= 75) return "above the lower quartile";
  return `stay out of the bottom ${Math.max(1, Math.round(100 - top))}%`;
}

/** Default curved cutoffs ("top x% of the class get this grade or better"). A guess; editable. */
export const DEFAULT_TOP: Record<string, number> = {
  "A+": 5,
  A: 25,
  "A-": 40,
  "B+": 55,
  B: 70,
  "B-": 80,
  "C+": 88,
  C: 94,
  "D+": 97,
  D: 99,
  F: 100,
};

/** Fill in missing "top %" cutoffs: known labels get the defaults, others are spread evenly. */
export function withTopCutoffs(bands: GradeBand[]): GradeBand[] {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const n = sorted.length;
  return sorted.map((b, i) => {
    if (b.top != null) return b;
    const top = DEFAULT_TOP[b.label.trim()] ?? (i === n - 1 ? 100 : Math.round(((i + 1) / n) * 100));
    return { ...b, top };
  });
}

/** Curved cutoffs must go strictly up (best grade = smallest top %), each within 0-100. */
export function validateTop(bands: GradeBand[]): { index: number; message: string }[] {
  const issues: { index: number; message: string }[] = [];
  bands.forEach((b, i) => {
    if (b.top == null || !Number.isFinite(b.top)) issues.push({ index: i, message: "Set a top %" });
    else if (b.top <= 0 || b.top > 100) issues.push({ index: i, message: "Top % must be between 0 and 100" });
    else if (i > 0 && bands[i - 1].top != null && !(b.top > bands[i - 1].top!)) {
      issues.push({ index: i, message: `Must be more than ${bands[i - 1].label} (top ${bands[i - 1].top}%)` });
    }
  });
  return issues;
}
