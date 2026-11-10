import { cloneBands, DEFAULT_BANDS } from "./bands";
import { uid } from "./id";
import type { AggregationRule, Course, Item, Section } from "./types";

const item = (name: string, score: number | null, max: number): Item => ({ id: uid(), name, max, score, whatIf: null });
const section = (name: string, weight: number, rule: AggregationRule, items: Item[]): Section => ({
  id: uid(),
  name,
  weight,
  rule,
  items,
});

/** CS1101S, AY26/27 Sem 1 - the acceptance fixture from the handover. */
export function cs1101sFixture(): Course {
  return {
    id: uid(),
    name: "CS1101S",
    bands: cloneBands(DEFAULT_BANDS),
    presetId: "default",
    sections: [
      section("Source Academy XP", 5, { kind: "sum" }, [item("XP", 100, 100)]),
      section("Studio", 5, { kind: "sum" }, [item("Studio attendance", 100, 100)]),
      section("Reflection", 5, { kind: "sum" }, [item("Reflections", 100, 100)]),
      section(
        "Check-Ins",
        3,
        { kind: "bestN", n: 18, total: 20 },
        Array.from({ length: 20 }, (_, i) => item(`Check-In ${i + 1}`, 1, 1)),
      ),
      section("RA/PA", 24, { kind: "bestN", n: 3, total: 4 }, [
        item("RA1", 60, 60),
        item("PA1", 49, 50),
        item("RA2", 57, 72),
        item("PA2", 57, 100),
      ]),
      section("Mastery Checks", 8, { kind: "sum" }, [item("Mastery Checks", 100, 100)]),
      section("Midterm", 20, { kind: "sum" }, [item("Midterm", 72.5, 100)]),
      section("Final", 30, { kind: "sum" }, [item("Final", null, 100)]),
    ],
  };
}
