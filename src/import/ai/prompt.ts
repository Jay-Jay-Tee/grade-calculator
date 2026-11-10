import { z } from "zod";
import type { ClassStats } from "../../engine/types";
import type { Extraction, ItemFlag } from "../types";

/**
 * Shared by every provider: the instructions, the JSON shape we ask for, and the strict check of
 * the reply. Providers only differ in how the request is sent.
 */

const num = { type: ["number", "null"] } as const;
const str = { type: ["string", "null"] } as const;

/** JSON Schema of the reply. Sent as a schema where the provider supports it, else in the prompt. */
export const JSON_SCHEMA = {
  type: "object",
  properties: {
    courseName: str,
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          weight: { ...num, description: "percent of the course, null if not stated" },
          rule: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["sum", "average", "bestN", "dropLowest"] },
              n: { ...num, description: "bestN: how many items count" },
              total: { ...num, description: "bestN: how many items there will be in total" },
              k: { ...num, description: "dropLowest: how many lowest items are dropped" },
            },
            required: ["kind", "n", "total", "k"],
          },
          evidence: { type: "string", description: "short verbatim snippet from the source supporting this row" },
        },
        required: ["name", "weight", "rule", "evidence"],
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          section: { ...str, description: "assignment group / section name, null if unknown" },
          score: { ...num, description: "marks earned, null if not graded yet" },
          max: num,
          flags: {
            type: "array",
            items: { type: "string", enum: ["suspicious_zero", "what_if_value", "missing_submission", "dropped"] },
          },
          stats: {
            type: "object",
            description: "class stats for this item in raw marks (Canvas Score Details); null when not shown",
            properties: {
              low: num,
              lowerQuartile: num,
              median: num,
              mean: num,
              upperQuartile: num,
              high: num,
              n: { ...num, description: "number of students, if shown" },
            },
            required: ["low", "lowerQuartile", "median", "mean", "upperQuartile", "high", "n"],
          },
          excused: { type: "boolean", description: "true if the item is marked excused (EX)" },
        },
        required: ["name", "section", "score", "max", "flags", "stats", "excused"],
      },
    },
    bands: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, min: { type: "number" } },
        required: ["label", "min"],
      },
    },
  },
  required: ["courseName", "sections", "items", "bands"],
};

// Lenient validation of what comes back: missing optional fields become null / empty.
const n = z.number().nullable().optional().transform((v) => v ?? null);
const ExtractionSchema = z.object({
  courseName: z.string().nullable().optional().transform((v) => v ?? null),
  sections: z
    .array(
      z.object({
        name: z.string(),
        weight: n,
        rule: z
          .object({ kind: z.enum(["sum", "average", "bestN", "dropLowest"]).catch("sum"), n, total: n, k: n })
          .nullable()
          .optional()
          .transform((v) => v ?? null),
        evidence: z.string().optional().default(""),
      }),
    )
    .default([]),
  items: z
    .array(
      z.object({
        name: z.string(),
        section: z.string().nullable().optional().transform((v) => v ?? null),
        score: n,
        max: n,
        flags: z.array(z.string()).optional().default([]),
        stats: z
          .object({ low: n, lowerQuartile: n, median: n, mean: n, upperQuartile: n, high: n, n })
          .partial()
          .nullable()
          .optional(),
        excused: z.boolean().optional().default(false),
      }),
    )
    .default([]),
  bands: z.array(z.object({ label: z.string(), min: z.number() })).default([]),
});

export const SYSTEM = `You extract course grading data for a grade calculator. The input is one source: a pasted LMS grades page, a screenshot, a syllabus or lecture slide, or a results email.

Return only what the source supports. Do not invent weights, scores or items.

Sections (how the course is weighted):
- One row per weighted component, weight in percent of the whole course.
- rule.kind: "sum" (total earned / total max) unless the source says otherwise; "average" for mean of item percentages; "bestN" when only the best n of several items count; "dropLowest" when the lowest k are dropped. Unused rule fields are null.
- Pooled components: "RA1, PA1, RA2, PA2 at 8% each, best 3 of 4 count" is ONE section named "RA/PA" with weight 24 (8 x 3) and rule bestN n=3 total=4. Use the same pattern for any "x% each, best n of m".
- evidence: a short verbatim snippet (under 120 characters).

Items (individual marks):
- name, section (the assignment group shown with it, e.g. "Check-Ins", "RA/PA"), score, max. Ungraded or "-" scores are null.
- Canvas grades pages: ignore the "Click to test a different score" text. Put each item's "Score Details" numbers (Low, Lower Quartile, Median, Mean, Upper Quartile, High) into its stats, in raw marks; missing ones are null. Add the flag "suspicious_zero" when the score is 0 but the class Low is above 0 (usually a what-if value or a missing submission). Set excused true for items marked "EX" or "Excused" (score null). Put the class size into stats.n if shown. Use "what_if_value" if the page marks a score as a what-if, "missing_submission" if marked missing, "dropped" if marked as dropped.

Bands: only if the source lists grade cutoffs (e.g. "A+ 90"). min is the inclusive lower bound in percent. Otherwise an empty list.

courseName: the course code or name if shown, else null.

Reply with JSON only.`;

export type AiInput =
  | { kind: "text"; label: string; text: string }
  | { kind: "pdf"; label: string; base64: string }
  | { kind: "image"; label: string; base64: string; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" };

export class ExtractionError extends Error {}

/** The request text for an input (files are attached separately). */
export function userText(input: AiInput, extra = ""): string {
  const body =
    input.kind === "text"
      ? `Source "${input.label}":\n\n<source>\n${input.text}\n</source>`
      : `Source "${input.label}" is attached above.`;
  return `${body}${extra}\n\nExtract the grading data.`;
}

/** For providers that can't take a schema: the same schema, spelled out in the instructions. */
export const SYSTEM_WITH_SCHEMA = `${SYSTEM}\n\nThe JSON must match this JSON Schema exactly (use null for unknown values):\n${JSON.stringify(JSON_SCHEMA)}`;

const FLAGS: ItemFlag[] = ["suspicious_zero", "what_if_value", "missing_submission", "dropped"];

/** Check a reply against the schema and turn it into an Extraction. Throws ExtractionError. */
export function parseReply(text: string, label: string, warnings: string[] = []): Extraction {
  let parsed: z.infer<typeof ExtractionSchema>;
  try {
    // Some models wrap JSON in a code fence or add a sentence around it: take the outermost object.
    const unfenced = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    const json = JSON.parse(start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced);
    parsed = ExtractionSchema.parse(json);
  } catch {
    throw new ExtractionError("The reply could not be read as grading data. Try again, try another model, or paste text instead.");
  }
  return {
    source: label,
    method: "ai",
    courseName: parsed.courseName,
    sections: parsed.sections.map((s) => ({ name: s.name, weight: s.weight, rule: s.rule, evidence: s.evidence })),
    items: parsed.items.map((i) => {
      const flags = i.flags.filter((f): f is ItemFlag => (FLAGS as string[]).includes(f));
      const st = i.stats ?? {};
      const stats: ClassStats = {
        low: st.low ?? null,
        lower: st.lowerQuartile ?? null,
        median: st.median ?? null,
        mean: st.mean ?? null,
        upper: st.upperQuartile ?? null,
        high: st.high ?? null,
        n: st.n ?? null,
      };
      const any = Object.values(stats).some((v) => v != null);
      if (i.score === 0 && stats.low != null && stats.low > 0 && !flags.includes("suspicious_zero")) flags.push("suspicious_zero");
      return {
        name: i.name,
        section: i.section,
        score: i.excused ? null : i.score,
        max: i.max,
        flags,
        stats: any ? stats : undefined,
        ...(i.excused ? { excused: true } : {}),
      };
    }),
    bands: parsed.bands,
    warnings,
  };
}

export type ModelInfo = { id: string; label: string };
