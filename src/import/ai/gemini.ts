import { ApiError, GoogleGenAI } from "@google/genai";
import type { Extraction } from "../types";
import { MODELS } from "../models";
import { ExtractionError, JSON_SCHEMA, parseReply, SYSTEM, userText, type AiInput, type ModelInfo } from "./prompt";

/** Gemini: the user's own Google AI Studio key. */

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

export async function geminiExtract(input: AiInput, apiKey: string, model: string, signal?: AbortSignal): Promise<Extraction> {

  const parts: ({ inlineData: { mimeType: string; data: string } } | { text: string })[] = [];
  if (input.kind === "pdf") parts.push({ inlineData: { mimeType: "application/pdf", data: input.base64 } });
  if (input.kind === "image") parts.push({ inlineData: { mimeType: input.mediaType, data: input.base64 } });
  parts.push({ text: userText(input) });

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
    throw new ExtractionError(describeGeminiError(e));
  }

  const blocked = res.promptFeedback?.blockReason;
  if (blocked) throw new ExtractionError(`Gemini blocked this input (${blocked}).`);
  const finish = res.candidates?.[0]?.finishReason;
  if (finish === "MAX_TOKENS") throw new ExtractionError("The response was cut off. Try a smaller input.");
  const text = res.text;
  if (!text) throw new ExtractionError(`Gemini returned nothing${finish ? ` (${finish})` : ""}.`);

  return parseReply(text, input.label, warnings);
}

function describeGeminiError(e: unknown): string {
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

export async function listGeminiModels(apiKey: string): Promise<ModelInfo[]> {
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
    throw new ExtractionError(describeGeminiError(e));
  }
  return out;
}
