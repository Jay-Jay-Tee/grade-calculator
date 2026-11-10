/**
 * AI providers that can read screenshots, PDFs and messy text. Three request formats cover them:
 * Gemini, Anthropic (Claude), and OpenAI's chat format (OpenAI itself plus any compatible
 * service: OpenRouter, Groq, DeepSeek, Mistral, Together, a local Ollama...).
 */
export type ProviderId = "gemini" | "anthropic" | "openai" | "openrouter" | "groq" | "custom";
export type ProviderKind = "gemini" | "anthropic" | "openai";

export type Provider = {
  id: ProviderId;
  label: string;
  /** Short name for messages ("a key for Claude"). */
  short: string;
  kind: ProviderKind;
  /** Fixed API address for OpenAI-format providers; "custom" asks the user. */
  baseURL?: string;
  keyUrl?: string;
  keyHint: string;
  /** Model to preselect before the model list loads, when we know a good one. */
  defaultModel?: string;
  /** Can the API read a PDF directly? If not, PDFs are turned into text in the browser first. */
  readsPdf: boolean;
  note?: string;
};

export const PROVIDERS: Provider[] = [
  {
    id: "gemini",
    label: "Google Gemini (free)",
    short: "Gemini",
    kind: "gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: 'Starts with "AIza" or "AQ."',
    defaultModel: "gemini-3.8-flash",
    readsPdf: true,
    note: "Free key from Google AI Studio. On the free tier, Google may use what you send to improve its products.",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    short: "Claude",
    kind: "anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: 'Starts with "sk-ant-"',
    defaultModel: "claude-opus-5-5",
    readsPdf: true,
    note: "Paid API key from the Anthropic Console.",
  },
  {
    id: "openai",
    label: "OpenAI",
    short: "OpenAI",
    kind: "openai",
    baseURL: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: 'Starts with "sk-"',
    readsPdf: true,
    note: "Paid API key from the OpenAI platform.",
  },
  {
    id: "openrouter",
    label: "OpenRouter (many models, one key)",
    short: "OpenRouter",
    kind: "openai",
    baseURL: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: 'Starts with "sk-or-"',
    readsPdf: false,
    note: "One key for models from many companies, including some free ones. Pick a model that can read images for screenshots.",
  },
  {
    id: "groq",
    label: "Groq",
    short: "Groq",
    kind: "openai",
    baseURL: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    keyHint: 'Starts with "gsk_"',
    readsPdf: false,
    note: "Free tier available. Pick a vision model for screenshots.",
  },
  {
    id: "custom",
    label: "Other (OpenAI-compatible)",
    short: "this provider",
    kind: "openai",
    keyHint: "Your key (any format)",
    readsPdf: false,
    note: "Any service that speaks OpenAI's chat API: DeepSeek, Mistral, Together, xAI, a local Ollama or LM Studio, and more.",
  },
];

export function providerById(id: ProviderId): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** Best guess at the provider from the key's format. Null when the key gives no clue. */
export function detectProvider(key: string): ProviderId | null {
  const k = key.trim();
  if (!k) return null;
  if (/^sk-ant-/.test(k)) return "anthropic";
  if (/^sk-or-/.test(k)) return "openrouter";
  if (/^gsk_/.test(k)) return "groq";
  if (/^AIza/.test(k) || /^AQ\./.test(k)) return "gemini";
  if (/^(sk-proj-|sk-svcacct-|sk-admin-)/.test(k)) return "openai";
  if (/^sk-[A-Za-z0-9_-]{20,}$/.test(k)) return "openai"; // plain "sk-" keys are usually OpenAI (DeepSeek uses them too)
  return null;
}

/** Example API addresses for the "Other" provider. */
export const CUSTOM_EXAMPLES: { label: string; baseURL: string }[] = [
  { label: "DeepSeek", baseURL: "https://api.deepseek.com/v1" },
  { label: "Mistral", baseURL: "https://api.mistral.ai/v1" },
  { label: "Together", baseURL: "https://api.together.xyz/v1" },
  { label: "xAI", baseURL: "https://api.x.ai/v1" },
  { label: "Ollama (this computer)", baseURL: "http://localhost:11434/v1" },
  { label: "LM Studio (this computer)", baseURL: "http://localhost:1234/v1" },
];
