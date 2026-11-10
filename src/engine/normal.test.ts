import { describe, expect, it } from "vitest";
import { normCdf, normInv, Z_QUARTILE } from "./normal";

describe("normal distribution", () => {
  it("CDF known values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1)).toBeCloseTo(0.841344746, 6);
    expect(normCdf(-1.959963985)).toBeCloseTo(0.025, 6);
    expect(normCdf(Z_QUARTILE)).toBeCloseTo(0.75, 6);
  });
  it("inverse known values", () => {
    expect(normInv(0.5)).toBeCloseTo(0, 9);
    expect(normInv(0.75)).toBeCloseTo(Z_QUARTILE, 8);
    expect(normInv(0.975)).toBeCloseTo(1.959963985, 7);
    expect(normInv(0.005)).toBeCloseTo(-2.575829304, 7);
    expect(normInv(0)).toBe(-Infinity);
    expect(normInv(1)).toBe(Infinity);
  });
  it("inverse round-trips the CDF", () => {
    for (const p of [0.001, 0.02, 0.1, 0.3, 0.5, 0.7, 0.9, 0.98, 0.999]) expect(normCdf(normInv(p))).toBeCloseTo(p, 6);
  });
});
