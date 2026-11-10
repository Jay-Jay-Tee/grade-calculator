import type { BandPreset, GradeBand } from "./types";

/** min = absolute cutoff (%). top = curved cutoff: the top x% of the class get this grade or better (a guess). */
export const DEFAULT_BANDS: GradeBand[] = [
  { label: "A+", min: 90, top: 5 },
  { label: "A", min: 85, top: 25 },
  { label: "A-", min: 80, top: 40 },
  { label: "B+", min: 75, top: 55 },
  { label: "B", min: 70, top: 70 },
  { label: "B-", min: 65, top: 80 },
  { label: "C+", min: 60, top: 88 },
  { label: "C", min: 55, top: 94 },
  { label: "D+", min: 50, top: 97 },
  { label: "D", min: 45, top: 99 },
  { label: "F", min: 0, top: 100 },
];

export const DEFAULT_PRESET: BandPreset = {
  id: "default",
  name: "Standard",
  bands: DEFAULT_BANDS,
};

export type BandIssue = { index: number; message: string };

/** Thresholds must be strictly descending, labels non-empty and unique, mins within 0-100. */
export function validateBands(bands: GradeBand[]): BandIssue[] {
  const issues: BandIssue[] = [];
  const seen = new Set<string>();
  bands.forEach((b, i) => {
    const label = b.label.trim();
    if (!label) issues.push({ index: i, message: "Label is empty" });
    else if (seen.has(label.toLowerCase())) issues.push({ index: i, message: `Duplicate label "${label}"` });
    seen.add(label.toLowerCase());
    if (!Number.isFinite(b.min) || b.min < 0 || b.min > 100) issues.push({ index: i, message: "Min must be between 0 and 100" });
    if (i > 0 && !(b.min < bands[i - 1].min)) {
      issues.push({ index: i, message: `Must be lower than ${bands[i - 1].label || "the band above"} (${bands[i - 1].min})` });
    }
  });
  return issues;
}

export function cloneBands(bands: GradeBand[]): GradeBand[] {
  return bands.map((b) => ({ ...b }));
}
