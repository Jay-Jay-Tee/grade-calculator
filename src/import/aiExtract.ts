import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { ClassStats } from "../engine/types";
import type { Extraction, ItemFlag } from "./types";
import { MODELS } from "./models";

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

const SYSTEM = `You extract course grading data for a grade calculator. The input is one source: a pasted LMS grades page, a screenshot, a syllabus or lecture slide, or a results email.

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

/**
 * Google issues two key formats: older "AIza..." keys and newer "AQ..." keys. Most work on the
 * Gemini API endpoint; some AQ keys are only accepted by Vertex AI's express endpoint. We try the
 * Gemini API first and fall back to Vertex once if the key is rejected (401), then remember which
 * one worked for this key.
 */
type Backend = "studio" | "vertex";
const BACKEND_KEY = "whatif-grades:geminiBackend";

function keyTag(apiKey: string): string {
  return `${apiKey.length}:${apiKey.slice(-6)}`;
}
function preferredBackend(apiKey: string): Backend {
  try {
    const v = JSON.parse(localStorage.getItem(BACKEND_KEY) ?? "null");
    if (v && v.tag === keyTag(apiKey) && (v.backend === "studio" || v.backend === "vertex")) return v.backend;
  } catch {
    /* ignore */
  }
  return "studio";
}
function rememberBackend(apiKey: string, backend: Backend) {
  try {
    localStorage.setItem(BACKEND_KEY, JSON.stringify({ tag: keyTag(apiKey), backend }));
  } catch {
    /* ignore */
  }
}
// Retry Google's temporary errors (overloaded, 500s) a couple of times with a short backoff.
const RETRY = { attempts: 3, initialDelay: 1, maxDelay: 4 };
function client(apiKey: string, backend: Backend): GoogleGenAI {
  const httpOptions = { retryOptions: RETRY };
  return backend === "vertex" ? new GoogleGenAI({ vertexai: true, apiKey, httpOptions }) : new GoogleGenAI({ apiKey, httpOptions });
}
function isServerError(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 500;
}
/** Lightest listed model, used once when the chosen model keeps failing on Google's side. */
const FALLBACK_MODEL = MODELS[MODELS.length - 1].id;
function isAuthRejection(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || /ACCESS_TOKEN_TYPE_UNSUPPORTED|UNAUTHENTICATED/i.test(e.message));
}

/** Run `fn` on the preferred endpoint, falling back to the other one if the key is rejected there. */
async function withBackend<T>(apiKey: string, fn: (ai: GoogleGenAI, backend: Backend) => Promise<T>): Promise<T> {
  const first = preferredBackend(apiKey);
  try {
    const r = await fn(client(apiKey, first), first);
    rememberBackend(apiKey, first);
    return r;
  } catch (e) {
    if (!isAuthRejection(e)) throw e;
    const second: Backend = first === "studio" ? "vertex" : "studio";
    try {
      const r = await fn(client(apiKey, second), second);
      rememberBackend(apiKey, second);
      return r;
    } catch (e2) {
      // Report the more useful of the two errors: anything other than a second auth rejection.
      throw isAuthRejection(e2) ? new KeyRejected(e) : e2;
    }
  }
}

/** Both endpoints rejected the key. */
class KeyRejected extends Error {
  constructor(public cause: unknown) {
    super("key rejected");
  }
}

const FLAGS: ItemFlag[] = ["suspicious_zero", "what_if_value", "missing_submission", "dropped"];

export async function aiExtract(input: AiInput, apiKey: string, model: string, signal?: AbortSignal): Promise<Extraction> {

  const parts: ({ inlineData: { mimeType: string; data: string } } | { text: string })[] = [];
  if (input.kind === "pdf") parts.push({ inlineData: { mimeType: "application/pdf", data: input.base64 } });
  if (input.kind === "image") parts.push({ inlineData: { mimeType: input.mediaType, data: input.base64 } });
  parts.push({
    text:
      input.kind === "text"
        ? `Source "${input.label}":\n\n<source>\n${input.text}\n</source>\n\nExtract the grading data.`
        : `Source "${input.label}" is attached above. Extract the grading data.`,
  });

  const call = (ai: GoogleGenAI, withSchema: boolean, useModel = model) =>
    ai.models.generateContent({
      model: useModel,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        ...(withSchema ? { responseJsonSchema: JSON_SCHEMA } : {}),
        temperature: 0,
        abortSignal: signal,
      },
    });

  // 1. Ask for JSON in our schema (the SDK already retries temporary errors).
  // 2. If Google rejects the schema, or keeps failing on its side, ask again in plain JSON mode.
  // 3. If the chosen model is still failing on Google's side, try the lighter model once.
  const warnings: string[] = [];
  let res;
  try {
    res = await withBackend(apiKey, async (ai) => {
      try {
        return await call(ai, true);
      } catch (e) {
        const schemaRejected = e instanceof ApiError && e.status === 400 && /schema/i.test(e.message);
        if (!schemaRejected && !isServerError(e)) throw e;
        try {
          return await call(ai, false);
        } catch (e2) {
          if (!isServerError(e2) || model === FALLBACK_MODEL || signal?.aborted) throw e2;
          const r = await call(ai, false, FALLBACK_MODEL);
          warnings.push(`${model} was busy, so this was read with ${FALLBACK_MODEL}. Check it closely.`);
          return r;
        }
      }
    });
  } catch (e) {
    console.error("Gemini request failed", e);
    throw new ExtractionError(describeApiError(e));
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

function describeApiError(e: unknown): string {
  if (e instanceof Error && e.name === "AbortError") return "Cancelled.";
  if (e instanceof KeyRejected) {
    return "Google didn't accept this key. Copy it again from AI Studio. If it still fails, create a new key there (choosing a new project can help): some newer \"AQ.\" keys aren't enabled for the Gemini API yet.";
  }
  if (e instanceof ApiError) {
    const m = e.message;
    if (/API_KEY_INVALID|API key not valid/i.test(m) || e.status === 401) return "Google rejected this API key. Check it in Settings.";
    if (e.status === 403) return "This key can't use the Gemini API. Make a new key in Google AI Studio.";
    if (e.status === 404) return "Model not found. Pick another in Settings.";
    if (e.status === 429) return "Free limit reached. Wait a minute, try tomorrow, or switch to Flash-Lite in Settings.";
    if (e.status >= 500) {
      const busy = e.status === 503 || /overload|unavailable|high demand/i.test(m);
      return `${busy ? "Gemini is overloaded right now" : "Gemini had an error on Google's side"} (${e.status}: ${googleMessage(m)}). It was retried a few times. Wait a minute and try again, or pick another model in Settings.`;
    }
    return `Gemini error ${e.status}: ${googleMessage(m)}`;
  }
  if (e instanceof TypeError) return "Couldn't reach Google. Check your connection.";
  return e instanceof Error ? e.message : String(e);
}

/** Google's error message, without the JSON wrapper the SDK puts around it. */
function googleMessage(raw: string): string {
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{")));
    const msg = j?.error?.message;
    if (typeof msg === "string" && msg) return msg.slice(0, 200);
  } catch {
    /* not JSON */
  }
  return raw.replace(/\s+/g, " ").slice(0, 200);
}

export type ModelInfo = { id: string; label: string };

/**
 * Gemini models this key can use for generateContent. Doubles as a key check:
 * a bad key throws an ExtractionError with a readable message.
 */
export async function listModels(apiKey: string): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  try {
    await withBackend(apiKey, async (ai) => {
      out.length = 0;
      const pager = await ai.models.list({ config: { pageSize: 100 } });
      for await (const m of pager) {
        // "models/gemini-x" on the Gemini API, "publishers/google/models/gemini-x" on Vertex
        const id = (m.name ?? "").split("/").pop() ?? "";
        if (!id.startsWith("gemini")) continue;
        if (m.supportedActions && !m.supportedActions.includes("generateContent")) continue;
        // Skip models that can't read documents into text (speech, image generation, live audio, embeddings).
        if (/tts|image-generation|-image|live|audio|embedding|native-audio/i.test(id)) continue;
        if (out.some((x) => x.id === id)) continue;
        out.push({ id, label: m.displayName ? `${m.displayName} (${id})` : id });
      }
    });
  } catch (e) {
    throw new ExtractionError(describeApiError(e));
  }
  return out;
}
