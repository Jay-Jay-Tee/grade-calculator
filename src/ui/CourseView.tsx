import { useMemo, useState } from "react";
import { bestNSlots, countedItemIds, itemPct, sectionPct, summarize, type CourseSummary } from "../engine/calc";
import { uid } from "../engine/id";
import type { AggregationRule, Course, Section } from "../engine/types";
import { mutate, updateCourse, updateItem, updateSection } from "../state/store";
import { fmtNum, fmtPct } from "./format";
import { NumberField } from "./NumberField";

type Props = {
  course: Course;
  whatIf: boolean;
  onImport: () => void;
  onBands: () => void;
  onExport: () => void;
  onTemplate: () => void;
  onDelete: () => void;
};

export function CourseView({ course, whatIf, onImport, onBands, onExport, onTemplate, onDelete }: Props) {
  const summary = useMemo(() => summarize(course, whatIf), [course, whatIf]);
  const [menuOpen, setMenuOpen] = useState(false);

  const addSection = () =>
    updateCourse(course.id, (c) => {
      c.sections.push({ id: uid(), name: "New section", weight: 0, rule: { kind: "sum" }, items: [] });
    });

  return (
    <div className="course">
      <div className="course-head">
        <input
          className="course-name"
          value={course.name}
          aria-label="Course name"
          onChange={(e) => updateCourse(course.id, (c) => void (c.name = e.target.value))}
        />
        <div className="course-actions">
          <button className="btn" onClick={onImport}>
            Import
          </button>
          <div className="menu-wrap">
            <button className="btn" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
              More
            </button>
            {menuOpen && (
              <div className="menu" onClick={() => setMenuOpen(false)}>
                <button onClick={onBands}>Grade bands</button>
                <button onClick={onExport}>Export JSON</button>
                <button onClick={onTemplate}>Duplicate as template</button>
                <button className="danger" onClick={onDelete}>
                  Delete course
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <SummaryBar summary={summary} whatIf={whatIf} />

      {course.sections.length > 0 && Math.abs(summary.totalWeight - 100) > 0.01 && (
        <div className="banner warn">
          Weights add up to {fmtNum(summary.totalWeight)}%, not 100%. Totals are out of {fmtNum(summary.totalWeight)}.
        </div>
      )}

      <div className="course-grid">
        <div className="sections">
          {course.sections.length === 0 && (
            <div className="empty-card">
              <p>No sections yet.</p>
              <p className="hint">Add sections like "Midterm 20%" by hand, or import a syllabus or grades page.</p>
              <div className="row gap center">
                <button className="btn primary" onClick={addSection}>
                  Add section
                </button>
                <button className="btn" onClick={onImport}>
                  Import
                </button>
              </div>
            </div>
          )}
          {course.sections.map((s) => (
            <SectionCard key={s.id} courseId={course.id} section={s} whatIf={whatIf} />
          ))}
          {course.sections.length > 0 && (
            <button className="btn add-section" onClick={addSection}>
              + Add section
            </button>
          )}
        </div>
        <NeededPanel summary={summary} whatIf={whatIf} hasSections={course.sections.length > 0} />
      </div>
    </div>
  );
}

function SummaryBar({ summary: s, whatIf }: { summary: CourseSummary; whatIf: boolean }) {
  return (
    <div className="summary">
      <div className="tile main">
        <div className="tile-label">Current</div>
        <div className="tile-value">{fmtPct(s.current)}</div>
        <div className="tile-sub">
          {s.assessedWeight > 0 ? `${fmtNum(assessedPoints(s))} of ${fmtNum(s.assessedWeight)} pts assessed` : "Nothing graded yet"}
        </div>
      </div>
      <div className={`tile ${whatIf ? "" : "muted"}`}>
        <div className="tile-label">Projected</div>
        <div className="tile-value">{whatIf ? fmtPct(s.projected) : "-"}</div>
        <div className="tile-sub">{whatIf ? (s.projectedBand ? `Band ${s.projectedBand.label}` : "With what-ifs") : "Turn on what-if"}</div>
      </div>
      <div className="tile">
        <div className="tile-label">Max possible</div>
        <div className="tile-value">{fmtPct(s.maxPossible)}</div>
        <div className="tile-sub">Locked {fmtNum(s.locked)} pts</div>
      </div>
      <div className="tile">
        <div className="tile-label">Band now</div>
        <div className="tile-value band">{s.currentBand?.label ?? "-"}</div>
        <div className="tile-sub">{s.currentBand ? `${s.currentBand.min}% and up` : ""}</div>
      </div>
      <label className="whatif-toggle">
        <input
          type="checkbox"
          checked={whatIf}
          onChange={(e) => mutate((st) => void (st.whatIfMode = e.target.checked))}
        />
        <span className="switch" aria-hidden />
        <span>What-if mode</span>
      </label>
    </div>
  );
}

/** Points earned on assessed sections (current % x assessed weight). */
function assessedPoints(s: CourseSummary): number {
  return ((s.current ?? 0) * s.assessedWeight) / 100;
}

function NeededPanel({ summary: s, whatIf, hasSections }: { summary: CourseSummary; whatIf: boolean; hasSections: boolean }) {
  const remaining = s.remaining;
  return (
    <aside className="needed card">
      <h3>What do I need?</h3>
      {!hasSections ? (
        <p className="hint">Add sections and weights first.</p>
      ) : remaining < 1e-9 ? (
        <p className="hint">Everything is graded{whatIf ? " (counting what-ifs)" : ""}. Final result: {fmtPct(s.locked / (s.totalWeight / 100))}.</p>
      ) : (
        <>
          <p className="hint">
            {s.single ? (
              <>
                Score needed on <b>{s.single.label}</b>
                {s.single.max != null ? ` (out of ${fmtNum(s.single.max)})` : ""}.
              </>
            ) : (
              <>Average needed on the remaining {fmtNum(remaining)} pts of the course.</>
            )}
            {whatIf && " Counting your what-if scores."}
          </p>
          <ul className="needs">
            {s.needs.map(({ band, result, raw }) => (
              <li key={band.label} className={`need ${result.status}`}>
                <span className="need-band">{band.label}</span>
                <span className="need-min">{band.min}%</span>
                <span className="need-val">
                  {result.status === "secured" && "Already secured"}
                  {result.status === "out_of_reach" && "Out of reach"}
                  {result.status === "needed" && (
                    <>
                      {fmtPct(result.pct)}
                      {raw != null && s.single?.max != null && (
                        <span className="raw">
                          {" "}
                          {fmtNum(raw)}/{fmtNum(s.single.max)}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint small">Many courses are curved, so treat these bands as your own targets.</p>
    </aside>
  );
}

const RULE_LABEL: Record<AggregationRule["kind"], string> = {
  sum: "Total marks",
  average: "Average of items",
  bestN: "Best N count",
  dropLowest: "Drop lowest",
};

function SectionCard({ courseId, section: s, whatIf }: { courseId: string; section: Section; whatIf: boolean }) {
  const pct = sectionPct(s, whatIf);
  const counted = countedItemIds(s, whatIf);
  const planned = s.rule.kind === "bestN" ? bestNSlots(s) - s.items.length : 0;
  const [collapsed, setCollapsed] = useState(s.items.length > 10);
  const up = (fn: (x: Section) => void) => updateSection(courseId, s.id, fn);

  const setRule = (kind: AggregationRule["kind"]) =>
    up((x) => {
      if (kind === "bestN") x.rule = { kind, n: Math.max(1, x.items.length - 1), total: x.items.length || undefined };
      else if (kind === "dropLowest") x.rule = { kind, k: 1 };
      else x.rule = { kind };
    });

  const addItem = () =>
    up((x) => {
      const last = x.items[x.items.length - 1];
      x.items.push({ id: uid(), name: `${x.name} ${x.items.length + 1}`, max: last?.max ?? 100, score: null, whatIf: null });
    });

  return (
    <section className="card section">
      <div className="section-head">
        <button className="icon-btn caret" aria-label={collapsed ? "Expand" : "Collapse"} onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "▸" : "▾"}
        </button>
        <input className="section-name" value={s.name} aria-label="Section name" onChange={(e) => up((x) => void (x.name = e.target.value))} />
        <div className="section-pct">
          <span className="big">{fmtPct(pct)}</span>
          <span className="sub">{pct != null ? `${fmtNum((pct * s.weight) / 100)} / ${fmtNum(s.weight)} pts` : "not graded"}</span>
        </div>
      </div>

      <div className="section-meta">
        <label className="inline-field">
          Weight
          <NumberField value={s.weight} allowEmpty={false} min={0} ariaLabel="Weight" className="w-sm" onChange={(v) => up((x) => void (x.weight = v ?? 0))} />%
        </label>
        <label className="inline-field">
          <select value={s.rule.kind} onChange={(e) => setRule(e.target.value as AggregationRule["kind"])} aria-label="How items combine">
            {Object.entries(RULE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {s.rule.kind === "bestN" && (
          <span className="inline-field">
            best
            <NumberField
              value={s.rule.n}
              integer
              min={1}
              allowEmpty={false}
              className="w-xs"
              ariaLabel="How many count"
              onChange={(v) => up((x) => x.rule.kind === "bestN" && v != null && (x.rule.n = v))}
            />
            of
            <NumberField
              value={s.rule.total ?? null}
              integer
              min={1}
              placeholder={String(s.items.length)}
              className="w-xs"
              ariaLabel="How many in total"
              onChange={(v) => up((x) => x.rule.kind === "bestN" && (x.rule.total = v ?? undefined))}
            />
          </span>
        )}
        {s.rule.kind === "dropLowest" && (
          <span className="inline-field">
            drop
            <NumberField
              value={s.rule.k}
              integer
              min={0}
              allowEmpty={false}
              className="w-xs"
              ariaLabel="How many dropped"
              onChange={(v) => up((x) => x.rule.kind === "dropLowest" && v != null && (x.rule.k = v))}
            />
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          {s.items.length > 0 && (
            <div className={`items ${whatIf ? "with-whatif" : ""}`}>
              <div className="item-row head">
                <span>Item</span>
                <span>Score</span>
                <span>Max</span>
                {whatIf && <span>What-if</span>}
                <span className="r">%</span>
                <span />
              </div>
              {s.items.map((it) => {
                const p = itemPct(it, whatIf);
                const dropped = p != null && !counted.has(it.id);
                const usingWhatIf = whatIf && it.whatIf != null;
                return (
                  <div key={it.id} className={`item-row ${dropped ? "dropped" : ""} ${usingWhatIf ? "using-whatif" : ""}`}>
                    <input
                      className="item-name"
                      value={it.name}
                      aria-label="Item name"
                      onChange={(e) => updateItem(courseId, s.id, it.id, (x) => void (x.name = e.target.value))}
                    />
                    <NumberField
                      value={it.score}
                      placeholder="-"
                      ariaLabel={`${it.name} score`}
                      onChange={(v) => updateItem(courseId, s.id, it.id, (x) => void (x.score = v))}
                    />
                    <NumberField
                      value={it.max}
                      allowEmpty={false}
                      min={0}
                      ariaLabel={`${it.name} max`}
                      onChange={(v) => updateItem(courseId, s.id, it.id, (x) => void (x.max = v ?? x.max))}
                    />
                    {whatIf && (
                      <NumberField
                        value={it.whatIf}
                        placeholder="?"
                        className="whatif-input"
                        ariaLabel={`${it.name} what-if score`}
                        onChange={(v) => updateItem(courseId, s.id, it.id, (x) => void (x.whatIf = v))}
                      />
                    )}
                    <span className="r item-pct">
                      {fmtPct(p, 0)}
                      {dropped && <span className="tag">dropped</span>}
                    </span>
                    <button
                      className="icon-btn"
                      aria-label={`Remove ${it.name}`}
                      onClick={() => up((x) => void (x.items = x.items.filter((y) => y.id !== it.id)))}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {planned > 0 && (
            <p className="hint small">
              {planned} more {planned === 1 ? "item" : "items"} planned, counted as still to come.
            </p>
          )}
          <div className="row gap section-foot">
            <button className="btn small" onClick={addItem}>
              + Item
            </button>
            <span className="grow" />
            <button
              className="btn small ghost danger"
              onClick={() => {
                if (s.items.length === 0 || confirm(`Delete "${s.name}" and its ${s.items.length} items?`)) {
                  updateCourse(courseId, (c) => void (c.sections = c.sections.filter((x) => x.id !== s.id)));
                }
              }}
            >
              Delete section
            </button>
          </div>
        </>
      )}
    </section>
  );
}
