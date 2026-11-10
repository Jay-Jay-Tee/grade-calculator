export type AggregationRule =
  | { kind: "average" } // mean of item percentages
  | { kind: "sum" } // total earned / total max
  | { kind: "bestN"; n: number; total?: number } // best n items count (total = expected item count)
  | { kind: "dropLowest"; k: number };

export type Item = {
  id: string;
  name: string;
  max: number;
  score: number | null; // real score, null if not graded yet
  whatIf: number | null; // hypothetical score, used when what-if mode is on
  stats?: ClassStats; // class stats for this item, used for curved grading
};

/** Class stats an LMS shows per assessment (Canvas "Score Details"), in raw marks. */
export type ClassStats = {
  low?: number | null;
  lower?: number | null; // lower quartile
  median?: number | null;
  mean?: number | null;
  upper?: number | null; // upper quartile
  high?: number | null;
};

export type Section = {
  id: string;
  name: string;
  weight: number; // percent of course
  rule: AggregationRule;
  items: Item[];
};

export type GradeBand = {
  label: string;
  min: number; // absolute grading: inclusive percent
  top?: number; // curved grading: the top `top`% of the class get this grade or better
};

export type Grading = "absolute" | "relative";

export type Course = {
  id: string;
  name: string;
  sections: Section[];
  bands: GradeBand[];
  presetId?: string | null; // preset the bands were seeded from, if any
  grading?: Grading; // default "absolute"
};

export type BandPreset = {
  id: string;
  name: string;
  bands: GradeBand[];
};
