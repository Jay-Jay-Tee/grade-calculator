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
- `src/import/` - plain-text Canvas/syllabus parser, pdf.js text extraction, Claude extraction
  (`aiExtract.ts`), and the review draft: merge, flags, apply (`draft.ts`).
- `src/state/store.ts` - app state persisted to localStorage; course JSON export/import; templates.
- `src/ui/` - React components.

## How the numbers work

Every unknown (ungraded item, planned best-N slot, empty section) is filled with one value x.
x = 0 gives locked points, x = 100 gives max possible, and "needed" is the x that reaches a band's
minimum, found by bisection. Because the total is monotonic in x, this handles best-N and drop-lowest
correctly: a low score that would be dropped doesn't move the total.

## Claude extraction

Paste an Anthropic API key in Settings (stored in this browser only). Images, PDFs and text go to
the Messages API with structured JSON output. Opus 5.5 and Sonnet 5.5 requests turn on the server-side
refusal fallback (`fallbacks: "default"`). Without a key, pasted text and text-based PDFs go through
the regex parser instead.
