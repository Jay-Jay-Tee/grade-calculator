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
};

export type Section = {
  id: string;
  name: string;
  weight: number; // percent of course
  rule: AggregationRule;
  items: Item[];
};

export type GradeBand = { label: string; min: number }; // min is inclusive percent

export type Course = {
  id: string;
  name: string;
  sections: Section[];
  bands: GradeBand[];
  presetId?: string | null; // preset the bands were seeded from, if any
};

export type BandPreset = {
  id: string;
  name: string;
  bands: GradeBand[];
};
