import { active, countedItemIds, effectiveScore } from "./calc";
import { normCdf, normInv, Z_QUARTILE } from "./normal";
import type { ClassStats, Course, GradeBand, Item, Section } from "./types";

/**
 * Curved (relative) grading. Your grade depends on where you sit in the class, so this works
 * from the class stats an LMS shows per assessment (low, quartiles, median/mean, high).
 *
 * Model (v2):
 * 1. Each item's score is turned into a z-score by interpolating between the stats, placed at
 *    their normal-distribution positions (quartiles at +-0.674, median at 0, low/high at +-z_n
 *    where z_n depends on class size). Interpolating in z, not in percentile, gives realistic tails.
 * 2. Each item's spread (sigma, in marks) is estimated from the interquartile range.
 * 3. Items are combined in course points: s_i = sigma_i x (course points per mark). Your total's
 *    z-score is sum(s_i z_i) / sqrt(Var), where Var assumes every pair of assessments correlates
 *    with rho. We don't know rho, so standing is reported at rho = 0.6 with a range for 0.4..0.8.
 *    Unlike averaging percentiles, this doesn't understate steady performers, and tests with a
 *    wide spread move your rank more than tests where everyone scored about the same.
 */

const EPS = 1e-9;
export const RHO_CENTRAL = 0.6;
export const RHO_RANGE: [number, number] = [0.4, 0.8];
export const DEFAULT_CLASS_SIZE = 100;
/** Assumed spread of work still to come, as a share of its points, when no item gives a better guess. */
const DEFAULT_SPREAD_RATIO = 0.15;

export function hasStats(s: ClassStats | undefined | null): boolean {
  return !!s && [s.lower, s.median, s.mean, s.upper].some((v) => v != null);
}

/** z of the class's lowest / highest score for a class of n: Phi^-1(1 - 1/(2n)). */
export function tailZ(n: number): number {
  return normInv(1 - 1 / (2 * Math.max(2, n)));
}

function classSize(course: Course | null, s: ClassStats | undefined): number {
  return s?.n ?? course?.curve?.classSize ?? DEFAULT_CLASS_SIZE;
}

/** Stat anchors as [marks, z], in order. Bad (out of order) anchors are dropped. */
function anchors(s: ClassStats, max: number, n: number): [number, number][] {
  const zn = tailZ(n);
  const raw: [number, number][] = [];
  if (s.low != null) raw.push([s.low, -zn]);
  if (s.lower != null) raw.push([s.lower, -Z_QUARTILE]);
  const mid = s.median ?? s.mean;
  if (mid != null) raw.push([mid, 0]);
  if (s.upper != null) raw.push([s.upper, Z_QUARTILE]);
  if (s.high != null) raw.push([s.high, zn]);
  // With a single anchor there's no slope; fall back to the full mark range as the tails.
  if (raw.length < 2) {
    if (s.low == null) raw.unshift([0, -zn]);
    if (s.high == null) raw.push([max, zn]);
  }
  const pts: [number, number][] = [];
  for (const p of raw.sort((a, b) => a[1] - b[1])) {
    if (pts.length === 0 || p[0] >= pts[pts.length - 1][0]) pts.push(p);
  }
  return pts;
}

/** Estimated z-score of `score` in the class, or null without enough stats. */
export function zOf(score: number, max: number, s: ClassStats | undefined | null, n = DEFAULT_CLASS_SIZE): number | null {
  if (!s || !hasStats(s)) return null;
  const pts = anchors(s, max, n);
  if (pts.length < 2) return null;
  const zn = tailZ(n);
  const clamp = (z: number) => Math.max(-zn, Math.min(zn, z));
  // Several stats on the same mark (e.g. upper quartile and high both at full marks): everyone in
  // that tied group shares the mark, so place the score in the middle of the group by percentile.
  const tied = pts.filter((p) => Math.abs(p[0] - score) < EPS);
  if (tied.length > 1) return clamp(normInv((normCdf(tied[0][1]) + normCdf(tied[tied.length - 1][1])) / 2));
  // Full marks when the class high is also full marks: a group sits at the cap. Estimate its size
  // from the item's median and spread, and place the score in the middle of that group.
  const mid = s.median ?? s.mean;
  const sd = spreadOf(s, n);
  if (mid != null && sd != null) {
    if (score >= max - EPS && s.high != null && s.high >= max - EPS) {
      const share = Math.max(1 / (2 * n), 1 - normCdf((max - mid) / sd));
      return clamp(normInv(1 - share / 2));
    }
    if (score <= EPS && s.low != null && s.low <= EPS) {
      const share = Math.max(1 / (2 * n), normCdf((0 - mid) / sd));
      return clamp(normInv(share / 2));
    }
  }
  const seg = (a: [number, number], b: [number, number]) =>
    b[0] - a[0] < EPS ? b[1] : a[1] + ((score - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
  if (score <= pts[0][0]) return clamp(seg(pts[0], pts[1]));
  const last = pts.length - 1;
  if (score >= pts[last][0]) return clamp(seg(pts[last - 1], pts[last]));
  for (let i = 1; i < pts.length; i++) if (score <= pts[i][0]) return clamp(seg(pts[i - 1], pts[i]));
  return clamp(pts[last][1]);
}

/** Estimated percentile (0-100 from the bottom). Kept for item tags and older callers. */
export function percentileOf(score: number, max: number, s: ClassStats | undefined | null, n = DEFAULT_CLASS_SIZE): number | null {
  const z = zOf(score, max, s, n);
  return z == null ? null : 100 * normCdf(z);
}

/** Spread of an item in marks, from the stats. Null if it can't be estimated. */
export function spreadOf(s: ClassStats | undefined | null, n = DEFAULT_CLASS_SIZE): number | null {
  if (!s) return null;
  const mid = s.median ?? s.mean;
  let sd: number | null = null;
  if (s.upper != null && s.lower != null && s.upper > s.lower) sd = (s.upper - s.lower) / (2 * Z_QUARTILE);
  else if (s.upper != null && mid != null && s.upper > mid) sd = (s.upper - mid) / Z_QUARTILE;
  else if (s.lower != null && mid != null && mid > s.lower) sd = (mid - s.lower) / Z_QUARTILE;
  else if (s.high != null && s.low != null && s.high > s.low) sd = (s.high - s.low) / (2 * tailZ(n));
  return sd != null && sd > 0 ? sd : null;
}

export function itemPercentile(item: Item, whatIf: boolean, courseClassSize?: number | null): number | null {
  const sc = effectiveScore(item, whatIf);
  if (sc == null || !(item.max > 0) || item.excused) return null;
  return percentileOf(sc, item.max, item.stats, item.stats?.n ?? courseClassSize ?? DEFAULT_CLASS_SIZE);
}

/** Course points each graded item is worth right now (dropped best-N items count 0, excused count nowhere). */
export function itemCourseWeights(section: Section, whatIf: boolean): Map<string, number> {
  const sec = active(section);
  const out = new Map<string, number>();
  const rule = sec.rule;
  if (rule.kind === "sum") {
    const total = sec.items.reduce((a, i) => a + Math.max(0, i.max), 0);
    for (const i of sec.items) out.set(i.id, total > 0 ? (sec.weight * Math.max(0, i.max)) / total : 0);
    return out;
  }
  if (rule.kind === "average") {
    for (const i of sec.items) out.set(i.id, sec.items.length ? sec.weight / sec.items.length : 0);
    return out;
  }
  const counted = countedItemIds(sec, whatIf);
  const slots = rule.kind === "bestN" ? rule.n : Math.max(1, sec.items.length - Math.max(0, Math.floor(rule.k)));
  for (const i of sec.items) out.set(i.id, counted.has(i.id) ? sec.weight / slots : 0);
  return out;
}

/** Sufficient statistics of your known items for the combined z-score. */
type Parts = { S: number; sum: number; sumSq: number };

function combinedZ(p: Parts, rho: number): number | null {
  const V = p.sumSq + rho * (p.sum * p.sum - p.sumSq);
  return V > EPS ? p.S / Math.sqrt(V) : null;
}

export type Standing = {
  /** Estimated percentile from the bottom (0-100) at rho = 0.6, null without usable stats. */
  pct: number | null;
  /** Percentile range for rho in 0.4..0.8 (low <= high). */
  low: number | null;
  high: number | null;
  /** Course points of graded items that have usable class stats. */
  covered: number;
  /** Course points of all graded items. */
  graded: number;
  itemsWithStats: number;
  itemsGraded: number;
  /** Items that have stats but no way to estimate their spread. */
  noSpread: string[];
  parts: Parts;
  /** sigma / max of known items, used to guess the spread of work still to come. */
  spreadRatios: number[];
};

export function courseStanding(course: Course, whatIf: boolean): Standing {
  const parts: Parts = { S: 0, sum: 0, sumSq: 0 };
  let covered = 0;
  let graded = 0;
  let itemsWithStats = 0;
  let itemsGraded = 0;
  const noSpread: string[] = [];
  const spreadRatios: number[] = [];
  for (const s of course.sections) {
    const w = itemCourseWeights(s, whatIf);
    for (const it of active(s).items) {
      const sc = effectiveScore(it, whatIf);
      if (sc == null || !(it.max > 0)) continue;
      const wi = w.get(it.id) ?? 0;
      itemsGraded++;
      graded += wi;
      if (!hasStats(it.stats)) continue;
      const n = classSize(course, it.stats);
      const z = zOf(sc, it.max, it.stats, n);
      const sd = spreadOf(it.stats, n);
      if (z == null) continue;
      itemsWithStats++;
      if (sd == null) {
        noSpread.push(it.name);
        continue;
      }
      spreadRatios.push(sd / it.max);
      if (wi <= 0) continue;
      const si = (wi / it.max) * sd; // spread in course points
      parts.S += si * z;
      parts.sum += si;
      parts.sumSq += si * si;
      covered += wi;
    }
  }
  const at = (rho: number) => {
    const z = combinedZ(parts, rho);
    return z == null ? null : 100 * normCdf(z);
  };
  const c = at(RHO_CENTRAL);
  const a = at(RHO_RANGE[0]);
  const b = at(RHO_RANGE[1]);
  return {
    pct: c,
    low: a == null || b == null ? null : Math.min(a, b),
    high: a == null || b == null ? null : Math.max(a, b),
    covered,
    graded,
    itemsWithStats,
    itemsGraded,
    noSpread,
    parts,
    spreadRatios,
  };
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
  /** Place in the top `top`% on what's left (rho = 0.6), with the range for rho in 0.4..0.8. */
  | { status: "needed"; top: number; topLow: number; topHigh: number };

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Where you need to place on the remaining `remaining` course points to end in the top `t`%.
 * The rest is one block with spread s_R; solve sum(s z) + s_R z_R = z_target sqrt(Var_all).
 */
export function relativeNeed(standing: Standing, remaining: number, t: number, classN = DEFAULT_CLASS_SIZE): RelativeNeed {
  const zn = tailZ(classN);
  const zTarget = normInv(Math.min(1 - 1e-9, Math.max(1e-9, 1 - t / 100)));
  const solve = (rho: number): number => {
    const p = standing.parts;
    if (remaining < EPS) {
      const z = combinedZ(p, rho);
      return z != null && z >= zTarget - EPS ? -Infinity : Infinity;
    }
    const sR = remaining * (median(standing.spreadRatios) ?? DEFAULT_SPREAD_RATIO);
    const sum = p.sum + sR;
    const sumSq = p.sumSq + sR * sR;
    const V = sumSq + rho * (sum * sum - sumSq);
    return (zTarget * Math.sqrt(V) - p.S) / sR;
  };
  const zc = solve(RHO_CENTRAL);
  if (zc < -zn) return { status: "secured" };
  if (zc > zn) return { status: "out_of_reach" };
  const topOf = (z: number) => 100 * (1 - normCdf(Math.max(-zn, Math.min(zn, z))));
  const ta = topOf(solve(RHO_RANGE[0]));
  const tb = topOf(solve(RHO_RANGE[1]));
  return { status: "needed", top: topOf(zc), topLow: Math.min(ta, tb), topHigh: Math.max(ta, tb) };
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
