import { DEFAULT_MODEL as GEMINI_DEFAULT } from "../models";
import { providerById, type ProviderId } from "./providers";

/** Settings for one provider. Each provider keeps its own key, so switching back loses nothing. */
export type ProviderSettings = { key: string; model: string; baseURL?: string };
export type AiConfig = { active: ProviderId; providers: Partial<Record<ProviderId, ProviderSettings>> };
/** What a request needs: the active provider and its settings. */
export type ActiveAi = { provider: ProviderId; key: string; model: string; baseURL?: string };

const KEY = "whatif-grades:ai";
const OLD_GEMINI_KEY = "whatif-grades:geminiKey";

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as AiConfig;
      if (c && typeof c.active === "string" && c.providers) return c;
    }
    // Earlier versions stored only a Gemini key (and the model in the app state).
    const gem = localStorage.getItem(OLD_GEMINI_KEY);
    let model = GEMINI_DEFAULT;
    try {
      const st = JSON.parse(localStorage.getItem("whatif-grades:v1") ?? "{}");
      if (typeof st.model === "string" && st.model.startsWith("gemini")) model = st.model;
    } catch {
      /* ignore */
    }
    const c: AiConfig = { active: "gemini", providers: gem ? { gemini: { key: gem, model } } : {} };
    if (gem) {
      saveAiConfig(c);
      localStorage.removeItem(OLD_GEMINI_KEY);
    }
    return c;
  } catch {
    return { active: "gemini", providers: {} };
  }
}

export function saveAiConfig(c: AiConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage blocked: settings last for this visit only */
  }
}

/** The active provider's settings, or null if it has no key yet. */
export function activeAi(c: AiConfig = loadAiConfig()): ActiveAi | null {
  const s = c.providers[c.active];
  if (!s?.key) return null;
  const p = providerById(c.active);
  return { provider: c.active, key: s.key, model: s.model || p.defaultModel || "", baseURL: p.baseURL ?? s.baseURL };
}
