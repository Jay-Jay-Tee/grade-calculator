import { useRef, useState, type DragEvent } from "react";
import { uid } from "../engine/id";
import type { AggregationRule, Course } from "../engine/types";
import { MODELS } from "../import/models";
import { applyDraft, buildDraft, checkWeights, draftProblems, itemFlags } from "../import/draft";
import { extractAll } from "../import/extract";
import { fileKind, type RawInput } from "../import/inputs";
import type { Draft, DraftItem, DraftSection, ItemFlag } from "../import/types";
import { defaultPreset, getApiKey, replaceCourse, addCourse, useAppState } from "../state/store";
import { fmtNum } from "./format";
import { Modal } from "./Modal";
import { NumberField } from "./NumberField";

type Step = "input" | "working" | "review";

export function ImportModal({ current, onClose, onOpenSettings }: { current: Course | null; onClose: () => void; onOpenSettings: () => void }) {
  const st = useAppState();
  const apiKey = getApiKey();
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<RawInput[]>([]);
  const [target, setTarget] = useState<"new" | "current">(current ? "current" : "new");
  const [useAi, setUseAi] = useState(apiKey.length > 0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = (list: FileList | File[]) => {
    const add = [...list].map((file): RawInput => ({ id: uid(), kind: "file", label: file.name || "Pasted image", file }));
    setFiles((f) => [...f, ...add]);
  };

  const inputs: RawInput[] = [...(text.trim() ? [{ id: "text", kind: "text" as const, label: "Pasted text", text }] : []), ...files];
  const imagesWithoutKey = !useAi && files.some((f) => f.kind === "file" && fileKind(f.file) === "image");

  const run = async () => {
    setError(null);
    setStep("working");
    abort.current = new AbortController();
    const results = await extractAll(inputs, { apiKey, model: st.model, useAi, signal: abort.current.signal });
    if (abort.current.signal.aborted) return;
    const existing = target === "current" ? current : null;
    const d = buildDraft(results, existing);
    if (d.items.length === 0 && d.sections.every((s) => s.existingId)) {
      setError(results.flatMap((r) => r.warnings).join(" ") || "Nothing was found in these inputs.");
      setStep("input");
      return;
    }
    setDraft(d);
    setStep("review");
  };

  const apply = () => {
    if (!draft) return;
    const existing = target === "current" ? current : null;
    const course = applyDraft(draft, existing, defaultPreset(st));
    if (existing) replaceCourse(course);
    else addCourse(course);
    onClose();
  };

  if (step === "review" && draft) {
    return <ReviewStep draft={draft} setDraft={setDraft} merging={target === "current" && !!current} onBack={() => setStep("input")} onApply={apply} onClose={onClose} />;
  }

  const modelLabel = MODELS.find((m) => m.id === st.model)?.label ?? st.model;
  return (
    <Modal
      title="Import"
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      footer={
        step === "working" ? (
          <>
            <span className="spinner" aria-hidden /> <span>Reading {inputs.length === 1 ? "input" : `${inputs.length} inputs`}...</span>
            <span className="grow" />
            <button
              className="btn"
              onClick={() => {
                abort.current?.abort();
                setStep("input");
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="grow" />
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={inputs.length === 0} onClick={run}>
              Extract
            </button>
          </>
        )
      }
    >
      <p className="hint">Paste a grades page, syllabus or results email, or add screenshots and PDFs. You review everything before it's applied.</p>
      <textarea
        className="paste"
        placeholder="Paste text here. You can also paste a screenshot."
        value={text}
        disabled={step === "working"}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
          if (imgs.length) {
            e.preventDefault();
            addFiles(imgs);
          }
        }}
      />
      <div
        className={`dropzone ${dragging ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
      >
        Drop files or tap to choose (PDF, images, text)
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept=".pdf,image/*,.txt,.csv,.md,.html"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.id}>
              <span className="file-kind">{f.kind === "file" ? fileKind(f.file) : "text"}</span>
              <span className="grow ellipsis">{f.label}</span>
              <button className="icon-btn" aria-label={`Remove ${f.label}`} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="import-options">
        <label className="field">
          Import into
          <select value={target} onChange={(e) => setTarget(e.target.value as "new" | "current")}>
            <option value="new">A new course</option>
            {current && <option value="current">{current.name} (merge)</option>}
          </select>
        </label>
        {apiKey ? (
          <label className="check">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            Read with Claude ({modelLabel})
          </label>
        ) : (
          <p className="hint">
            No API key, so only the plain-text parser runs (pasted text and text PDFs).{" "}
            <button className="link" onClick={onOpenSettings}>
              Add a key
            </button>{" "}
            to read screenshots.
          </p>
        )}
      </div>
      {imagesWithoutKey && <div className="banner warn">Images need Claude to read them. They'll be skipped.</div>}
      {error && <div className="banner error">{error}</div>}
    </Modal>
  );
}

// ---------------- Review ----------------

const FLAG_TEXT: Record<ItemFlag, string> = {
  suspicious_zero: "0 looks off: class low is above 0",
  unmatched_item: "Not in a section",
  what_if_value: "Marked as what-if",
  missing_submission: "Marked missing",
  dropped: "Dropped by LMS",
};

function ReviewStep({
  draft,
  setDraft,
  merging,
  onBack,
  onApply,
  onClose,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  merging: boolean;
  onBack: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);

  const edit = (fn: (d: Draft) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };
  const editSection = (key: string, fn: (s: DraftSection) => void) =>
    edit((d) => {
      const s = d.sections.find((x) => x.key === key);
      if (s) fn(s);
    });
  const editItem = (key: string, fn: (i: DraftItem) => void) =>
    edit((d) => {
      const i = d.items.find((x) => x.key === key);
      if (i) fn(i);
    });

  const weights = checkWeights(draft.sections);
  const problems = draftProblems(draft);
  const live = draft.sections.filter((s) => s.include);
  const liveKeys = new Set(live.map((s) => s.key));
  const groups: { key: string | null; name: string }[] = [
    ...live.map((s) => ({ key: s.key, name: s.name || "(unnamed)" })),
    { key: null, name: "Unassigned" },
  ];
  const itemsIn = (key: string | null) =>
    draft.items.filter((i) => (key == null ? !i.sectionKey || !liveKeys.has(i.sectionKey) : i.sectionKey === key));

  const onDrop = (e: DragEvent, key: string | null) => {
    e.preventDefault();
    const k = e.dataTransfer.getData("text/plain") || dragKey;
    if (k) editItem(k, (i) => void (i.sectionKey = key));
    setDragKey(null);
    setOverGroup(null);
  };

  const canApply =
    problems.badItems.length === 0 && problems.negative.length === 0 && problems.badSections.length === 0 && draft.courseName.trim().length > 0;

  return (
    <Modal
      title="Review import"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onBack}>
            Back
          </button>
          <span className="grow footer-note">
            {problems.badItems.length > 0 && <span className="error-text">Set a max for: {problems.badItems.join(", ")}. </span>}
            {problems.negative.length > 0 && <span className="error-text">Negative score: {problems.negative.join(", ")}. </span>}
            {problems.badSections.length > 0 && <span className="error-text">Check name and weight (0 to 100): {problems.badSections.join(", ")}. </span>}
            {problems.unassigned > 0 && <span>{problems.unassigned} unassigned {problems.unassigned === 1 ? "item" : "items"} will be skipped.</span>}
          </span>
          <button className="btn primary" disabled={!canApply} onClick={onApply}>
            {merging ? "Apply to course" : "Create course"}
          </button>
        </>
      }
    >
      <div className="review">
        <label className="field">
          Course name
          <input value={draft.courseName} onChange={(e) => edit((d) => void (d.courseName = e.target.value))} />
        </label>

        <div className="sources">
          {draft.sources.map((s, i) => (
            <div key={i} className="source">
              <span className="file-kind">{s.method === "ai" ? "Claude" : s.method === "pdf-text" ? "PDF text" : "Text parser"}</span>
              <span className="ellipsis">{s.label}</span>
              {s.warnings.map((w, j) => (
                <span key={j} className="warn-text">
                  {w}
                </span>
              ))}
            </div>
          ))}
        </div>

        <h3>Sections</h3>
        {!weights.ok && (
          <div className="banner warn">
            Weights add up to {fmtNum(weights.sum)}%, not 100%.
            {weights.suggestion && (
              <>
                {" "}
                "{weights.suggestion.name}" uses a best-N rule, so it may only be worth {fmtNum(weights.suggestion.weight)}%.{" "}
                <button className="link" onClick={() => editSection(weights.suggestion!.sectionKey, (s) => void (s.weight = weights.suggestion!.weight))}>
                  Use {fmtNum(weights.suggestion.weight)}%
                </button>
              </>
            )}
          </div>
        )}
        <div className="review-sections">
          {draft.sections.map((s) => (
            <div key={s.key} className={`review-section ${s.include ? "" : "excluded"}`}>
              <input type="checkbox" checked={s.include} aria-label={`Include ${s.name}`} onChange={(e) => editSection(s.key, (x) => void (x.include = e.target.checked))} />
              <input className="grow" value={s.name} aria-label="Section name" onChange={(e) => editSection(s.key, (x) => void (x.name = e.target.value))} />
              <span className="inline-field">
                <NumberField
                  value={s.weight}
                  allowEmpty={false}
                  min={0}
                  className={`w-sm ${s.weightKnown ? "" : "unknown"}`}
                  ariaLabel={`${s.name} weight`}
                  onChange={(v) => editSection(s.key, (x) => {
                    x.weight = v ?? 0;
                    x.weightKnown = true;
                  })}
                />
                %
              </span>
              <RuleEditor rule={s.rule} onChange={(r) => editSection(s.key, (x) => void (x.rule = r))} />
              {s.existingId && <span className="tag">existing</span>}
              {!s.weightKnown && <span className="tag warn">weight?</span>}
              {s.evidence && <div className="evidence">{s.evidence}</div>}
            </div>
          ))}
          <button
            className="btn small"
            onClick={() =>
              edit((d) =>
                void d.sections.push({ key: uid(), existingId: null, name: "New section", weight: 0, weightKnown: true, rule: { kind: "sum" }, evidence: "", include: true }),
              )
            }
          >
            + Section
          </button>
        </div>

        <h3>Items</h3>
        <p className="hint">Drag items between sections, or pick one from the list on each row.</p>
        {groups.map((g) => {
          const items = itemsIn(g.key);
          if (g.key == null && items.length === 0) return null;
          return (
            <div
              key={g.key ?? "unassigned"}
              className={`review-group ${g.key == null ? "unassigned" : ""} ${overGroup === (g.key ?? "_") ? "over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverGroup(g.key ?? "_");
              }}
              onDragLeave={() => setOverGroup(null)}
              onDrop={(e) => onDrop(e, g.key)}
            >
              <div className="group-head">
                {g.name} <span className="count">{items.length}</span>
              </div>
              {items.length === 0 && <div className="hint small drop-hint">Drop items here</div>}
              {items.map((it) => (
                <div
                  key={it.key}
                  className={`review-item ${it.include ? "" : "excluded"}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", it.key);
                    setDragKey(it.key);
                  }}
                >
                  <span className="handle" aria-hidden>
                    ⠿
                  </span>
                  <input type="checkbox" checked={it.include} aria-label={`Include ${it.name}`} onChange={(e) => editItem(it.key, (x) => void (x.include = e.target.checked))} />
                  <input className="grow item-name" value={it.name} aria-label="Item name" onChange={(e) => editItem(it.key, (x) => void (x.name = e.target.value))} />
                  <span className="score-pair">
                    <NumberField value={it.score} placeholder="-" min={0} ariaLabel={`${it.name} score`} onChange={(v) => editItem(it.key, (x) => void (x.score = v))} />
                    <span>/</span>
                    <NumberField value={it.max} placeholder="max" min={0} exclusiveMin ariaLabel={`${it.name} max`} onChange={(v) => editItem(it.key, (x) => void (x.max = v))} />
                  </span>
                  <select
                    value={it.sectionKey && liveKeys.has(it.sectionKey) ? it.sectionKey : ""}
                    aria-label={`Section for ${it.name}`}
                    onChange={(e) => editItem(it.key, (x) => void (x.sectionKey = e.target.value || null))}
                  >
                    <option value="">Unassigned</option>
                    {live.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button className="icon-btn" aria-label={`Remove ${it.name}`} onClick={() => edit((d) => void (d.items = d.items.filter((x) => x.key !== it.key)))}>
                    ×
                  </button>
                  {it.stats && Object.values(it.stats).some((v) => v != null) && (
                    <div className="flags">
                      <span className="hint small">
                        Class stats:{" "}
                        {(["low", "lower", "median", "mean", "upper", "high"] as const)
                          .filter((k) => it.stats![k] != null)
                          .map((k) => `${{ low: "Low", lower: "Lower Q", median: "Median", mean: "Mean", upper: "Upper Q", high: "High" }[k]} ${it.stats![k]}`)
                          .join(", ")}
                      </span>
                    </div>
                  )}
                  {(itemFlags(it).length > 0 || (it.sectionHint && g.key == null)) && (
                    <div className="flags">
                      {itemFlags(it).map((f) => (
                        <span key={f} className={`flag ${f}`}>
                          {FLAG_TEXT[f]}
                        </span>
                      ))}
                      {it.sectionHint && g.key == null && <span className="hint small">Group on source: {it.sectionHint}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        {draft.bands.length > 0 && (
          <>
            <h3>Grade bands found</h3>
            <label className="check">
              <input type="checkbox" checked={draft.useBands} onChange={(e) => edit((d) => void (d.useBands = e.target.checked))} />
              Use these bands for this course
            </label>
            <div className="band-chips">
              {draft.bands.map((b) => (
                <span key={b.label} className="chip">
                  {b.label} {b.min}%
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function RuleEditor({ rule, onChange }: { rule: AggregationRule; onChange: (r: AggregationRule) => void }) {
  return (
    <span className="inline-field rule-editor">
      <select
        value={rule.kind}
        aria-label="Rule"
        onChange={(e) => {
          const k = e.target.value as AggregationRule["kind"];
          onChange(k === "bestN" ? { kind: k, n: 1 } : k === "dropLowest" ? { kind: k, k: 1 } : { kind: k });
        }}
      >
        <option value="sum">Total marks</option>
        <option value="average">Average</option>
        <option value="bestN">Best N</option>
        <option value="dropLowest">Drop lowest</option>
      </select>
      {rule.kind === "bestN" && (
        <>
          <NumberField value={rule.n} integer min={1} allowEmpty={false} className="w-xs" ariaLabel="Best n" onChange={(v) => v != null && onChange({ ...rule, n: v })} />
          of
          <NumberField value={rule.total ?? null} integer min={1} className="w-xs" ariaLabel="Out of" onChange={(v) => onChange({ ...rule, total: v ?? undefined })} />
        </>
      )}
      {rule.kind === "dropLowest" && (
        <NumberField value={rule.k} integer min={0} allowEmpty={false} className="w-xs" ariaLabel="Drop k" onChange={(v) => v != null && onChange({ kind: "dropLowest", k: v })} />
      )}
    </span>
  );
}
