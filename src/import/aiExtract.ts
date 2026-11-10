import type { Extraction } from "./types";
import type { ActiveAi } from "./ai/config";
import { providerById } from "./ai/providers";
import { ExtractionError, type AiInput, type ModelInfo } from "./ai/prompt";

/**
 * Sends an input to whichever AI provider the user set up. Each provider's code (and SDK) only
 * loads when it's used.
 */

export { ExtractionError };
export type { AiInput, ModelInfo };

export async function aiExtract(input: AiInput, ai: ActiveAi, signal?: AbortSignal): Promise<Extraction> {
  const p = providerById(ai.provider);
  if (!ai.model) throw new ExtractionError("Pick a model in Settings first.");
  switch (p.kind) {
    case "gemini": {
      const { geminiExtract } = await import("./ai/gemini");
      return geminiExtract(input, ai.key, ai.model, signal);
    }
    case "anthropic": {
      const { anthropicExtract } = await import("./ai/anthropic");
      return anthropicExtract(input, ai.key, ai.model, signal);
    }
    case "openai": {
      if (!ai.baseURL) throw new ExtractionError("Set the provider's API address in Settings.");
      const { openaiExtract } = await import("./ai/openai");
      return openaiExtract(input, ai.provider, ai.key, ai.baseURL, ai.model, signal);
    }
  }
}

/**
 * Models the key can use, plus one to preselect. Doubles as a key check (throws ExtractionError).
 * `keyChecked` is false for "Other" providers: some list models without checking the key.
 */
export async function listModels(ai: Omit<ActiveAi, "model">): Promise<{ models: ModelInfo[]; suggested?: string; keyChecked: boolean }> {
  const p = providerById(ai.provider);
  switch (p.kind) {
    case "gemini": {
      const { listGeminiModels } = await import("./ai/gemini");
      const models = await listGeminiModels(ai.key);
      return { models, suggested: models.find((m) => m.id === p.defaultModel)?.id ?? p.defaultModel, keyChecked: true };
    }
    case "anthropic": {
      const { listAnthropicModels } = await import("./ai/anthropic");
      const models = await listAnthropicModels(ai.key);
      return { models, suggested: models.find((m) => m.id === p.defaultModel)?.id ?? models[0]?.id, keyChecked: true };
    }
    case "openai": {
      if (!ai.baseURL) throw new ExtractionError("Set the provider's API address first.");
      const { listOpenAIModels, suggestModel } = await import("./ai/openai");
      const models = await listOpenAIModels(ai.provider, ai.key, ai.baseURL);
      return { models, suggested: suggestModel(ai.provider, models), keyChecked: ai.provider !== "custom" };
    }
  }
}
