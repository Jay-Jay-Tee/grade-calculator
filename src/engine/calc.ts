import type { Course, GradeBand, Item, Section } from "./types";

/**
 * Pure calculation engine. Every function here is side-effect free.
 *
 * Terminology:
 * - "effective score": the what-if score when what-if mode is on and one is set, else the real score.
 * - "graded": an item with an effective score.
 * - "unknown slot": anything not graded yet - an ungraded item, a planned best-N slot that has
 *   no item yet, or a section with no items at all.
 * - "filled" evaluation: every unknown slot is assumed to score `fill` percent. Filling with 0
 *   gives the minimum possible (locked points), filling with 100 gives the maximum possible.
 *   Because the course total is monotonic in `fill`, the score needed on what's left is found
 *   by bisection, which handles best-N and drop-lowest rules correctly (a low score that would
 *   be dropped simply doesn't move the total).
 */

const EPS = 1e-9;

export function effectiveScore(item: Item, whatIf: boolean): number | null {
  if (whatIf && item.whatIf != null) return item.whatIf;
  return item.score;
}

/** Item percentage (0-100), or null if the item isn't graded or has no max. */
export function itemPct(item: Item, whatIf: boolean): number | null {
  const s = effectiveScore(item, whatIf);
  if (s == null || !(item.max > 0)) return null;
  return (s / item.max) * 100;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function topN(xs: number[], n: number): number[] {
  return [...xs].sort((a, b) => b - a).slice(0, Math.max(0, n));
}

function dropLowest(xs: number[], k: number): number[] {
  const drop = Math.min(Math.max(0, Math.floor(k)), xs.length - 1);
  return [...xs].sort((a, b) => a - b).slice(drop);
}

/** Number of item slots a best-N section will eventually have. */
export function bestNSlots(section: Section): number {
  if (section.rule.kind !== "bestN") return section.items.length;
  return Math.max(section.rule.total ?? 0, section.rule.n, section.items.length);
}

/**
 * Section percentage based only on what's graded. Null if nothing is graded.
 * For best-N with fewer than n graded, all graded items count.
 */
export function sectionPct(section: Section, whatIf: boolean): number | null {
  const rule = section.rule;
  if (rule.kind === "sum") {
    let earned = 0;
    let max = 0;
    let any = false;
    for (const it of section.items) {
      const s = effectiveScore(it, whatIf);
      if (s == null) continue;
      any = true;
      earned += s;
      max += Math.max(0, it.max);
    }
    if (!any || max <= 0) return null;
    return (earned / max) * 100;
  }
  const pcts = section.items.map((it) => itemPct(it, whatIf)).filter((p): p is number => p != null);
  if (pcts.length === 0) return null;
  switch (rule.kind) {
    case "average":
      return mean(pcts);
    case "bestN":
      return mean(topN(pcts, rule.n));
    case "dropLowest":
      return mean(dropLowest(pcts, rule.k));
  }
}

/** Section percentage with every unknown slot assumed to score `fill` percent. */
export function sectionPctFilled(section: Section, whatIf: boolean, fill: number): number {
  const rule = section.rule;
  if (rule.kind === "sum") {
    let earned = 0;
    let max = 0;
    for (const it of section.items) {
      const m = Math.max(0, it.max);
      const s = effectiveScore(it, whatIf);
      earned += s == null ? (fill / 100) * m : s;
      max += m;
    }
    if (max <= 0) return fill;
    return (earned / max) * 100;
  }
  const pcts: number[] = [];
  for (const it of section.items) {
    if (!(it.max > 0)) continue;
    pcts.push(itemPct(it, whatIf) ?? fill);
  }
  if (rule.kind === "bestN") {
    const phantom = bestNSlots(section) - section.items.length;
    for (let i = 0; i < phantom; i++) pcts.push(fill);
  }
  if (pcts.length === 0) return fill;
  switch (rule.kind) {
    case "average":
      return mean(pcts);
    case "bestN":
      return mean(topN(pcts, rule.n));
    case "dropLowest":
      return mean(dropLowest(pcts, rule.k));
  }
}

export type UnknownSlot =
  | { type: "item"; sectionId: string; item: Item }
  | { type: "planned"; sectionId: string; count: number } // best-N slots with no item yet
  | { type: "empty"; sectionId: string }; // section with no items

export function unknownSlots(section: Section, whatIf: boolean): UnknownSlot[] {
  const out: UnknownSlot[] = [];
  for (const it of section.items) {
    if (effectiveScore(it, whatIf) == null && it.max > 0) {
      out.push({ type: "item", sectionId: section.id, item: it });
    }
  }
  if (section.rule.kind === "bestN") {
    const phantom = bestNSlots(section) - section.items.length;
    if (phantom > 0) out.push({ type: "planned", sectionId: section.id, count: phantom });
    else if (section.items.length === 0) out.push({ type: "empty", sectionId: section.id });
  } else if (section.items.length === 0) {
    out.push({ type: "empty", sectionId: section.id });
  }
  return out;
}

export function isFullyGraded(section: Section, whatIf: boolean): boolean {
  return unknownSlots(section, whatIf).length === 0;
}

/** Course points (out of total weight) with unknowns filled at `fill` percent. */
export function coursePointsFilled(course: Course, whatIf: boolean, fill: number): number {
  let pts = 0;
  for (const s of course.sections) pts += (sectionPctFilled(s, whatIf, fill) * s.weight) / 100;
  return pts;
}

export function totalWeight(course: Course): number {
  return course.sections.reduce((a, s) => a + s.weight, 0);
}

/**
 * "How am I doing on what's been assessed": sum of section% x weight over sections with any
 * grade, divided by the sum of those weights. Null if nothing is graded.
 */
export function assessedPct(course: Course, whatIf: boolean): { pct: number | null; points: number; weight: number } {
  let points = 0;
  let weight = 0;
  for (const s of course.sections) {
    const p = sectionPct(s, whatIf);
    if (p == null) continue;
    points += (p * s.weight) / 100;
    weight += s.weight;
  }
  return { pct: weight > 0 ? (points / weight) * 100 : null, points, weight };
}

export type NeededResult =
  | { status: "secured" }
  | { status: "out_of_reach"; best: number }
  | { status: "needed"; pct: number };

/**
 * Average percentage needed on every unknown slot to reach `target` course points.
 * Uses bisection on the filled course total, so best-N / drop-lowest are respected.
 */
export function neededForTarget(course: Course, whatIf: boolean, target: number): NeededResult {
  const lo = coursePointsFilled(course, whatIf, 0);
  if (lo >= target - EPS) return { status: "secured" };
  const hi = coursePointsFilled(course, whatIf, 100);
  if (hi < target - EPS) return { status: "out_of_reach", best: hi };
  let a = 0;
  let b = 100;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (coursePointsFilled(course, whatIf, m) >= target - EPS) b = m;
    else a = m;
  }
  return { status: "needed", pct: b };
}

export type BandNeed = { band: GradeBand; result: NeededResult; raw?: number };

export type SingleRemaining = {
  sectionId: string;
  label: string; // item name, or a description of the planned slot
  max: number | null; // raw max, when it's a real item
};

/** When exactly one unknown slot is left, describe it. */
export function singleRemaining(course: Course, whatIf: boolean): SingleRemaining | null {
  const slots = course.sections.flatMap((s) => unknownSlots(s, whatIf).map((u) => ({ u, s })));
  if (slots.length !== 1) return null;
  const { u, s } = slots[0];
  if (u.type === "item") return { sectionId: s.id, label: u.item.name, max: u.item.max > 0 ? u.item.max : null };
  if (u.type === "planned" && u.count === 1) return { sectionId: s.id, label: `Next ${s.name} item`, max: null };
  if (u.type === "empty") return { sectionId: s.id, label: s.name, max: null };
  return null;
}

/** Band whose min the percentage meets, highest first. Assumes bands sorted descending. */
export function bandFor(bands: GradeBand[], pct: number | null): GradeBand | null {
  if (pct == null) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const b of sorted) if (pct >= b.min - EPS) return b;
  return null;
}

export type CourseSummary = {
  totalWeight: number;
  /** Sum of weights for sections that have any real grade. */
  assessedWeight: number;
  /** Real scores only. */
  current: number | null;
  /** With what-if scores filled in. */
  projected: number | null;
  /** Points that can't be lost (unknowns at 0%), in course points. Respects what-if mode. */
  locked: number;
  /** Locked points + all remaining at 100%. */
  maxPossible: number;
  /** Course points still in play. */
  remaining: number;
  currentBand: GradeBand | null;
  projectedBand: GradeBand | null;
  needs: BandNeed[];
  single: SingleRemaining | null;
};

export function summarize(course: Course, whatIfMode: boolean): CourseSummary {
  const real = assessedPct(course, false);
  const proj = assessedPct(course, whatIfMode);
  const locked = coursePointsFilled(course, whatIfMode, 0);
  const maxPossible = coursePointsFilled(course, whatIfMode, 100);
  const single = singleRemaining(course, whatIfMode);
  const bands = [...course.bands].sort((a, b) => b.min - a.min);
  const needs: BandNeed[] = bands.map((band) => {
    const result = neededForTarget(course, whatIfMode, band.min);
    const need: BandNeed = { band, result };
    if (single?.max != null && result.status === "needed") need.raw = (result.pct / 100) * single.max;
    return need;
  });
  return {
    totalWeight: totalWeight(course),
    assessedWeight: real.weight,
    current: real.pct,
    projected: proj.pct,
    locked,
    maxPossible,
    remaining: maxPossible - locked,
    currentBand: bandFor(course.bands, real.pct),
    projectedBand: bandFor(course.bands, proj.pct),
    needs,
    single,
  };
}

/**
 * Ids of graded items that currently count toward the section (best-N keeps the top n,
 * drop-lowest drops the lowest k). Items not in the set are dropped right now.
 */
export function countedItemIds(section: Section, whatIf: boolean): Set<string> {
  const graded = section.items
    .map((it) => ({ id: it.id, p: itemPct(it, whatIf) }))
    .filter((x): x is { id: string; p: number } => x.p != null);
  const rule = section.rule;
  let keep = graded;
  if (rule.kind === "bestN") keep = [...graded].sort((a, b) => b.p - a.p).slice(0, rule.n);
  else if (rule.kind === "dropLowest") {
    const drop = Math.min(Math.max(0, Math.floor(rule.k)), graded.length - 1);
    keep = [...graded].sort((a, b) => a.p - b.p).slice(drop);
  }
  // Ties with the lowest counted score are shown as counting: it makes no difference which one is dropped.
  const floor = keep.length ? Math.min(...keep.map((x) => x.p)) : Infinity;
  return new Set(graded.filter((x) => keep.includes(x) || Math.abs(x.p - floor) < EPS).map((x) => x.id));
}
