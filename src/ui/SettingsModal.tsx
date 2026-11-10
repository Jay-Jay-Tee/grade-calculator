import { useEffect, useState } from "react";
import { cloneBands, validateBands } from "../engine/bands";
import { uid } from "../engine/id";
import type { Course } from "../engine/types";
import { MODELS } from "../import/models";
import { loadAiConfig, saveAiConfig, type AiConfig, type ProviderSettings } from "../import/ai/config";
import { CUSTOM_EXAMPLES, detectProvider, PROVIDERS, providerById, type ProviderId } from "../import/ai/providers";
import type { ModelInfo } from "../import/ai/prompt";
import { mutate, updateCourse, useAppState, type Theme } from "../state/store";
import { withTopCutoffs } from "../engine/relative";
import { BandEditor } from "./BandEditor";
import { NumberField } from "./NumberField";
import type { Rounding } from "../engine/types";
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
      <AiSection />

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
      <div className="row gap wrap course-band-opts">
        <label className="field">
          Round the final % before picking the grade
          <select
            value={course.rounding ?? "none"}
            onChange={(e) => updateCourse(course.id, (c) => void (c.rounding = e.target.value as Rounding))}
          >
            <option value="none">No rounding (84.99% is not 85%)</option>
            <option value="1dp">To 1 decimal (84.95% counts as 85.0%)</option>
            <option value="int">To a whole number (84.5% counts as 85%)</option>
          </select>
        </label>
        {course.grading === "relative" && (
          <label className="field">
            Class size (optional)
            <NumberField
              value={course.curve?.classSize ?? null}
              integer
              min={2}
              placeholder="100"
              ariaLabel="Class size"
              onChange={(v) => updateCourse(course.id, (c) => void (c.curve = { ...c.curve, classSize: v }))}
            />
          </label>
        )}
      </div>
      {course.grading === "relative" && (
        <p className="hint small">
          Class size sets how extreme the class's lowest and highest scores are. If you don't know it, 100 is used.
        </p>
      )}
      <BandEditor
        bands={course.bands}
        showTop={course.grading === "relative"}
        onChange={(b) => updateCourse(course.id, (c) => void (c.bands = b))}
      />
    </Modal>
  );
}

/**
 * AI provider: pick a provider (or let the key's format pick it), paste a key, check it, pick a
 * model. Each provider keeps its own key and model.
 */
function AiSection() {
  const [cfg, setCfgState] = useState<AiConfig>(() => loadAiConfig());
  const provider = providerById(cfg.active);
  const settings: ProviderSettings = cfg.providers[cfg.active] ?? { key: "", model: provider.defaultModel ?? "" };
  const [key, setKey] = useState(settings.key);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "checking" | "ok" | "error"; text: string }>({ kind: "idle", text: "" });
  const [custom, setCustom] = useState(false);

  const setCfg = (next: AiConfig) => {
    saveAiConfig(next);
    setCfgState(next);
  };
  const update = (id: ProviderId, patch: Partial<ProviderSettings>, base = cfg) => {
    const prev = base.providers[id] ?? { key: "", model: providerById(id).defaultModel ?? "" };
    const next: AiConfig = { ...base, active: id, providers: { ...base.providers, [id]: { ...prev, ...patch } } };
    setCfg(next);
    return next;
  };

  const check = async (id: ProviderId, k: string, base: AiConfig) => {
    if (!k) return;
    const p = providerById(id);
    const baseURL = p.baseURL ?? base.providers[id]?.baseURL;
    setStatus({ kind: "checking", text: "Checking key..." });
    try {
      const { listModels } = await import("../import/aiExtract");
      const { models: list, suggested, keyChecked } = await listModels({ provider: id, key: k, baseURL });
      setModels(list);
      const current = base.providers[id]?.model;
      if (suggested && (!current || (list.length > 0 && !list.some((m) => m.id === current)))) update(id, { model: suggested }, base);
      setStatus({
        kind: "ok",
        text: keyChecked
          ? `Key works. ${list.length} ${list.length === 1 ? "model" : "models"} available.`
          : `Model list loaded (${list.length}). Some services only check the key when you import.`,
      });
    } catch (e) {
      setModels(null);
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    if (settings.key) void check(cfg.active, settings.key, cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchProvider = (id: ProviderId) => {
    const s = cfg.providers[id];
    setKey(s?.key ?? "");
    setModels(null);
    setCustom(false);
    setStatus({ kind: "idle", text: "" });
    const next = { ...cfg, active: id };
    setCfg(next);
    if (s?.key) void check(id, s.key, next);
  };

  const save = () => {
    const k = key.trim();
    const det = detectProvider(k);
    // A key whose format clearly belongs to another provider switches to it (never overrides "Other").
    const target = det && det !== cfg.active && cfg.active !== "custom" ? det : cfg.active;
    const next = update(target, { key: k });
    if (target !== cfg.active) setModels(null);
    void check(target, k, next).then(() => {
      if (target !== cfg.active) setStatus((st) => ({ ...st, text: `This looks like a key for ${providerById(target).short}, so it's saved there. ${st.text}` }));
    });
  };

  const options: ModelInfo[] = (() => {
    const base = models && models.length ? models : provider.id === "gemini" ? MODELS.map((m) => ({ id: m.id, label: m.label })) : [];
    const rec = provider.defaultModel;
    return base.map((m) => (m.id === rec ? { ...m, label: `${m.label} - recommended` } : m));
  })();
  const inList = options.some((m) => m.id === settings.model);
  const host = (() => {
    try {
      return new URL(provider.baseURL ?? settings.baseURL ?? "").host;
    } catch {
      return provider.kind === "gemini" ? "Google" : provider.kind === "anthropic" ? "Anthropic" : "the provider";
    }
  })();

  return (
    <section className="settings-block">
      <h3>AI for screenshots and PDFs</h3>
      <p className="hint">
        Use your own key from any AI provider. Gemini has a free tier. Without a key, pasted text and text PDFs still work.
      </p>
      <label className="field">
        Provider
        <select value={cfg.active} onChange={(e) => switchProvider(e.target.value as ProviderId)}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {cfg.providers[p.id]?.key ? " (key saved)" : ""}
            </option>
          ))}
        </select>
      </label>
      {provider.note && <p className="hint small">{provider.note}</p>}

      {provider.id === "gemini" && (
        <ol className="key-steps">
          <li>
            Open{" "}
            <a href={provider.keyUrl} target="_blank" rel="noreferrer">
              Google AI Studio
            </a>{" "}
            and sign in with a Google account.
          </li>
          <li>
            Tap <b>Create API key</b>. If it asks for a project, let it make one.
          </li>
          <li>Copy the key and paste it below. It starts with "AIza" or "AQ.", both work.</li>
        </ol>
      )}
      {provider.keyUrl && (
        <a className="btn small get-key" href={provider.keyUrl} target="_blank" rel="noreferrer">
          Get a {provider.id === "gemini" ? "free " : ""}key from {provider.short}
        </a>
      )}

      {provider.id === "custom" && (
        <>
          <label className="field">
            API address
            <input
              value={settings.baseURL ?? ""}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              aria-label="API address"
              onChange={(e) => update("custom", { baseURL: e.target.value.trim() })}
            />
          </label>
          <div className="chips-row">
            {CUSTOM_EXAMPLES.map((x) => (
              <button key={x.baseURL} className="chip-btn" onClick={() => update("custom", { baseURL: x.baseURL })}>
                {x.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="row gap">
        <input
          className="grow"
          type={showKey ? "text" : "password"}
          placeholder={provider.keyHint}
          value={key}
          aria-label="API key"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="btn small" onClick={() => setShowKey((v) => !v)}>
          {showKey ? "Hide" : "Show"}
        </button>
      </div>
      {(() => {
        const det = detectProvider(key);
        return det && det !== cfg.active && cfg.active !== "custom" && key.trim() !== settings.key ? (
          <div className="field-warn">This looks like a key for {providerById(det).short}. Saving will switch to it.</div>
        ) : null;
      })()}
      {/\s/.test(key.trim()) && <div className="field-warn">The key has a space in it. Check you copied just the key.</div>}
      <div className="row gap wrap">
        <button className="btn small primary" disabled={!key.trim() || key.trim() === settings.key} onClick={save}>
          Save key
        </button>
        {settings.key && (
          <>
            <button className="btn small" onClick={() => void check(cfg.active, settings.key, cfg)}>
              Check again
            </button>
            <button
              className="btn small ghost danger"
              onClick={() => {
                update(cfg.active, { key: "" });
                setKey("");
                setModels(null);
                setStatus({ kind: "idle", text: "" });
              }}
            >
              Remove key
            </button>
          </>
        )}
        <span className={`hint key-status ${status.kind}`}>{status.text || (settings.key ? "Key saved." : "No key saved.")}</span>
      </div>

      <label className="field">
        Model
        <select
          value={custom || !inList ? "__custom" : settings.model}
          onChange={(e) => {
            if (e.target.value === "__custom") setCustom(true);
            else {
              setCustom(false);
              update(cfg.active, { model: e.target.value });
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
          value={settings.model}
          aria-label="Model name"
          placeholder={provider.defaultModel ?? "model name"}
          spellCheck={false}
          onChange={(e) => update(cfg.active, { model: e.target.value.trim() })}
        />
      )}
      <p className="hint small">
        {models ? "These are the models your key can use. " : "Save a key to see every model it can use. "}
        For screenshots, pick a model that can read images. The key stays in this browser and is only sent to {host}.
      </p>
    </section>
  );
}
