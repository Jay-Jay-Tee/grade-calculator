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
- `src/import/` - plain-text Canvas/syllabus parser, pdf.js text extraction, Gemini extraction
  (`aiExtract.ts`), and the review draft: merge, flags, apply (`draft.ts`).
- `src/state/store.ts` - app state persisted to localStorage; course JSON export/import; templates.
- `src/ui/` - React components.

## How the numbers work

Every unknown (ungraded item, planned best-N slot, empty section) is filled with one value x.
x = 0 gives locked points, x = 100 gives max possible, and "needed" is the x that reaches a band's
minimum, found by bisection. Because the total is monotonic in x, this handles best-N and drop-lowest
correctly: a low score that would be dropped doesn't move the total.

## Reading screenshots and PDFs (Gemini)

Each user adds their own free key from [Google AI Studio](https://aistudio.google.com/apikey) in Settings.
The key is stored in that browser only and sent only to Google. Settings lists every model the key can use;
the default is `gemini-3.8-flash`, and Flash-Lite gets a larger free daily allowance. Requests ask for JSON
matching a schema and the reply is validated with zod. Without a key, pasted text and text-based PDFs go
through the regex parser instead.

On Google's free tier, submitted content may be used to improve Google's products.
