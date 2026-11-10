import { useEffect, useState } from "react";
import { cloneBands, validateBands } from "../engine/bands";
import { uid } from "../engine/id";
import type { Course } from "../engine/types";
import { AI_STUDIO_KEY_URL, DEFAULT_MODEL, MODELS } from "../import/models";
import type { ModelInfo } from "../import/aiExtract";
import { getApiKey, mutate, setApiKey, updateCourse, useAppState, type Theme } from "../state/store";
import { withTopCutoffs } from "../engine/relative";
import { BandEditor } from "./BandEditor";
import { Modal } from "./Modal";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useAppState();
  const [editId, setEditId] = useState(s.defaultPresetId);
  const preset = s.presets.find((p) => p.id === editId) ?? s.presets[0];

  const updatePreset = (fn: (p: (typeof s.presets)[number]) => void) =>
    mutate((st) => {
      const p = st.presets.find((x) => x.id === preset.id);
      if (p) fn(p);
    });

  return (
    <Modal title="Settings" onClose={onClose}>
      <GeminiKeySection />

      <section className="settings-block">
        <h3>Appearance</h3>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button key={t} role="radio" aria-checked={s.theme === t} className={s.theme === t ? "on" : ""} onClick={() => mutate((st) => void (st.theme = t))}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-block">
        <h3>Grade band presets</h3>
        <p className="hint">
          A preset is a saved set of grade cutoffs, like "90 for A+, 85 for A" or "Strict 90/80/70". Apply one to any course from{" "}
          <b>Grade bands</b>. New courses start with the one marked "used for new courses".
        </p>
        <div className="row gap wrap">
          <select value={preset.id} onChange={(e) => setEditId(e.target.value)} aria-label="Preset">
            {s.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === s.defaultPresetId ? " (used for new courses)" : ""}
              </option>
            ))}
          </select>
          <button
            className="btn small"
            onClick={() => {
              const id = uid();
              mutate((st) => void st.presets.push({ id, name: `${preset.name} copy`, bands: cloneBands(preset.bands) }));
              setEditId(id);
            }}
          >
            Duplicate
          </button>
          {preset.id !== s.defaultPresetId && (
            <button className="btn small" onClick={() => mutate((st) => void (st.defaultPresetId = preset.id))}>
              Use for new courses
            </button>
          )}
          {s.presets.length > 1 && (
            <button
              className="btn small ghost danger"
              onClick={() => {
                if (!confirm(`Delete preset "${preset.name}"?`)) return;
                mutate((st) => {
                  st.presets = st.presets.filter((p) => p.id !== preset.id);
                  if (st.defaultPresetId === preset.id) st.defaultPresetId = st.presets[0].id;
                });
                setEditId(s.presets.find((p) => p.id !== preset.id)!.id);
              }}
            >
              Delete
            </button>
          )}
        </div>
        <label className="field">
          Preset name
          <input value={preset.name} onChange={(e) => updatePreset((p) => void (p.name = e.target.value))} />
        </label>
        <BandEditor bands={preset.bands} onChange={(b) => updatePreset((p) => void (p.bands = b))} />
      </section>
    </Modal>
  );
}

export function CourseBandsModal({ course, onClose }: { course: Course; onClose: () => void }) {
  const s = useAppState();
  const [pick, setPick] = useState(course.presetId ?? s.defaultPresetId);
  const fromPreset = s.presets.find((p) => p.id === course.presetId);
  const edited = fromPreset && JSON.stringify(fromPreset.bands) !== JSON.stringify(course.bands);
  const valid = validateBands(course.bands).length === 0;
  // Curved cutoffs exist on every band, so presets keep both sets.

  return (
    <Modal title={`Grade bands for ${course.name}`} onClose={onClose}>
      <p className="hint">
        {fromPreset ? `Based on "${fromPreset.name}"${edited ? ", edited for this course" : ""}.` : "Custom bands for this course."} Many
        courses are curved, so these are your own targets.
      </p>
      <div className="row gap wrap">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Preset">
          {s.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          onClick={() => {
            const p = s.presets.find((x) => x.id === pick);
            if (p)
              updateCourse(course.id, (c) => {
                c.bands = withTopCutoffs(cloneBands(p.bands));
                c.presetId = p.id;
              });
          }}
        >
          Use preset
        </button>
        <button
          className="btn small"
          disabled={!valid}
          onClick={() => {
            const name = prompt("Preset name", `${course.name} bands`);
            if (!name) return;
            const id = uid();
            mutate((st) => {
              st.presets.push({ id, name, bands: cloneBands(course.bands) });
              const c = st.courses.find((x) => x.id === course.id);
              if (c) c.presetId = id;
            });
          }}
        >
          Save as preset
        </button>
      </div>
      <div className="segmented" role="radiogroup" aria-label="How this course is graded">
        {(["absolute", "relative"] as const).map((g) => (
          <button
            key={g}
            role="radio"
            aria-checked={(course.grading ?? "absolute") === g}
            className={(course.grading ?? "absolute") === g ? "on" : ""}
            onClick={() =>
              updateCourse(course.id, (c) => {
                c.grading = g;
                if (g === "relative") c.bands = withTopCutoffs(c.bands);
              })
            }
          >
            {g === "absolute" ? "Absolute" : "Curved"}
          </button>
        ))}
      </div>
      <BandEditor
        bands={course.bands}
        showTop={course.grading === "relative"}
        onChange={(b) => updateCourse(course.id, (c) => void (c.bands = b))}
      />
    </Modal>
  );
}

/** Gemini key: where to get one, a key check, and the model picker (defaults to Flash). */
function GeminiKeySection() {
  const s = useAppState();
  const [key, setKey] = useState(getApiKey());
  const [showKey, setShowKey] = useState(false);
  const [savedKey, setSavedKey] = useState(getApiKey());
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "checking" | "ok" | "error"; text: string }>({ kind: "idle", text: "" });
  const [custom, setCustom] = useState(false);

  const check = async (k: string) => {
    if (!k) return;
    setStatus({ kind: "checking", text: "Checking key..." });
    try {
      const { listModels } = await import("../import/aiExtract");
      const list = await listModels(k);
      setModels(list);
      setStatus({ kind: "ok", text: `Key works. ${list.length} models available.` });
    } catch (e) {
      setModels(null);
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    if (savedKey) void check(savedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flash first, then the rest as Google lists them. Fall back to the built-in list until loaded.
  const options: ModelInfo[] = (() => {
    const base = models && models.length ? models : MODELS.map((m) => ({ id: m.id, label: m.label }));
    const flash = base.find((m) => m.id === DEFAULT_MODEL);
    const rest = base.filter((m) => m.id !== DEFAULT_MODEL);
    const list = [flash ?? { id: DEFAULT_MODEL, label: "Gemini 3.8 Flash" }, ...rest];
    return list.map((m) => (m.id === DEFAULT_MODEL ? { ...m, label: `${m.label} - recommended` } : m));
  })();
  const inList = options.some((m) => m.id === s.model);

  return (
    <section className="settings-block">
      <h3>Gemini API key (free)</h3>
      <p className="hint">
        Lets the app read screenshots, PDFs and messy text with Google's Gemini. Without a key, pasted text and text PDFs still work.
      </p>
      <ol className="key-steps">
        <li>
          Open{" "}
          <a href={AI_STUDIO_KEY_URL} target="_blank" rel="noreferrer">
            Google AI Studio
          </a>{" "}
          and sign in with a Google account.
        </li>
        <li>
          Tap <b>Create API key</b>. If it asks for a project, let it make one.
        </li>
        <li>Copy the key (it starts with "AIza") and paste it below.</li>
      </ol>
      <a className="btn small get-key" href={AI_STUDIO_KEY_URL} target="_blank" rel="noreferrer">
        Get a free key from Google AI Studio
      </a>
      <div className="row gap">
        <input
          className="grow"
          type={showKey ? "text" : "password"}
          placeholder="AIza..."
          value={key}
          aria-label="Gemini API key"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="btn small" onClick={() => setShowKey((v) => !v)}>
          {showKey ? "Hide" : "Show"}
        </button>
      </div>
      <div className="row gap wrap">
        <button
          className="btn small primary"
          disabled={key.trim() === savedKey}
          onClick={() => {
            setApiKey(key.trim());
            setSavedKey(key.trim());
            void check(key.trim());
          }}
        >
          Save key
        </button>
        {savedKey && (
          <button
            className="btn small ghost danger"
            onClick={() => {
              setApiKey("");
              setKey("");
              setSavedKey("");
              setModels(null);
              setStatus({ kind: "idle", text: "" });
            }}
          >
            Remove key
          </button>
        )}
        <span className={`hint key-status ${status.kind}`}>
          {status.text || (savedKey ? "Key saved." : "No key saved.")}
        </span>
      </div>
      {key.trim() && !key.trim().startsWith("AIza") && <div className="field-warn">Gemini keys usually start with "AIza". Check you copied the whole key.</div>}

      <label className="field">
        Model
        <select
          value={custom || !inList ? "__custom" : s.model}
          onChange={(e) => {
            if (e.target.value === "__custom") setCustom(true);
            else {
              setCustom(false);
              mutate((st) => void (st.model = e.target.value));
            }
          }}
        >
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value="__custom">Other (type a model name)</option>
        </select>
      </label>
      {(custom || !inList) && (
        <input
          value={s.model}
          aria-label="Model name"
          placeholder="e.g. gemini-3.8-flash"
          spellCheck={false}
          onChange={(e) => mutate((st) => void (st.model = e.target.value.trim()))}
        />
      )}
      <p className="hint small">
        {models ? "These are the models your key can use. " : "Save a key to see every model it can use. "}
        Flash is a good balance of accuracy and free daily limit. Flash-Lite gets more free requests per day. On the free tier, Google
        may use what you send to improve its products, so don't upload anything you wouldn't share. The key stays in this browser and is
        only sent to Google.
      </p>
      {s.model !== DEFAULT_MODEL && (
        <button className="link small" onClick={() => { setCustom(false); mutate((st) => void (st.model = DEFAULT_MODEL)); }}>
          Back to Flash (recommended)
        </button>
      )}
    </section>
  );
}
