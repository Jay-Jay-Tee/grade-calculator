import type { AggregationRule, GradeBand } from "../engine/types";

/** Raw rule shape from extraction (all params optional / nullable). */
export type ExtractedRule = {
  kind: "sum" | "average" | "bestN" | "dropLowest";
  n?: number | null;
  total?: number | null;
  k?: number | null;
};

export type ItemFlag = "suspicious_zero" | "unmatched_item" | "what_if_value" | "missing_submission" | "dropped";

export type ExtractedSection = {
  name: string;
  weight: number | null;
  rule: ExtractedRule | null;
  evidence?: string;
};

export type ExtractedItem = {
  name: string;
  section: string | null;
  score: number | null;
  max: number | null;
  flags: ItemFlag[];
  classLow?: number | null;
};

/** One extraction result, one per input. Matches the handover JSON schema. */
export type Extraction = {
  source: string; // label for the input, e.g. file name
  method: "text" | "pdf-text" | "ai";
  courseName: string | null;
  sections: ExtractedSection[];
  items: ExtractedItem[];
  bands: GradeBand[];
  warnings: string[];
};

// ---- Review draft (editable before Apply) ----

export type DraftSection = {
  key: string;
  existingId: string | null; // set when this row is an existing course section
  name: string;
  weight: number;
  weightKnown: boolean;
  rule: AggregationRule;
  evidence: string;
  include: boolean;
};

export type DraftItem = {
  key: string;
  name: string;
  sectionKey: string | null; // null = Unassigned
  sectionHint: string | null;
  score: number | null;
  max: number | null;
  flags: ItemFlag[];
  include: boolean;
};

export type Draft = {
  courseName: string;
  sections: DraftSection[];
  items: DraftItem[];
  bands: GradeBand[];
  useBands: boolean;
  sources: { label: string; method: Extraction["method"]; warnings: string[] }[];
};
