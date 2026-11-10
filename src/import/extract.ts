import type { ActiveAi } from "./ai/config";
import { providerById } from "./ai/providers";
import { fileKind, pdfToText, toAiInput, type RawInput } from "./inputs";
import { parseText } from "./textParser";
import type { Extraction } from "./types";

export type ExtractOptions = { ai: ActiveAi | null; useAi: boolean; signal?: AbortSignal };

function failed(label: string, method: Extraction["method"], message: string): Extraction {
  return { source: label, method, courseName: null, sections: [], items: [], bands: [], warnings: [message] };
}

/** Run every input through extraction in parallel. Failures become warnings, not exceptions. */
export async function extractAll(inputs: RawInput[], opts: ExtractOptions): Promise<Extraction[]> {
  const ai = opts.useAi && opts.ai?.key.trim() ? opts.ai : null;
  return Promise.all(
    inputs.map(async (raw): Promise<Extraction> => {
      try {
        if (ai) {
          const { aiExtract } = await import("./aiExtract"); // provider SDKs load only when needed
          // Providers that can't read PDFs get the PDF's text instead.
          if (raw.kind === "file" && fileKind(raw.file) === "pdf" && !providerById(ai.provider).readsPdf) {
            const text = await pdfToText(raw.file);
            if (!text.trim()) {
              return failed(raw.label, "ai", "This PDF has no text (it may be scanned) and this provider can't read PDFs. Use Gemini, Claude or OpenAI, or a screenshot.");
            }
            return await aiExtract({ kind: "text", label: raw.label, text }, ai, opts.signal);
          }
          return await aiExtract(await toAiInput(raw), ai, opts.signal);
        }
        if (raw.kind === "text") return parseText(raw.text, raw.label);
        const k = fileKind(raw.file);
        if (k === "pdf") {
          const text = await pdfToText(raw.file);
          const r = parseText(text, raw.label);
          r.method = "pdf-text";
          if (!text.trim()) r.warnings = ["No text found in this PDF (it may be scanned). Add an API key to read it."];
          return r;
        }
        if (k === "image") return failed(raw.label, "text", "Images need an API key. Add one in Settings.");
        return parseText(await raw.file.text(), raw.label);
      } catch (e) {
        return failed(raw.label, ai ? "ai" : "text", e instanceof Error ? e.message : String(e));
      }
    }),
  );
}
