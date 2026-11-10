import { useSyncExternalStore } from "react";
import { cloneBands, DEFAULT_PRESET } from "../engine/bands";
import { uid } from "../engine/id";
import type { BandPreset, Course, Item, Section } from "../engine/types";
import { DEFAULT_MODEL } from "../import/models";
import { withTopCutoffs } from "../engine/relative";
import { toRule } from "../import/draft";

export type Theme = "system" | "light" | "dark";

export type AppState = {
  version: 1;
  courses: Course[];
  selectedId: string | null;
  presets: BandPreset[];
  defaultPresetId: string;
  whatIfMode: boolean;
  theme: Theme;
  model: string;
  seenTutorial: boolean;
};

const STATE_KEY = "whatif-grades:v1";
const KEY_KEY = "whatif-grades:geminiKey";
const OLD_KEY_KEY = "whatif-grades:apiKey"; // Claude key from an earlier version; no longer used

function initial(): AppState {
  return {
    version: 1,
    courses: [],
    selectedId: null,
    presets: [structuredClone(DEFAULT_PRESET)],
    defaultPresetId: DEFAULT_PRESET.id,
    whatIfMode: false,
    theme: "system",
    model: DEFAULT_MODEL,
    seenTutorial: false,
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return initial();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const s = { ...initial(), ...parsed };
    if (!s.presets?.length) s.presets = [structuredClone(DEFAULT_PRESET)];
    if (!s.presets.some((p) => p.id === s.defaultPresetId)) s.defaultPresetId = s.presets[0].id;
    // Earlier versions used Claude models; switch to the Gemini default.
    if (!s.model?.startsWith("gemini")) s.model = DEFAULT_MODEL;
    // The built-in preset used to be called "Default", which read oddly next to "(default)".
    s.presets = s.presets.map((p) => (p.id === "default" && p.name === "Default" ? { ...p, name: "Standard" } : p));
    // Data saved before curved grading existed has no "top %" cutoffs.
    s.presets = s.presets.map((p) => ({ ...p, bands: withTopCutoffs(p.bands) }));
    s.courses = (s.courses ?? []).map((c) => ({ ...c, bands: withTopCutoffs(c.bands ?? []) }));
    return s;
  } catch {
    return initial();
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();
function persist() {
  // Synchronous: the state is small, and a debounced save can be lost if the tab closes right away.
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked; keep working in memory */
  }
}

export function getState(): AppState {
  return state;
}

/** Apply a mutation to a deep copy of the state, then notify. */
export function mutate(fn: (draft: AppState) => void) {
  const next = structuredClone(state);
  fn(next);
  state = next;
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

// ---- API key: kept on its own key, local storage only ----

export function getApiKey(): string {
  try {
    localStorage.removeItem(OLD_KEY_KEY);
    return localStorage.getItem(KEY_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setApiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_KEY, key);
    else localStorage.removeItem(KEY_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

// ---- Course helpers ----

export function defaultPreset(s: AppState = state): BandPreset {
  return s.presets.find((p) => p.id === s.defaultPresetId) ?? s.presets[0];
}

export function newCourse(name = "New course"): Course {
  const p = defaultPreset();
  return { id: uid(), name, sections: [], bands: cloneBands(p.bands), presetId: p.id };
}

export function addCourse(c: Course) {
  mutate((s) => {
    s.courses.push(c);
    s.selectedId = c.id;
  });
}

export function updateCourse(id: string, fn: (c: Course) => void) {
  mutate((s) => {
    const c = s.courses.find((x) => x.id === id);
    if (c) fn(c);
  });
}

export function replaceCourse(c: Course) {
  mutate((s) => {
    const i = s.courses.findIndex((x) => x.id === c.id);
    if (i >= 0) s.courses[i] = c;
    else s.courses.push(c);
    s.selectedId = c.id;
  });
}

export function deleteCourse(id: string) {
  mutate((s) => {
    s.courses = s.courses.filter((c) => c.id !== id);
    if (s.selectedId === id) s.selectedId = s.courses[0]?.id ?? null;
  });
}

export function updateSection(courseId: string, sectionId: string, fn: (s: Section) => void) {
  updateCourse(courseId, (c) => {
    const s = c.sections.find((x) => x.id === sectionId);
    if (s) fn(s);
  });
}

export function updateItem(courseId: string, sectionId: string, itemId: string, fn: (i: Item) => void) {
  updateSection(courseId, sectionId, (s) => {
    const i = s.items.find((x) => x.id === itemId);
    if (i) fn(i);
  });
}

/** Copy a course with fresh ids and all scores cleared, for next semester. */
export function templateFrom(c: Course): Course {
  return {
    ...structuredClone(c),
    id: uid(),
    name: `${c.name} (template)`,
    sections: c.sections.map((s) => ({
      ...structuredClone(s),
      id: uid(),
      items: s.items.map((i) => ({ ...i, id: uid(), score: null, whatIf: null })),
    })),
  };
}

// ---- Course JSON export / import ----

const FORMAT = "whatif-grades-course";

export function exportCourse(c: Course): string {
  return JSON.stringify({ format: FORMAT, version: 1, course: c }, null, 2);
}

export function parseCourseFile(text: string): Course {
  const data = JSON.parse(text);
  const c = (data?.format === FORMAT ? data.course : data) as Course;
  if (!c || typeof c.name !== "string" || !Array.isArray(c.sections)) throw new Error("Not a course file.");
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const stat = (s: unknown) => {
    if (!s || typeof s !== "object") return undefined;
    const o = s as Record<string, unknown>;
    const out = { low: numOrNull(o.low), lower: numOrNull(o.lower), median: numOrNull(o.median), mean: numOrNull(o.mean), upper: numOrNull(o.upper), high: numOrNull(o.high) };
    return Object.values(out).some((v) => v != null) ? out : undefined;
  };
  return {
    id: uid(),
    name: c.name,
    presetId: null,
    grading: c.grading === "relative" ? "relative" : "absolute",
    bands: withTopCutoffs(
      Array.isArray(c.bands) && c.bands.length
        ? c.bands.map((b) => ({ label: String(b.label), min: num(b.min, 0), ...(numOrNull(b.top) != null ? { top: numOrNull(b.top)! } : {}) }))
        : cloneBands(defaultPreset().bands),
    ),
    sections: c.sections.map((s) => ({
      id: uid(),
      name: String(s.name ?? "Section"),
      weight: num(s.weight, 0),
      rule: toRule(s.rule as never), // rebuilds a valid rule; anything unknown becomes "sum"
      items: (s.items ?? []).map((i) => ({
        id: uid(),
        name: String(i.name ?? "Item"),
        max: num(i.max, 100),
        score: numOrNull(i.score),
        whatIf: numOrNull(i.whatIf),
        stats: stat(i.stats),
      })),
    })),
  };
}
