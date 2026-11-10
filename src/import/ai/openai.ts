import OpenAI from "openai";
import type { Extraction } from "../types";
import { ExtractionError, parseReply, SYSTEM_WITH_SCHEMA, userText, type AiInput, type ModelInfo } from "./prompt";
import { providerById, type ProviderId } from "./providers";

/**
 * OpenAI's chat format: OpenAI itself and any compatible service (OpenRouter, Groq, DeepSeek,
 * Mistral, Ollama...). JSON mode plus the schema in the instructions works across all of them;
 * if a service doesn't support JSON mode, the request is sent again without it.
 */

function client(provider: ProviderId, apiKey: string, baseURL: string) {
  return new OpenAI({
    apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    // OpenRouter shows the app name in its dashboard.
    ...(provider === "openrouter" ? { defaultHeaders: { "HTTP-Referer": location.origin, "X-Title": "What-If Grades" } } : {}),
  });
}

export async function openaiExtract(
  input: AiInput,
  provider: ProviderId,
  apiKey: string,
  baseURL: string,
  model: string,
  signal?: AbortSignal,
): Promise<Extraction> {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (input.kind === "image") parts.push({ type: "image_url", image_url: { url: `data:${input.mediaType};base64,${input.base64}` } });
  if (input.kind === "pdf") {
    parts.push({ type: "file", file: { filename: `${input.label || "document"}.pdf`, file_data: `data:application/pdf;base64,${input.base64}` } });
  }
  parts.push({ type: "text", text: userText(input) });

  const c = client(provider, apiKey, baseURL);
  const send = (jsonMode: boolean) =>
    c.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: SYSTEM_WITH_SCHEMA },
          { role: "user", content: parts },
        ],
        ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      },
      { signal },
    );

  let res;
  try {
    try {
      res = await send(true);
    } catch (e) {
      // Some compatible services don't support JSON mode; the instructions still ask for JSON.
      if (e instanceof OpenAI.BadRequestError && /response_format|json_object|json mode/i.test(e.message)) res = await send(false);
      else throw e;
    }
  } catch (e) {
    console.error("AI request failed", e);
    throw new ExtractionError(describeOpenAIError(e, provider, baseURL, input));
  }
  const choice = res.choices?.[0];
  if (choice?.message?.refusal) throw new ExtractionError(`The model declined: ${choice.message.refusal.slice(0, 160)}`);
  if (choice?.finish_reason === "length") throw new ExtractionError("The reply was cut off. Try a smaller input or another model.");
  const text = choice?.message?.content;
  if (!text) throw new ExtractionError("The model returned nothing. Try again or pick another model.");
  return parseReply(text, input.label);
}

function describeOpenAIError(e: unknown, provider: ProviderId, baseURL: string, input?: AiInput): string {
  const name = provider === "custom" ? safeHost(baseURL) : providerById(provider).short;
  if (e instanceof OpenAI.APIUserAbortError) return "Cancelled.";
  if (e instanceof OpenAI.AuthenticationError) return `${name} rejected this API key. Check it, and that it's for ${name}.`;
  if (e instanceof OpenAI.PermissionDeniedError) return `This key can't use that model on ${name}. Pick another in Settings.`;
  if (e instanceof OpenAI.NotFoundError) return `Model not found on ${name}. Pick another in Settings.`;
  if (e instanceof OpenAI.RateLimitError) {
    if (/quota|billing|credit/i.test(e.message)) return `Your ${name} account is out of credit or quota.`;
    return `Rate limited by ${name}. Wait a minute and try again.`;
  }
  if (e instanceof OpenAI.BadRequestError) {
    const m = e.message;
    if (input?.kind === "image" && /image|vision|multimodal|content type/i.test(m)) {
      return "This model can't read images. Pick a model with vision in Settings, or paste text instead.";
    }
    if (input?.kind === "pdf" && /file|pdf|document/i.test(m)) return "This model can't read PDFs. Pick another model, or paste the text instead.";
    return `${name} rejected the request: ${m.slice(0, 200)}`;
  }
  if (e instanceof OpenAI.APIConnectionError) {
    if (provider === "custom") {
      return `Couldn't reach ${baseURL}. Check the address. If it's running, it may not allow requests from web pages (CORS). For Ollama, start it with OLLAMA_ORIGINS=* set.`;
    }
    return `Couldn't reach ${name}. Check your connection.`;
  }
  if (e instanceof OpenAI.APIError) {
    if ((e.status ?? 0) >= 500) return `${name} is having trouble (${e.status}). It was retried. Try again in a minute or pick another model.`;
    return `${name} error ${e.status ?? ""}: ${e.message.slice(0, 200)}`;
  }
  return e instanceof Error ? e.message : String(e);
}

const NOT_FOR_TEXT = /embed|tts|whisper|dall-e|moderation|audio|realtime|transcribe|image|search|computer|babbage|davinci/i;

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * OpenRouter's model list is public, so listing models doesn't prove the key works.
 * Its key endpoint does (401 for a bad key).
 */
async function checkOpenRouterKey(apiKey: string, baseURL: string) {
  let res: Response;
  try {
    res = await fetch(`${baseURL.replace(/\/$/, "")}/key`, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new ExtractionError("Couldn't reach OpenRouter. Check your connection.");
  }
  if (res.status === 401 || res.status === 403) throw new ExtractionError("OpenRouter rejected this API key. Check it, and that it's for OpenRouter.");
}

/** Models the key can use, best guess first. */
export async function listOpenAIModels(provider: ProviderId, apiKey: string, baseURL: string): Promise<ModelInfo[]> {
  const raw: { id: string; created: number }[] = [];
  if (provider === "openrouter") await checkOpenRouterKey(apiKey, baseURL);
  try {
    for await (const m of client(provider, apiKey, baseURL).models.list()) raw.push({ id: m.id, created: m.created ?? 0 });
  } catch (e) {
    throw new ExtractionError(describeOpenAIError(e, provider, baseURL));
  }
  let list = provider === "openai" ? raw.filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !NOT_FOR_TEXT.test(m.id)) : raw;
  // Newest first, so the latest models are near the top.
  list = [...list].sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  return list.map((m) => ({ id: m.id, label: m.id }));
}

/** A sensible model to preselect from a provider's list. */
export function suggestModel(provider: ProviderId, models: ModelInfo[]): string | undefined {
  const ids = models.map((m) => m.id);
  if (provider === "openrouter") return ids.find((id) => id === "openrouter/auto") ?? ids[0];
  if (provider === "groq") return ids.find((id) => /vision|scout|maverick/i.test(id)) ?? ids[0];
  if (provider === "openai") return ids.find((id) => /^gpt-/.test(id) && !/pro|nano/.test(id)) ?? ids[0];
  return ids[0];
}
