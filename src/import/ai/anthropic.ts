import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Extraction } from "../types";
import { ExtractionError, parseReply, SYSTEM, userText, type AiInput, type ModelInfo } from "./prompt";

/** Claude via the Anthropic API, with the user's own key. Structured output keeps the reply in shape. */

const n = z.number().nullable();
// Strict shape for structured output (no defaults or transforms); parseReply then checks it again.
const ReplySchema = z.object({
  courseName: z.string().nullable(),
  sections: z.array(
    z.object({
      name: z.string(),
      weight: n,
      rule: z.object({ kind: z.enum(["sum", "average", "bestN", "dropLowest"]), n, total: n, k: n }),
      evidence: z.string(),
    }),
  ),
  items: z.array(
    z.object({
      name: z.string(),
      section: z.string().nullable(),
      score: n,
      max: n,
      flags: z.array(z.enum(["suspicious_zero", "what_if_value", "missing_submission", "dropped"])),
      stats: z.object({ low: n, lowerQuartile: n, median: n, mean: n, upperQuartile: n, high: n, n }),
      excused: z.boolean(),
    }),
  ),
  bands: z.array(z.object({ label: z.string(), min: z.number() })),
});

function client(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** Current-generation models that take the effort setting and the server-side refusal fallback. */
const CURRENT = /^claude-(opus|sonnet)-5-5$/;

export async function anthropicExtract(input: AiInput, apiKey: string, model: string, signal?: AbortSignal): Promise<Extraction> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.kind === "pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } });
  if (input.kind === "image") content.push({ type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } });
  content.push({ type: "text", text: userText(input) });

  let msg;
  try {
    msg = await client(apiKey).beta.messages.parse(
      {
        model,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content }],
        output_config: {
          ...(CURRENT.test(model) ? { effort: "medium" as const } : {}),
          format: betaZodOutputFormat(ReplySchema),
        },
        // If the model declines, the API retries on a fallback model (current models only).
        ...(CURRENT.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );
  } catch (e) {
    console.error("Claude request failed", e);
    throw new ExtractionError(describeAnthropicError(e));
  }
  if (msg.stop_reason === "refusal") throw new ExtractionError("Claude declined this input.");
  if (msg.stop_reason === "max_tokens") throw new ExtractionError("The reply was cut off. Try a smaller input.");
  if (!msg.parsed_output) throw new ExtractionError("The reply could not be read as grading data. Try again or paste text instead.");
  return parseReply(JSON.stringify(msg.parsed_output), input.label);
}

function describeAnthropicError(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return "Cancelled.";
  if (e instanceof Anthropic.AuthenticationError) return "Anthropic rejected this API key. Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This key can't use that model. Pick another in Settings.";
  if (e instanceof Anthropic.NotFoundError) return "Model not found. Pick another in Settings.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. Wait a minute and try again.";
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(e.message)) return "Your Anthropic account has no credit. Add some in the Anthropic Console.";
    return `Anthropic rejected the request: ${e.message.slice(0, 200)}`;
  }
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your connection.";
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || (e.status ?? 0) >= 500) return `Claude is overloaded or having trouble (${e.status}). It was retried. Try again in a minute.`;
    return `Anthropic error ${e.status ?? ""}: ${e.message.slice(0, 200)}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function listAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  try {
    for await (const m of client(apiKey).models.list({ limit: 100 })) {
      out.push({ id: m.id, label: m.display_name ? `${m.display_name} (${m.id})` : m.id });
    }
  } catch (e) {
    throw new ExtractionError(describeAnthropicError(e));
  }
  return out;
}
