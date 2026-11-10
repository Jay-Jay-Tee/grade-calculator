import { useState } from "react";
import { cloneBands, validateBands } from "../engine/bands";
import { uid } from "../engine/id";
import type { Course } from "../engine/types";
import { MODELS } from "../import/models";
import { getApiKey, mutate, setApiKey, updateCourse, useAppState, type Theme } from "../state/store";
import { BandEditor } from "./BandEditor";
import { Modal } from "./Modal";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useAppState();
  const [key, setKey] = useState(getApiKey());
  const [showKey, setShowKey] = useState(false);
  const [savedKey, setSavedKey] = useState(getApiKey());
  const [editId, setEditId] = useState(s.defaultPresetId);
  const preset = s.presets.find((p) => p.id === editId) ?? s.presets[0];

  const updatePreset = (fn: (p: (typeof s.presets)[number]) => void) =>
    mutate((st) => {
      const p = st.presets.find((x) => x.id === preset.id);
      if (p) fn(p);
    });

  return (
    <Modal title="Settings" onClose={onClose}>
      <section className="settings-block">
        <h3>Claude API key</h3>
        <p className="hint">
          Used to read screenshots, PDFs and messy text. Stored only in this browser and sent only to api.anthropic.com. Without
          a key, pasted text and text PDFs still work.
        </p>
        <div className="row gap">
          <input
            className="grow"
            type={showKey ? "text" : "password"}
            placeholder="sk-ant-..."
            value={key}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="btn small" onClick={() => setShowKey((v) => !v)}>
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        <div className="row gap">
          <button
            className="btn small primary"
            disabled={key.trim() === savedKey}
            onClick={() => {
              setApiKey(key.trim());
              setSavedKey(key.trim());
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
              }}
            >
              Remove key
            </button>
          )}
          <span className="hint">{savedKey ? "Key saved." : "No key saved."}</span>
        </div>
        <label className="field">
          Model
          <select value={s.model} onChange={(e) => mutate((st) => void (st.model = e.target.value))}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </section>

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
        <p className="hint">New courses start from the default preset. Each course can override its bands.</p>
        <div className="row gap wrap">
          <select value={preset.id} onChange={(e) => setEditId(e.target.value)} aria-label="Preset">
            {s.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === s.defaultPresetId ? " (default)" : ""}
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
              Make default
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
                c.bands = cloneBands(p.bands);
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
      <BandEditor bands={course.bands} onChange={(b) => updateCourse(course.id, (c) => void (c.bands = b))} />
    </Modal>
  );
}
