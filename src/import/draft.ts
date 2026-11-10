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

/** Find the draft section an item belongs to, from its group hint or its own name. */
export function matchSection(hint: string | null, itemName: string, sections: DraftSection[]): string | null {
  const live = sections.filter((s) => s.include);
  const h = hint ? norm(hint) : "";
  const n = norm(itemName);
  if (h) {
    const exact = live.find((s) => norm(s.name) === h);
    if (exact) return exact.key;
    const partial = live.find((s) => {
      const sn = norm(s.name);
      return sn.length >= 3 && h.length >= 3 && (sn.includes(h) || h.includes(sn));
    });
    if (partial) return partial.key;
  }
  // Pooled names like "RA1/PA1/RA2/PA2" list their items
  const pooled = live.find((s) => s.name.includes("/") && s.name.split("/").some((p) => norm(p) === n));
  if (pooled) return pooled.key;
  const byName = live.find((s) => {
    const sn = norm(s.name);
    return sn === n || (sn.length >= 4 && (n.startsWith(sn) || sn.startsWith(n) && n.length >= 4));
  });
  return byName?.key ?? null;
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
      const sectionKey = matchSection(it.section, name, sections);
      const key = `${norm(name)}|${sectionKey ?? ""}`;
      const flags = it.flags.filter((f): f is ItemFlag => f !== "unmatched_item");
      const prev = itemIndex.get(key);
      if (prev) {
        if (prev.score == null && it.score != null) prev.score = it.score;
        if (prev.max == null && it.max != null) prev.max = it.max;
        for (const f of flags) if (!prev.flags.includes(f)) prev.flags.push(f);
        if (it.stats) prev.stats = { ...prev.stats, ...it.stats };
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
    } else {
      const item: Item = { id: uid(), name: di.name.trim(), max: di.max, score: di.score, whatIf: null };
      if (di.stats) item.stats = { ...di.stats };
      s.items.push(item);
    }
  }
  return base;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
