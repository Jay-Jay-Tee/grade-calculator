import { cloneBands } from "../engine/bands";
import { uid } from "../engine/id";
import type { AggregationRule, BandPreset, Course, GradeBand, Item, Section } from "../engine/types";
import { norm } from "./textParser";
import type { Draft, DraftItem, DraftSection, Extraction, ExtractedRule, ItemFlag } from "./types";

export function toRule(r: ExtractedRule | null | undefined): AggregationRule {
  if (!r) return { kind: "sum" };
  switch (r.kind) {
    case "average":
      return { kind: "average" };
    case "bestN": {
      const n = Math.round(r.n ?? 0);
      if (n < 1) return { kind: "sum" };
      const total = r.total != null && r.total >= n ? Math.round(r.total) : undefined;
      return total != null ? { kind: "bestN", n, total } : { kind: "bestN", n };
    }
    case "dropLowest":
      return { kind: "dropLowest", k: Math.max(1, Math.round(r.k ?? 1)) };
    default:
      return { kind: "sum" };
  }
}

/** Words of a name, lowercased, with a trailing plural "s" dropped from longer words. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 ? t.replace(/s$/, "") : t));
}

/**
 * How alike two names are, 0..1: shared words (Jaccard), or one name being the start of the
 * other ("Lab" / "Lab 3", "Midterm" / "Midterm Exam"), scaled by how much of it overlaps.
 */
export function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = new Set(words(a));
  const B = new Set(words(b));
  const inter = [...A].filter((t) => B.has(t)).length;
  const union = new Set([...A, ...B]).size;
  let score = union ? inter / union : 0;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length >= 3 && long.startsWith(short)) score = Math.max(score, 0.25 + (0.75 * short.length) / long.length);
  return score;
}

const MATCH_THRESHOLD = 0.5;

/**
 * Find the draft section an item belongs to. Order: a group name the user mapped before
 * (aliases), then the best similarity between the group hint or item name and each section.
 * A near-tie between two sections leaves the item Unassigned rather than guessing.
 */
export function matchSection(
  hint: string | null,
  itemName: string,
  sections: DraftSection[],
  aliases?: Record<string, string>,
): string | null {
  const live = sections.filter((s) => s.include);
  if (hint && aliases) {
    const id = aliases[norm(hint)];
    const hit = id ? live.find((s) => s.existingId === id) : undefined;
    if (hit) return hit.key;
  }
  const n = norm(itemName);
  const scored = live
    .map((s) => {
      let score = 0;
      if (hint) score = Math.max(score, similarity(hint, s.name));
      // Pooled names like "RA1/PA1/RA2/PA2" list their items
      if (s.name.includes("/") && s.name.split("/").some((p) => norm(p) === n)) score = Math.max(score, 0.95);
      score = Math.max(score, 0.9 * similarity(itemName, s.name));
      return { key: s.key, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < MATCH_THRESHOLD) return null;
  if (scored[1] && best.score - scored[1].score < 0.01) return null;
  return best.key;
}

export function buildDraft(extractions: Extraction[], existing: Course | null): Draft {
  const sections: DraftSection[] = [];
  const byNorm = new Map<string, DraftSection>();

  if (existing) {
    for (const s of existing.sections) {
      const d: DraftSection = {
        key: uid(),
        existingId: s.id,
        name: s.name,
        weight: s.weight,
        weightKnown: true,
        rule: s.rule,
        evidence: "Already in course",
        include: true,
      };
      sections.push(d);
      byNorm.set(norm(s.name), d);
    }
  }

  for (const ex of extractions) {
    for (const s of ex.sections) {
      const k = norm(s.name);
      if (!k) continue;
      const prev = byNorm.get(k);
      const rule = s.rule ? toRule(s.rule) : null;
      if (prev) {
        if (s.weight != null && (!prev.weightKnown || prev.existingId)) {
          prev.weight = s.weight;
          prev.weightKnown = true;
        }
        if (rule && rule.kind !== "sum") prev.rule = rule;
        if (s.evidence && !prev.evidence.includes(s.evidence)) {
          prev.evidence = prev.existingId ? s.evidence : [prev.evidence, s.evidence].filter(Boolean).join(" | ");
        }
        continue;
      }
      const d: DraftSection = {
        key: uid(),
        existingId: null,
        name: s.name.trim(),
        weight: s.weight ?? 0,
        weightKnown: s.weight != null,
        rule: rule ?? { kind: "sum" },
        evidence: s.evidence ?? "",
        include: true,
      };
      sections.push(d);
      byNorm.set(k, d);
    }
  }

  // With no weighting info anywhere, make sections from the group hints (weights to fill in).
  const haveStructure = sections.length > 0;
  if (!haveStructure) {
    for (const ex of extractions) {
      for (const it of ex.items) {
        if (!it.section) continue;
        const k = norm(it.section);
        if (!k || byNorm.has(k)) continue;
        const d: DraftSection = {
          key: uid(),
          existingId: null,
          name: it.section.trim(),
          weight: 0,
          weightKnown: false,
          rule: { kind: "sum" },
          evidence: "From assignment group",
          include: true,
        };
        sections.push(d);
        byNorm.set(k, d);
      }
    }
  }

  const items: DraftItem[] = [];
  const itemIndex = new Map<string, DraftItem>();
  for (const ex of extractions) {
    for (const it of ex.items) {
      const name = it.name.trim();
      if (!name) continue;
      const sectionKey = matchSection(it.section, name, sections, existing?.aliases);
      const key = `${norm(name)}|${sectionKey ?? ""}`;
      const flags = it.flags.filter((f): f is ItemFlag => f !== "unmatched_item");
      const prev = itemIndex.get(key);
      if (prev) {
        if (prev.score == null && it.score != null) prev.score = it.score;
        if (prev.max == null && it.max != null) prev.max = it.max;
        for (const f of flags) if (!prev.flags.includes(f)) prev.flags.push(f);
        if (it.stats) prev.stats = { ...prev.stats, ...it.stats };
        if (it.excused) prev.excused = true;
        continue;
      }
      const d: DraftItem = {
        key: uid(),
        name,
        sectionKey,
        sectionHint: it.section,
        score: it.score,
        max: it.max,
        flags,
        stats: it.stats,
        ...(it.excused ? { excused: true } : {}),
        include: true,
      };
      items.push(d);
      itemIndex.set(key, d);
    }
  }

  const bands: GradeBand[] = extractions.find((e) => e.bands.length > 0)?.bands ?? [];
  const courseName = existing?.name ?? extractions.find((e) => e.courseName)?.courseName ?? "New course";

  return {
    courseName,
    sections,
    items,
    bands: cloneBands(bands).sort((a, b) => b.min - a.min),
    useBands: bands.length > 0,
    sources: extractions.map((e) => ({ label: e.source, method: e.method, warnings: e.warnings })),
  };
}

export type WeightCheck =
  | { ok: true; sum: number }
  | { ok: false; sum: number; suggestion: { sectionKey: string; name: string; weight: number } | null };

/** weights_not_100, unless a best-N rule explains the difference (then suggest the pooled weight). */
export function checkWeights(sections: DraftSection[]): WeightCheck {
  const live = sections.filter((s) => s.include);
  const sum = round2(live.reduce((a, s) => a + s.weight, 0));
  if (Math.abs(sum - 100) < 0.01) return { ok: true, sum };
  for (const s of live) {
    if (s.rule.kind !== "bestN" || s.rule.total == null || s.rule.total <= s.rule.n) continue;
    const pooled = round2((s.weight * s.rule.n) / s.rule.total);
    if (Math.abs(sum - s.weight + pooled - 100) < 0.01) {
      return { ok: false, sum, suggestion: { sectionKey: s.key, name: s.name, weight: pooled } };
    }
  }
  return { ok: false, sum, suggestion: null };
}

export function itemFlags(item: DraftItem): ItemFlag[] {
  const f = [...item.flags];
  if (item.sectionKey == null && !f.includes("unmatched_item")) f.push("unmatched_item");
  return f;
}

export type DraftProblems = { badItems: string[]; negative: string[]; unassigned: number; badSections: string[] };

export function draftProblems(d: Draft): DraftProblems {
  const liveKeys = new Set(d.sections.filter((s) => s.include).map((s) => s.key));
  const live = d.items.filter((i) => i.include);
  return {
    badItems: live
      .filter((i) => i.sectionKey && liveKeys.has(i.sectionKey) && !(i.max != null && i.max > 0))
      .map((i) => i.name),
    negative: live.filter((i) => i.score != null && i.score < 0).map((i) => i.name),
    unassigned: live.filter((i) => !i.sectionKey || !liveKeys.has(i.sectionKey)).length,
    badSections: d.sections
      .filter((s) => s.include && (!s.name.trim() || !(s.weight >= 0) || s.weight > 100))
      .map((s) => s.name || "(unnamed)"),
  };
}

/**
 * Apply a reviewed draft. Returns a new course (or an updated copy of `existing`).
 * Unassigned items and unticked rows are skipped. Existing what-if values are kept.
 */
export function applyDraft(d: Draft, existing: Course | null, defaultPreset: BandPreset): Course {
  const base: Course = existing
    ? structuredClone(existing)
    : { id: uid(), name: "New course", sections: [], bands: cloneBands(defaultPreset.bands), presetId: defaultPreset.id };
  base.name = d.courseName.trim() || base.name;
  if (d.useBands && d.bands.length > 0) {
    base.bands = cloneBands(d.bands);
    base.presetId = null;
  }

  const sectionFor = new Map<string, Section>();
  for (const ds of d.sections) {
    if (!ds.include) continue;
    let s = ds.existingId ? base.sections.find((x) => x.id === ds.existingId) : undefined;
    if (s) {
      s.name = ds.name.trim();
      s.weight = ds.weight;
      s.rule = ds.rule;
    } else {
      s = { id: uid(), name: ds.name.trim(), weight: ds.weight, rule: ds.rule, items: [] };
      base.sections.push(s);
    }
    sectionFor.set(ds.key, s);
  }

  for (const di of d.items) {
    if (!di.include || !di.sectionKey) continue;
    const s = sectionFor.get(di.sectionKey);
    if (!s || !(di.max != null && di.max > 0)) continue;
    const match = s.items.find((x) => norm(x.name) === norm(di.name));
    if (match) {
      match.score = di.score;
      match.max = di.max;
      if (di.stats) match.stats = { ...match.stats, ...di.stats };
      if (di.excused != null) match.excused = di.excused || undefined;
    } else {
      const item: Item = { id: uid(), name: di.name.trim(), max: di.max, score: di.score, whatIf: null };
      if (di.stats) item.stats = { ...di.stats };
      if (di.excused) item.excused = true;
      s.items.push(item);
    }
  }

  // Remember where items from each source group went, when every item from that group went to
  // the same section and the names differ. The next import into this course uses it first.
  const groupTo = new Map<string, string | null>();
  for (const di of d.items) {
    if (!di.include || !di.sectionHint || !di.sectionKey) continue;
    const s = sectionFor.get(di.sectionKey);
    if (!s) continue;
    const h = norm(di.sectionHint);
    if (!h || h === norm(s.name)) continue;
    const prev = groupTo.get(h);
    groupTo.set(h, prev === undefined || prev === s.id ? s.id : null);
  }
  for (const [h, id] of groupTo) {
    if (!id) continue;
    base.aliases = { ...base.aliases, [h]: id };
  }
  return base;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
