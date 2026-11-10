import type { Extraction, ExtractedItem, ExtractedRule, ExtractedSection } from "./types";

/**
 * Plain-text parser used when there's no API key. Handles:
 * - Canvas "Grades" pages pasted as text (name line, assignment group line, dates, score).
 * - Simple "Name 57/72" or "Name: 57 out of 72" lines (results emails).
 * - Weight lines from syllabi or Canvas' "Assignments are weighted by group" table
 *   ("Midterm 20%", "RA1, PA1, RA2, PA2 at 8% each, best 3 of 4 count").
 */

const NUM = String.raw`\d+(?:\.\d+)?`;
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;

const RE = {
  scoreSlash: new RegExp(String.raw`^(-|–|${NUM})\s*/\s*(${NUM})$`),
  slashOnly: new RegExp(String.raw`^/\s*(${NUM})$`),
  numOnly: new RegExp(String.raw`^(-|${NUM})$`),
  scoreOutOf: new RegExp(String.raw`^score:?\s*(-|${NUM})\s*out of\s*(${NUM})(?:\s*points?)?\.?$`, "i"),
  inline: new RegExp(
    String.raw`^(.{1,80}?)[\s:=\-]+(-|${NUM})\s*(?:/|out of)\s*(${NUM})(?:\s*(?:marks?|points?|pts))?\.?$`,
    "i",
  ),
  weight: new RegExp(String.raw`^(.{1,80}?)[\s:=\-–(]+(${NUM})\s*%(.*)$`),
  stat: new RegExp(String.raw`^(mean|median|high|low|upper quartile|lower quartile)\s*:?\s*(${NUM})?$`, "i"),
  bestOf: new RegExp(String.raw`best\s+(\d+)\s+(?:of|out of)\s+(\d+)`, "i"),
  bestN: /best\s+(\d+)\b/i,
  each: new RegExp(String.raw`(${NUM})\s*%\s*each`, "i"),
  dropLowest: /(?:drop(?:s|ped)?\s+(?:the\s+)?lowest\s+(\d+)?|lowest\s+(\d+)?\s*(?:is|are)?\s*dropped)/i,
  date: new RegExp(
    String.raw`^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(?:${MONTH}\s+\d{1,2}|\d{1,2}\s+${MONTH})(?:,?\s+\d{4})?(?:\s+(?:by|at)\s+.*)?$`,
    "i",
  ),
  time: /^(?:by|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i,
};

const NOISE: RegExp[] = [
  /^click to test a different score$/i,
  /^(?:name|due|submitted|status|score|out of|details|submission progress status|close|apply|arrange by|due date|title|module|assignment group|course|grades|print grades|show all details|hide all details|what-if score|calculate based only on graded assignments|group|weight|total|totals?:?|assignments|ungraded|graded|comments?|rubric|score details|your score:?|points)$/i,
  /^(?:late|missing|excused|submitted|unsubmitted|not submitted|in progress|on time|incomplete|complete|pending|ex|n\/a)$/i,
  /^grades for /i,
  /^\d+\s+comments?$/i,
  /^(?:view|show) (?:rubric|feedback|comments)/i,
  /^calculation of totals has been disabled/i,
  /^assignments are weighted by group/i,
  /^this (?:assignment|score) /i,
  /^instructor is working on grades/i,
  /^you have (?:not )?submitted/i,
  /^[\s\-–_|•·]*$/,
];

function isNoise(line: string): boolean {
  return RE.date.test(line) || RE.time.test(line) || NOISE.some((r) => r.test(line));
}

function num(s: string): number | null {
  if (s === "-" || s === "–") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cleanName(s: string): string {
  return s
    .replace(/^[\s•·\-–*]+/, "")
    .replace(/[\s:=\-–(]+$/, "")
    .trim();
}

/** Parse a syllabus-style weight line. Returns null if it isn't one. */
export function parseWeightLine(line: string): ExtractedSection | null {
  const m = RE.weight.exec(line);
  if (!m) return null;
  let name = cleanName(m[1]);
  const pct = Number(m[2]);
  if (!name || pct <= 0 || pct > 100) return null;
  if (/^(total|mean|median|high|low|average|grade|score)$/i.test(name)) return null;

  let rule: ExtractedRule | null = null;
  let weight = pct;
  const best = RE.bestOf.exec(line);
  const each = RE.each.exec(line);
  if (best) {
    const n = Number(best[1]);
    const total = Number(best[2]);
    rule = { kind: "bestN", n, total };
    // "8% each, best 3 of 4" => pooled weight is 8 x 3
    if (each) weight = Number(each[1]) * n;
  } else if (RE.bestN.test(line)) {
    rule = { kind: "bestN", n: Number(RE.bestN.exec(line)![1]), total: null };
  } else {
    const d = RE.dropLowest.exec(line);
    if (d) rule = { kind: "dropLowest", k: Number(d[1] ?? d[2] ?? 1) };
  }
  if (each && !best) {
    // "Tutorials 2% each" without a count: we can't pool, keep the raw figure and let the user fix it.
    weight = Number(each[1]);
  }
  name = name.replace(/\s+at$/i, "").trim();
  // Lists like "RA1, PA1, RA2, PA2" become "RA1/PA1/RA2/PA2"
  if (/,/.test(name) && name.split(",").every((p) => p.trim().length <= 12)) {
    name = name
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .join("/");
  }
  return { name, weight, rule, evidence: line.trim().slice(0, 160) };
}

type Block = { pending: string[]; item: ExtractedItem; inline: boolean };

export function parseText(text: string, source = "Pasted text"): Extraction {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((l) => {
      if (!l.includes("\t")) return [l];
      // Keep "Group<TAB>Weight" rows whole so they still read as weight lines.
      const joined = l.replace(/\t+/g, " ").trim();
      if (/^[^\t]{1,80}\t+\d+(?:\.\d+)?\s*%\s*$/.test(l.trim()) && parseWeightLine(joined)) return [joined];
      return l.split("\t");
    })
    .map((l) => l.replace(/ /g, " ").trim())
    .filter((l) => l.length > 0);

  const sections: ExtractedSection[] = [];
  const blocks: Block[] = [];
  let pending: string[] = [];
  let last = null as Block | null;
  let pendingStat: string | null = null;
  let inWeightTable = false;

  const pushScore = (score: number | null, max: number | null, inlineName?: string) => {
    if (max == null || max <= 0) return;
    if (inlineName) {
      const item: ExtractedItem = { name: inlineName, section: null, score, max, flags: [] };
      last = { pending: [], item, inline: true };
      blocks.push(last);
      pending = [];
      return;
    }
    // No name lines since the last score: it's the same item's score shown twice
    // (screen-reader text plus visible text), or a score with no name. Skip it.
    if (pending.length === 0) return;
    const item: ExtractedItem = { name: "", section: null, score, max, flags: [] };
    last = { pending, item, inline: false };
    blocks.push(last);
    pending = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^assignments are weighted by group/i.test(line)) {
      inWeightTable = true;
      continue;
    }

    // Class stats ("Score Details" blocks): only used for flagging.
    if (pendingStat) {
      const n = num(line);
      if (n != null && RE.numOnly.test(line)) {
        if (last && /^low$/i.test(pendingStat)) last.item.classLow = n;
        pendingStat = null;
        continue;
      }
      pendingStat = null;
    }
    const st = RE.stat.exec(line);
    if (st) {
      if (st[2] != null) {
        if (last && /^low$/i.test(st[1])) last.item.classLow = Number(st[2]);
      } else pendingStat = st[1];
      continue;
    }

    let m: RegExpExecArray | null;
    if ((m = RE.scoreOutOf.exec(line))) {
      pushScore(num(m[1]), num(m[2]));
      continue;
    }
    if ((m = RE.scoreSlash.exec(line))) {
      pushScore(num(m[1]), num(m[2]));
      continue;
    }
    if (RE.numOnly.test(line) && i + 1 < lines.length && (m = RE.slashOnly.exec(lines[i + 1]))) {
      pushScore(num(line), num(m[1]));
      i++;
      continue;
    }
    if ((m = RE.inline.exec(line))) {
      const name = cleanName(m[1]);
      if (name && !/^score$/i.test(name)) {
        pushScore(num(m[2]), num(m[3]), name);
        continue;
      }
    }

    const w = parseWeightLine(line);
    if (w) {
      sections.push(w);
      continue;
    }
    // Weight table copied with each cell on its own line: "Check-Ins" then "3%".
    const pctOnly = new RegExp(String.raw`^(${NUM})\s*%$`).exec(line);
    if (pctOnly && inWeightTable && pending.length > 0) {
      const name = pending.pop()!;
      const w2 = parseWeightLine(`${name} ${line}`);
      if (w2) sections.push(w2);
      continue;
    }
    if (inWeightTable && /^total$/i.test(line)) {
      inWeightTable = false;
      continue;
    }

    if (RE.numOnly.test(line)) continue; // stray numbers (e.g. the score shown above "60 / 60")
    if (isNoise(line)) continue;
    pending.push(line);
  }

  // Resolve names and group hints. Canvas shows the item name, then the assignment group
  // under it, so the last two pending lines are (name, group).
  const knownGroups = new Set(sections.map((s) => norm(s.name)));
  const lastLines = new Map<string, number>();
  for (const b of blocks) {
    if (b.inline || b.pending.length < 2) continue;
    const g = norm(b.pending[b.pending.length - 1]);
    lastLines.set(g, (lastLines.get(g) ?? 0) + 1);
  }
  const looksCanvas = [...lastLines.values()].some((n) => n >= 2) || knownGroups.size > 0;

  const items: ExtractedItem[] = [];
  for (const b of blocks) {
    if (!b.inline) {
      const p = b.pending;
      const lastLine = p[p.length - 1];
      if (p.length >= 2 && (looksCanvas || knownGroups.has(norm(lastLine)))) {
        b.item.name = p[p.length - 2];
        b.item.section = lastLine;
      } else {
        b.item.name = lastLine;
      }
    }
    const it = b.item;
    if (it.score === 0 && it.classLow != null && it.classLow > 0) it.flags.push("suspicious_zero");
    items.push(it);
  }

  const courseName = guessCourseName(text);
  const warnings: string[] = [];
  if (items.length === 0 && sections.length === 0) warnings.push("Nothing recognised in this text.");
  return { source, method: "text", courseName, sections: dedupeSections(sections), items, bands: [], warnings };
}

function dedupeSections(sections: ExtractedSection[]): ExtractedSection[] {
  const out = new Map<string, ExtractedSection>();
  for (const s of sections) if (!out.has(norm(s.name))) out.set(norm(s.name), s);
  return [...out.values()];
}

function guessCourseName(text: string): string | null {
  const m = /\b([A-Z]{2,4}\d{4}[A-Z]{0,2})\b/.exec(text);
  return m ? m[1] : null;
}

/** Normalise a name for matching: lowercase, alphanumerics only, trailing plural s dropped. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "");
}
