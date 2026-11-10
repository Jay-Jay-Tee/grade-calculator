import { describe, expect, it } from "vitest";
import { DEFAULT_BANDS } from "./bands";
import { courseStanding } from "./relative";
import type { ClassStats, Course } from "./types";

/**
 * Simulation: build a class with a known correlation between tests, compute the class stats an
 * LMS would show, then compare each student's estimated standing with their true rank on the
 * weighted total. Seeded, so results are repeatable.
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand: () => number) {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

type Scenario = { name: string; rho: number; ceiling?: boolean; seed: number };
const WEIGHTS = [10, 15, 20, 25, 30];
const N = 150;

function simulate(sc: Scenario) {
  const rand = mulberry32(sc.seed);
  const means = WEIGHTS.map(() => (sc.ceiling ? 78 : 55) + rand() * 15);
  const sds = WEIGHTS.map(() => 10 + rand() * 10);
  const marks: number[][] = [];
  for (let i = 0; i < N; i++) {
    const a = normal(rand);
    marks.push(
      WEIGHTS.map((_, j) => {
        const z = Math.sqrt(sc.rho) * a + Math.sqrt(1 - sc.rho) * normal(rand);
        return Math.max(0, Math.min(100, Math.round(means[j] + sds[j] * z)));
      }),
    );
  }
  const stats: ClassStats[] = WEIGHTS.map((_, j) => {
    const col = marks.map((m) => m[j]).sort((x, y) => x - y);
    return {
      low: col[0],
      lower: quantile(col, 0.25),
      median: quantile(col, 0.5),
      mean: col.reduce((x, y) => x + y, 0) / N,
      upper: quantile(col, 0.75),
      high: col[N - 1],
      n: N,
    };
  });
  const totals = marks.map((m) => m.reduce((acc, v, j) => acc + (v * WEIGHTS[j]) / 100, 0));
  const truePct = totals.map((t) => (100 * (totals.filter((x) => x < t).length + 0.5 * totals.filter((x) => x === t).length)) / N);
  return { marks, stats, truePct };
}

/** The v1 model: piecewise-linear percentile per item, averaged by course weight. */
function oldPercentile(score: number, s: ClassStats): number {
  const raw: [number, number][] = [
    [s.low ?? 0, 0],
    [s.lower!, 25],
    [s.median!, 50],
    [s.upper!, 75],
    [s.high ?? 100, 100],
  ];
  const pts: [number, number][] = [];
  for (const p of raw) if (pts.length === 0 || p[0] >= pts[pts.length - 1][0]) pts.push(p);
  if (score <= pts[0][0]) return pts[0][1];
  if (score > pts[pts.length - 1][0]) return 100;
  const tied = pts.filter((p) => p[0] === score);
  if (tied.length > 1) return (tied[0][1] + tied[tied.length - 1][1]) / 2;
  for (let i = 1; i < pts.length; i++) {
    const [v0, p0] = pts[i - 1];
    const [v1, p1] = pts[i];
    if (score <= v1) return v1 === v0 ? p1 : p0 + ((score - v0) / (v1 - v0)) * (p1 - p0);
  }
  return 100;
}

function evaluate(sc: Scenario) {
  const { marks, stats, truePct } = simulate(sc);
  let errNew = 0;
  let errOld = 0;
  let covered = 0;
  for (let i = 0; i < N; i++) {
    const course: Course = {
      id: "c",
      name: "C",
      bands: DEFAULT_BANDS,
      grading: "relative",
      sections: WEIGHTS.map((w, j) => ({
        id: `s${j}`,
        name: `S${j}`,
        weight: w,
        rule: { kind: "sum" as const },
        items: [{ id: `i${j}`, name: `I${j}`, max: 100, score: marks[i][j], whatIf: null, stats: stats[j] }],
      })),
    };
    const st = courseStanding(course, false);
    const old = WEIGHTS.reduce((acc, w, j) => acc + w * oldPercentile(marks[i][j], stats[j]), 0) / 100;
    errNew += Math.abs(st.pct! - truePct[i]);
    errOld += Math.abs(old - truePct[i]);
    // count the true rank as covered if it's within the range, allowing 2 points for rank noise
    if (truePct[i] >= st.low! - 2 && truePct[i] <= st.high! + 2) covered++;
  }
  return { maeNew: errNew / N, maeOld: errOld / N, coverage: covered / N };
}

const SCENARIOS: Scenario[] = [
  { name: "rho 0.3", rho: 0.3, seed: 11 },
  { name: "rho 0.6", rho: 0.6, seed: 22 },
  { name: "rho 0.85", rho: 0.85, seed: 33 },
  { name: "rho 0.6, easy tests with a ceiling", rho: 0.6, ceiling: true, seed: 44 },
];

describe("curve model accuracy (simulated classes)", () => {
  // Each scenario is averaged over three simulated classes so one lucky draw can't pass the test.
  const results = SCENARIOS.map((s) => {
    const runs = [0, 100, 200].map((d) => evaluate({ ...s, seed: s.seed + d }));
    const avg = (k: "maeNew" | "maeOld" | "coverage") => runs.reduce((a, r) => a + r[k], 0) / runs.length;
    return { s, r: { maeNew: avg("maeNew"), maeOld: avg("maeOld"), coverage: avg("coverage") } };
  });
  it("report", () => {
    for (const { s, r } of results) {
      console.log(
        `${s.name.padEnd(36)} error new ${r.maeNew.toFixed(2)} pts, old ${r.maeOld.toFixed(2)} pts, range covers ${(r.coverage * 100).toFixed(0)}%`,
      );
    }
  });
  it("is more accurate than averaging percentiles", () => {
    for (const { r } of results) expect(r.maeNew).toBeLessThan(r.maeOld);
  });
  it("is within a few percentile points when tests correlate moderately", () => {
    expect(results[1].r.maeNew).toBeLessThanOrEqual(5);
  });
  it("its range usually contains the true rank when rho is 0.4 to 0.8", () => {
    expect(results[1].r.coverage).toBeGreaterThanOrEqual(0.8);
  });
  it("stays reasonable outside that range and with a ceiling", () => {
    for (const { r } of results) expect(r.maeNew).toBeLessThanOrEqual(4);
  });
});
