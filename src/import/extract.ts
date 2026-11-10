import { fileKind, pdfToText, toAiInput, type RawInput } from "./inputs";
import { parseText } from "./textParser";
import type { Extraction } from "./types";

export type ExtractOptions = { apiKey: string; model: string; useAi: boolean; signal?: AbortSignal };

function failed(label: string, method: Extraction["method"], message: string): Extraction {
  return { source: label, method, courseName: null, sections: [], items: [], bands: [], warnings: [message] };
}

/** Run every input through extraction in parallel. Failures become warnings, not exceptions. */
export async function extractAll(inputs: RawInput[], opts: ExtractOptions): Promise<Extraction[]> {
  const useAi = opts.useAi && opts.apiKey.trim().length > 0;
  return Promise.all(
    inputs.map(async (raw): Promise<Extraction> => {
      try {
        if (useAi) {
          const { aiExtract } = await import("./aiExtract"); // SDK loads only when needed
          return await aiExtract(await toAiInput(raw), opts.apiKey.trim(), opts.model, opts.signal);
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
        return failed(raw.label, useAi ? "ai" : "text", e instanceof Error ? e.message : String(e));
      }
    }),
  );
}
