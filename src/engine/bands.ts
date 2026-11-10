import type { BandPreset, GradeBand } from "./types";

export const DEFAULT_BANDS: GradeBand[] = [
  { label: "A+", min: 90 },
  { label: "A", min: 85 },
  { label: "A-", min: 80 },
  { label: "B+", min: 75 },
  { label: "B", min: 70 },
  { label: "B-", min: 65 },
  { label: "C+", min: 60 },
  { label: "C", min: 55 },
  { label: "D+", min: 50 },
  { label: "D", min: 45 },
  { label: "F", min: 0 },
];

export const DEFAULT_PRESET: BandPreset = {
  id: "default",
  name: "Default",
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
