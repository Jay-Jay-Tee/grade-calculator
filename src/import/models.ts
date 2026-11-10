/** Gemini models offered in Settings. Free-tier limits are per Google AI Studio project. */
export const MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (most accurate)" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (more free requests)" },
] as const;
export const DEFAULT_MODEL = "gemini-3.8-flash";

export const AI_STUDIO_KEY_URL = "https://aistudio.google.com/apikey";
