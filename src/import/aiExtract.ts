import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { ClassStats } from "../engine/types";
import type { Extraction, ItemFlag } from "./types";

/**
 * Extraction with Google's Gemini API, using the user's own Google AI Studio key.
 * The response is constrained to JSON with a schema, then validated again with zod.
 */

const num = { type: ["number", "null"] } as const;
const str = { type: ["string", "null"] } as const;

/** JSON Schema sent to Gemini (`responseJsonSchema`). */
const JSON_SCHEMA = {
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
            properties: { low: num, lowerQuartile: num, median: num, mean: num, upperQuartile: num, high: num },
            required: ["low", "lowerQuartile", "median", "mean", "upperQuartile", "high"],
          },
        },
        required: ["name", "section", "score", "max", "flags", "stats"],
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
          .object({ low: n, lowerQuartile: n, median: n, mean: n, upperQuartile: n, high: n })
          .partial()
          .nullable()
          .optional(),
      }),
    )
    .default([]),
  bands: z.array(z.object({ label: z.string(), min: z.number() })).default([]),
});

const SYSTEM = `You extract course grading data for a grade calculator. The input is one source: a pasted LMS grades page, a screenshot, a syllabus or lecture slide, or a results email.

Return only what the source supports. Do not invent weights, scores or items.

Sections (how the course is weighted):
- One row per weighted component, weight in percent of the whole course.
- rule.kind: "sum" (total earned / total max) unless the source says otherwise; "average" for mean of item percentages; "bestN" when only the best n of several items count; "dropLowest" when the lowest k are dropped. Unused rule fields are null.
- Pooled components: "RA1, PA1, RA2, PA2 at 8% each, best 3 of 4 count" is ONE section named "RA/PA" with weight 24 (8 x 3) and rule bestN n=3 total=4. Use the same pattern for any "x% each, best n of m".
- evidence: a short verbatim snippet (under 120 characters).

Items (individual marks):
- name, section (the assignment group shown with it, e.g. "Check-Ins", "RA/PA"), score, max. Ungraded or "-" scores are null.
- Canvas grades pages: ignore the "Click to test a different score" text. Put each item's "Score Details" numbers (Low, Lower Quartile, Median, Mean, Upper Quartile, High) into its stats, in raw marks; missing ones are null. Add the flag "suspicious_zero" when the score is 0 but the class Low is above 0 (usually a what-if value or a missing submission). Use "what_if_value" if the page marks a score as a what-if, "missing_submission" if marked missing, "dropped" if marked as dropped.

Bands: only if the source lists grade cutoffs (e.g. "A+ 90"). min is the inclusive lower bound in percent. Otherwise an empty list.

courseName: the course code or name if shown, else null.

Reply with JSON only.`;

export type AiInput =
  | { kind: "text"; label: string; text: string }
  | { kind: "pdf"; label: string; base64: string }
  | { kind: "image"; label: string; base64: string; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" };

export class ExtractionError extends Error {}

const FLAGS: ItemFlag[] = ["suspicious_zero", "what_if_value", "missing_submission", "dropped"];

export async function aiExtract(input: AiInput, apiKey: string, model: string, signal?: AbortSignal): Promise<Extraction> {
  const ai = new GoogleGenAI({ apiKey });

  const parts: ({ inlineData: { mimeType: string; data: string } } | { text: string })[] = [];
  if (input.kind === "pdf") parts.push({ inlineData: { mimeType: "application/pdf", data: input.base64 } });
  if (input.kind === "image") parts.push({ inlineData: { mimeType: input.mediaType, data: input.base64 } });
  parts.push({
    text:
      input.kind === "text"
        ? `Source "${input.label}":\n\n<source>\n${input.text}\n</source>\n\nExtract the grading data.`
        : `Source "${input.label}" is attached above. Extract the grading data.`,
  });

  const call = (withSchema: boolean) =>
    ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        ...(withSchema ? { responseJsonSchema: JSON_SCHEMA } : {}),
        temperature: 0,
        abortSignal: signal,
      },
    });

  let res;
  try {
    res = await call(true);
  } catch (e) {
    // If this model rejects the schema, retry in plain JSON mode; zod still checks the result.
    if (e instanceof ApiError && e.status === 400 && /schema/i.test(e.message)) {
      try {
        res = await call(false);
      } catch (e2) {
        throw new ExtractionError(describeApiError(e2));
      }
    } else throw new ExtractionError(describeApiError(e));
  }

  const blocked = res.promptFeedback?.blockReason;
  if (blocked) throw new ExtractionError(`Gemini blocked this input (${blocked}).`);
  const finish = res.candidates?.[0]?.finishReason;
  if (finish === "MAX_TOKENS") throw new ExtractionError("The response was cut off. Try a smaller input.");
  const text = res.text;
  if (!text) throw new ExtractionError(`Gemini returned nothing${finish ? ` (${finish})` : ""}.`);

  let parsed: z.infer<typeof ExtractionSchema>;
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    parsed = ExtractionSchema.parse(json);
  } catch {
    throw new ExtractionError("The response could not be read as grading data. Try again or paste text instead.");
  }

  return {
    source: input.label,
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
      };
      const any = Object.values(stats).some((v) => v != null);
      if (i.score === 0 && stats.low != null && stats.low > 0 && !flags.includes("suspicious_zero")) flags.push("suspicious_zero");
      return { name: i.name, section: i.section, score: i.score, max: i.max, flags, stats: any ? stats : undefined };
    }),
    bands: parsed.bands,
    warnings: [],
  };
}

function describeApiError(e: unknown): string {
  if (e instanceof Error && e.name === "AbortError") return "Cancelled.";
  if (e instanceof ApiError) {
    const m = e.message;
    if (/API_KEY_INVALID|API key not valid/i.test(m) || e.status === 401) return "Google rejected this API key. Check it in Settings.";
    if (e.status === 403) return "This key can't use the Gemini API. Make a new key in Google AI Studio.";
    if (e.status === 404) return "Model not found. Pick another in Settings.";
    if (e.status === 429) return "Free limit reached. Wait a minute, try tomorrow, or switch to Flash-Lite in Settings.";
    if (e.status >= 500) return "Gemini is having trouble right now. Try again in a moment.";
    return `Gemini error ${e.status}: ${m.slice(0, 200)}`;
  }
  if (e instanceof TypeError) return "Couldn't reach Google. Check your connection.";
  return e instanceof Error ? e.message : String(e);
}

export type ModelInfo = { id: string; label: string };

/**
 * Gemini models this key can use for generateContent. Doubles as a key check:
 * a bad key throws an ExtractionError with a readable message.
 */
export async function listModels(apiKey: string): Promise<ModelInfo[]> {
  const ai = new GoogleGenAI({ apiKey });
  const out: ModelInfo[] = [];
  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      const id = (m.name ?? "").replace(/^models\//, "");
      if (!id.startsWith("gemini")) continue;
      if (!(m.supportedActions ?? []).includes("generateContent")) continue;
      // Skip models that can't read documents into text (speech, image generation, live audio, embeddings).
      if (/tts|image-generation|-image|live|audio|embedding|native-audio/i.test(id)) continue;
      out.push({ id, label: m.displayName ? `${m.displayName} (${id})` : id });
    }
  } catch (e) {
    throw new ExtractionError(describeApiError(e));
  }
  return out;
}
