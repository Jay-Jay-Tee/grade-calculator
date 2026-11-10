# What-If Grades

Local-first grade calculator for courses where the LMS has "Calculation of totals has been disabled".
Define how a course is weighted, add marks, and see current %, projected % under what-if scores,
and what you need on the rest to reach each grade band.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # engine, parser and import tests (includes the CS1101S fixture)
npm run build
```

## Using it

A 10-page guide opens on first visit and is always available from **Guide** in the header
(`src/ui/Tutorial.tsx`). It covers sections and rules, entering marks, the summary, "What do I need?",
what-if mode, importing and review, grade bands, and export/templates.

## Layout

- `src/engine/` - pure calculation engine (`calc.ts`), grade bands, the CS1101S fixture. No UI imports.
- `src/import/` - plain-text Canvas/syllabus parser, pdf.js text extraction, AI extraction for any provider (`ai/`)
  (`aiExtract.ts`), and the review draft: merge, flags, apply (`draft.ts`).
- `src/state/store.ts` - app state persisted to localStorage; course JSON export/import; templates.
- `src/ui/` - React components.

## How the numbers work

**Absolute.** Every unknown (ungraded item, planned best-N slot, empty section) is filled with one value x.
x = 0 gives locked points, x = 100 gives max possible. The course total is piecewise linear in x, with kinks
only where x overtakes a graded item in a best-N or drop-lowest section, so the x that reaches a band is
solved exactly segment by segment (`neededForTarget`). A low score that would be dropped doesn't move the
total. Excused items count nowhere. An optional per-course rule rounds the final % before banding, and the
needed scores aim at the rounded cutoff.

**Curved.** Each item's score becomes a z-score by interpolating between the class stats placed at their
normal positions (quartiles at +-0.674, median at 0, low/high at +-z_n for class size n). Full marks shared by
many students sit in the middle of that tied group. Each item's spread comes from its interquartile range.
Items combine in course points: z_total = sum(s_i z_i) / sqrt(Var), assuming tests correlate with rho. Standing
is shown at rho = 0.6 with a range for 0.4 to 0.8. `src/engine/curveSim.test.ts` simulates classes and checks
the estimate against true ranks (about 2-3.5 percentile points of error, vs 4-10.5 for averaging percentiles).

## Reading screenshots and PDFs (any AI provider)

Each user adds their own key in Settings. Supported: Google Gemini (free tier via
[Google AI Studio](https://aistudio.google.com/apikey)), Anthropic Claude, OpenAI, OpenRouter, Groq, and any
OpenAI-compatible API (DeepSeek, Mistral, Together, xAI, local Ollama / LM Studio) by base URL. The provider is
guessed from the key format and can be changed. Each provider keeps its own key and model, stored in that browser
only and sent only to that provider. Settings lists the models the key can use.

All providers share one prompt, one JSON shape and one zod check of the reply (`src/import/ai/prompt.ts`);
adapters in `src/import/ai/` only differ in how they send it (Gemini JSON schema, Claude structured output,
OpenAI-format JSON mode with the schema in the prompt). Providers that can't read PDFs get the PDF's text instead.
Without a key, pasted text and text-based PDFs go through the regex parser.
