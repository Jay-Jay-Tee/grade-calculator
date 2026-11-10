import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Extraction } from "./types";


const RuleSchema = z.object({
  kind: z.enum(["sum", "average", "bestN", "dropLowest"]),
  n: z.number().nullable().describe("bestN: how many items count"),
  total: z.number().nullable().describe("bestN: how many items there will be in total"),
  k: z.number().nullable().describe("dropLowest: how many lowest items are dropped"),
});

const ExtractionSchema = z.object({
  courseName: z.string().nullable(),
  sections: z.array(
    z.object({
      name: z.string(),
      weight: z.number().nullable().describe("percent of the course, null if not stated"),
      rule: RuleSchema,
      evidence: z.string().describe("short verbatim snippet from the source that supports this row"),
    }),
  ),
  items: z.array(
    z.object({
      name: z.string(),
      section: z.string().nullable().describe("assignment group / section name, null if unknown"),
      score: z.number().nullable().describe("marks earned, null if not graded yet"),
      max: z.number().nullable(),
      flags: z.array(z.enum(["suspicious_zero", "what_if_value", "missing_submission", "dropped"])),
      classLow: z.number().nullable().describe("class Low from Score Details, if shown"),
    }),
  ),
  bands: z.array(z.object({ label: z.string(), min: z.number() })),
});

const SYSTEM = `You extract course grading data for a grade calculator. The input is one source: a pasted LMS grades page, a screenshot, a syllabus or lecture slide, or a results email.

Return only what the source supports. Do not invent weights, scores or items.

Sections (how the course is weighted):
- One row per weighted component, weight in percent of the whole course.
- rule.kind: "sum" (total earned / total max) unless the source says otherwise; "average" for mean of item percentages; "bestN" when only the best n of several items count; "dropLowest" when the lowest k are dropped.
- Pooled components: "RA1, PA1, RA2, PA2 at 8% each, best 3 of 4 count" is ONE section named "RA/PA" with weight 24 (8 x 3) and rule bestN n=3 total=4. Use the same pattern for any "x% each, best n of m".
- evidence: a short verbatim snippet (under 120 characters).

Items (individual marks):
- name, section (the assignment group shown with it, e.g. "Check-Ins", "RA/PA"), score, max. Ungraded or "-" scores are null.
- Canvas grades pages: ignore the "Click to test a different score" text and the "Score Details" stat blocks, except: put the class Low into classLow, and add the flag "suspicious_zero" when the score is 0 but the class Low is above 0 (usually a what-if value or a missing submission). Use "what_if_value" if the page marks a score as a what-if, "missing_submission" if marked missing, "dropped" if marked as dropped.

Bands: only if the source lists grade cutoffs (e.g. "A+ 90"). min is the inclusive lower bound in percent. Otherwise an empty list.

courseName: the course code or name if shown, else null.`;

export type AiInput =
  | { kind: "text"; label: string; text: string }
  | { kind: "pdf"; label: string; base64: string }
  | { kind: "image"; label: string; base64: string; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" };

export class ExtractionError extends Error {}

export async function aiExtract(input: AiInput, apiKey: string, model: string, signal?: AbortSignal): Promise<Extraction> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.kind === "pdf") {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } });
  } else if (input.kind === "image") {
    content.push({ type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } });
  }
  content.push({
    type: "text",
    text:
      input.kind === "text"
        ? `Source "${input.label}":\n\n<source>\n${input.text}\n</source>\n\nExtract the grading data.`
        : `Source "${input.label}" is attached above. Extract the grading data.`,
  });

  let msg;
  try {
    msg = await client.beta.messages.parse(
      {
        model,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content }],
        output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionSchema) },
        // Server-side fallback: if the model declines, the API retries on a fallback model.
        // Only the Opus 5.5 / Sonnet 5.5 tier accepts it.
        ...(model === "claude-haiku-5-5"
          ? {}
          : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      },
      { signal },
    );
  } catch (e) {
    throw new ExtractionError(describeApiError(e));
  }

  if (msg.stop_reason === "refusal") throw new ExtractionError("The model declined this input.");
  if (msg.stop_reason === "max_tokens") throw new ExtractionError("The response was cut off. Try a smaller input.");
  const out = msg.parsed_output;
  if (!out) throw new ExtractionError("The response could not be read as JSON.");

  return {
    source: input.label,
    method: "ai",
    courseName: out.courseName,
    sections: out.sections.map((s) => ({ name: s.name, weight: s.weight, rule: s.rule, evidence: s.evidence })),
    items: out.items.map((i) => {
      const flags = [...i.flags];
      if (i.score === 0 && i.classLow != null && i.classLow > 0 && !flags.includes("suspicious_zero")) {
        flags.push("suspicious_zero");
      }
      return { name: i.name, section: i.section, score: i.score, max: i.max, flags, classLow: i.classLow };
    }),
    bands: out.bands,
    warnings: [],
  };
}

function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "API key was rejected. Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key can't use that model.";
  if (e instanceof Anthropic.NotFoundError) return "Model not found. Pick another in Settings.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited. Wait a moment and try again.";
  if (e instanceof Anthropic.BadRequestError) return `The API rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIUserAbortError) return "Cancelled.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the API. Check your connection.";
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
