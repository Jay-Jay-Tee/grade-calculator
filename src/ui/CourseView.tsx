import { useMemo, useState } from "react";
import { validateBands } from "../engine/bands";
import { bestNSlots, countedItemIds, itemPct, sectionPct, summarize, type CourseSummary } from "../engine/calc";
import { uid } from "../engine/id";
import {
  courseStanding,
  itemPercentile,
  placementHint,
  relativeBandFor,
  relativeNeed,
  validateTop,
  withTopCutoffs,
  type Standing,
} from "../engine/relative";
import type { AggregationRule, ClassStats, Course, GradeBand, Item, Section } from "../engine/types";
import { validateCourse, type Issue } from "../engine/validate";
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
  const relative = course.grading === "relative";
  const standingNow = useMemo(() => courseStanding(course, false), [course]);
  const standing = useMemo(() => courseStanding(course, whatIf), [course, whatIf]);
  const issues = useMemo(() => validateCourse(course), [course]);

  const addSection = () =>
    updateCourse(course.id, (c) => {
      c.sections.push({ id: uid(), name: "New section", weight: 0, rule: { kind: "sum" }, items: [] });
    });

  const totalIssue = issues.find((i) => i.field === "total");
  const errorCount = issues.filter((i) => i.level === "error").length;

  return (
    <div className="course">
      <div className="course-head">
        <input
          className="course-name"
          value={course.name}
          aria-label="Course name"
          onChange={(e) => updateCourse(course.id, (c) => void (c.name = e.target.value))}
        />
        <button className="btn primary" onClick={onImport}>
          Import
        </button>
      </div>
      <div className="course-toolbar" role="toolbar" aria-label="Course actions">
        <button className="btn small" onClick={onBands}>
          Grade bands
        </button>
        <button className="btn small" title="Download this course as a file, to share it or open it on another device" onClick={onExport}>
          Download course
        </button>
        <button className="btn small" onClick={onTemplate}>
          Duplicate as template
        </button>
        <span className="grow" />
        <button className="btn small ghost danger" onClick={onDelete}>
          Delete course
        </button>
      </div>

      <SummaryBar summary={summary} whatIf={whatIf} relative={relative} standing={standingNow} bands={course.bands} />

      {totalIssue && <div className="banner warn">{totalIssue.message} Totals are out of {fmtNum(summary.totalWeight)}.</div>}
      {errorCount > 0 && (
        <div className="banner error">
          {errorCount === 1 ? "1 value needs fixing" : `${errorCount} values need fixing`}. Look for the red messages below.
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
            <SectionCard
              key={s.id}
              courseId={course.id}
              section={s}
              whatIf={whatIf}
              relative={relative}
              issues={issues.filter((i) => i.sectionId === s.id)}
            />
          ))}
          {course.sections.length > 0 && (
            <button className="btn add-section" onClick={addSection}>
              + Add section
            </button>
          )}
        </div>
        <NeededPanel course={course} summary={summary} whatIf={whatIf} relative={relative} standing={standing} onBands={onBands} />
      </div>
    </div>
  );
}

function SummaryBar({
  summary: s,
  whatIf,
  relative,
  standing,
  bands,
}: {
  summary: CourseSummary;
  whatIf: boolean;
  relative: boolean;
  standing: Standing;
  bands: GradeBand[];
}) {
  const top = standing.pct == null ? null : 100 - standing.pct;
  const curvedBand = relativeBandFor(bands, top);
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
      {relative ? (
        <div className="tile curved">
          <div className="tile-label">Class standing</div>
          <div className="tile-value">{top == null ? "-" : `Top ${Math.max(1, Math.round(top))}%`}</div>
          <div className="tile-sub">
            {top == null ? "Add class stats to items" : `Curved ~${curvedBand?.label ?? "-"}`}
            {s.currentBand ? `, absolute ${s.currentBand.label}` : ""}
          </div>
        </div>
      ) : (
        <div className="tile">
          <div className="tile-label">Band now</div>
          <div className="tile-value band">{s.currentBand?.label ?? "-"}</div>
          <div className="tile-sub">{s.currentBand ? `${s.currentBand.min}% and up` : ""}</div>
        </div>
      )}
      <label className="whatif-toggle">
        <input type="checkbox" checked={whatIf} onChange={(e) => mutate((st) => void (st.whatIfMode = e.target.checked))} />
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

function NeededPanel({
  course,
  summary: s,
  whatIf,
  relative,
  standing,
  onBands,
}: {
  course: Course;
  summary: CourseSummary;
  whatIf: boolean;
  relative: boolean;
  standing: Standing;
  onBands: () => void;
}) {
  const remaining = s.remaining;
  const hasSections = course.sections.length > 0;
  const bandIssues = relative ? validateTop(course.bands) : validateBands(course.bands);

  const setCutoff = (i: number, v: number | null) =>
    updateCourse(course.id, (c) => {
      if (v == null) return;
      if (relative) c.bands[i].top = v;
      else c.bands[i].min = v;
    });

  const setGrading = (g: "absolute" | "relative") =>
    updateCourse(course.id, (c) => {
      c.grading = g;
      if (g === "relative") c.bands = withTopCutoffs(c.bands);
    });

  const done = hasSections && remaining < 1e-9;
  return (
    <aside className="needed-panel card">
      <div className="needed-head">
        <h3>What do I need?</h3>
        <div className="segmented small" role="radiogroup" aria-label="How this course is graded">
          <button role="radio" aria-checked={!relative} className={!relative ? "on" : ""} onClick={() => setGrading("absolute")}>
            Absolute
          </button>
          <button role="radio" aria-checked={relative} className={relative ? "on" : ""} onClick={() => setGrading("relative")}>
            Curved
          </button>
        </div>
      </div>

      {!hasSections ? (
        <p className="hint">Add sections and weights first.</p>
      ) : done ? (
        <p className="hint">
          Everything is graded{whatIf ? " (counting what-ifs)" : ""}. Final result: {fmtPct(s.locked / (s.totalWeight / 100))}.
        </p>
      ) : relative ? (
        <p className="hint">
          Where you need to place in the class on what's left.{" "}
          {standing.itemsWithStats === 0
            ? "No class stats yet, so this assumes you start from nothing. Absolute scores are shown underneath as a baseline."
            : `Based on ${standing.itemsWithStats} of ${standing.itemsGraded} marked items with class stats.`}
          {whatIf && " Counting your what-if scores."}
        </p>
      ) : (
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
      )}

      {hasSections && (
        <>
          <ul className="needs">
            <li className="need need-head">
              <span>Grade</span>
              <span>{relative ? "Top % of class" : "Min %"}</span>
              <span className="r">{done ? "" : "You need"}</span>
            </li>
            {course.bands.map((band, i) => {
              const abs = s.needs.find((n) => n.band === band);
              const rel = relative && band.top != null && !done ? relativeNeed(standing, remaining, band.top) : null;
              const status = relative ? rel?.status : abs?.result.status;
              const bad = bandIssues.some((x) => x.index === i);
              return (
                <li key={i} className={`need ${done ? "" : status ?? ""}`}>
                  <span className="need-band">{band.label}</span>
                  <span className="need-min">
                    <NumberField
                      value={relative ? band.top ?? null : band.min}
                      allowEmpty={false}
                      min={0}
                      max={100}
                      className={`cutoff ${bad ? "invalid" : ""}`}
                      ariaLabel={`${band.label} ${relative ? "top % of class" : "minimum %"}`}
                      onChange={(v) => setCutoff(i, v)}
                    />
                    <span className="unit">%</span>
                  </span>
                  <span className="need-val">
                    {done ? null : relative ? (
                      <>
                        {rel?.status === "secured" && "Already secured"}
                        {rel?.status === "out_of_reach" && "Out of reach"}
                        {rel?.status === "needed" && (
                          <>
                            Top {Math.max(1, Math.round(rel.top))}% on the rest
                            <span className="raw block">{placementHint(rel.top)}</span>
                          </>
                        )}
                        {abs && <span className="raw block baseline">absolute: {absText(abs.result)}</span>}
                      </>
                    ) : (
                      abs && (
                        <>
                          {absText(abs.result)}
                          {abs.raw != null && s.single?.max != null && (
                            <span className="raw">
                              {" "}
                              {fmtNum(abs.raw)}/{fmtNum(s.single.max)}
                            </span>
                          )}
                        </>
                      )
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {bandIssues.length > 0 && (
            <div className="field-error">
              {course.bands[bandIssues[0].index]?.label}: {bandIssues[0].message}.
            </div>
          )}
        </>
      )}
      <p className="hint small">
        Tap a cutoff to change it.{" "}
        <button className="link" onClick={onBands}>
          More band options
        </button>
      </p>
      <p className="hint small">
        {relative
          ? "Curved grades are an estimate from class stats. The real curve can differ, so absolute is shown as a baseline."
          : "Many courses are curved, so treat these bands as your own targets."}
      </p>
    </aside>
  );
}

function absText(r: CourseSummary["needs"][number]["result"]): string {
  if (r.status === "secured") return "Already secured";
  if (r.status === "out_of_reach") return "Out of reach";
  return fmtPct(r.pct);
}

const RULE_LABEL: Record<AggregationRule["kind"], string> = {
  sum: "Total marks",
  average: "Average of items",
  bestN: "Best N count",
  dropLowest: "Drop lowest",
};

function SectionCard({
  courseId,
  section: s,
  whatIf,
  relative,
  issues,
}: {
  courseId: string;
  section: Section;
  whatIf: boolean;
  relative: boolean;
  issues: Issue[];
}) {
  const pct = sectionPct(s, whatIf);
  const counted = countedItemIds(s, whatIf);
  const planned = s.rule.kind === "bestN" ? bestNSlots(s) - s.items.length : 0;
  const [collapsed, setCollapsed] = useState(s.items.length > 10);
  const up = (fn: (x: Section) => void) => updateSection(courseId, s.id, fn);
  const sectionIssues = issues.filter((i) => !i.itemId);
  const hasItemErrors = issues.some((i) => i.itemId && i.level === "error");

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
          <NumberField
            value={s.weight}
            allowEmpty={false}
            min={0}
            max={100}
            ariaLabel="Weight"
            className="w-sm"
            onChange={(v) => up((x) => void (x.weight = v ?? 0))}
          />
          %
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
      <IssueList issues={sectionIssues} />
      {collapsed && hasItemErrors && <div className="field-error">Some items here need fixing. Expand to see them.</div>}

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
              {s.items.map((it) => (
                <ItemRow
                  key={it.id}
                  courseId={courseId}
                  sectionId={s.id}
                  item={it}
                  whatIf={whatIf}
                  relative={relative}
                  dropped={itemPct(it, whatIf) != null && !counted.has(it.id)}
                  issues={issues.filter((i) => i.itemId === it.id)}
                  onRemove={() => up((x) => void (x.items = x.items.filter((y) => y.id !== it.id)))}
                />
              ))}
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

function ItemRow({
  courseId,
  sectionId,
  item: it,
  whatIf,
  relative,
  dropped,
  issues,
  onRemove,
}: {
  courseId: string;
  sectionId: string;
  item: Item;
  whatIf: boolean;
  relative: boolean;
  dropped: boolean;
  issues: Issue[];
  onRemove: () => void;
}) {
  const [statsOpen, setStatsOpen] = useState(false);
  const p = itemPct(it, whatIf);
  const usingWhatIf = whatIf && it.whatIf != null;
  const upd = (fn: (x: Item) => void) => updateItem(courseId, sectionId, it.id, fn);
  const bad = (f: Issue["field"]) => {
    const i = issues.find((x) => x.field === f);
    return i ? (i.level === "error" ? "invalid" : "warn") : "";
  };
  const perc = relative ? itemPercentile(it, whatIf) : null;

  return (
    <>
      <div className={`item-row ${dropped ? "dropped" : ""} ${usingWhatIf ? "using-whatif" : ""}`}>
        <input className="item-name" value={it.name} aria-label="Item name" onChange={(e) => upd((x) => void (x.name = e.target.value))} />
        <NumberField value={it.score} placeholder="-" min={0} className={bad("score")} ariaLabel={`${it.name} score`} onChange={(v) => upd((x) => void (x.score = v))} />
        <NumberField
          value={it.max}
          allowEmpty={false}
          min={0}
          exclusiveMin
          className={bad("max")}
          ariaLabel={`${it.name} max`}
          onChange={(v) => upd((x) => void (x.max = v ?? x.max))}
        />
        {whatIf && (
          <NumberField
            value={it.whatIf}
            placeholder="?"
            min={0}
            className={`whatif-input ${bad("whatIf")}`}
            ariaLabel={`${it.name} what-if score`}
            onChange={(v) => upd((x) => void (x.whatIf = v))}
          />
        )}
        <span className="r item-pct">
          {fmtPct(p, 0)}
          {dropped && <span className="tag">dropped</span>}
        </span>
        <button className="icon-btn" aria-label={`Remove ${it.name}`} onClick={onRemove}>
          ×
        </button>
      </div>
      {relative && (
        <div className="item-stats">
          <button className="link small" onClick={() => setStatsOpen((v) => !v)} aria-expanded={statsOpen}>
            {statsSummary(it.stats) ?? "Add class stats"}
          </button>
          {perc != null && <span className="tag curved">top {Math.max(1, Math.round(100 - perc))}%</span>}
          {statsOpen && <StatsEditor stats={it.stats} max={it.max} onChange={(st) => upd((x) => void (x.stats = st))} />}
        </div>
      )}
      <IssueList issues={issues.filter((i) => relative || i.field !== "stats")} />
    </>
  );
}

const STAT_FIELDS: [keyof ClassStats, string][] = [
  ["low", "Low"],
  ["lower", "Lower Q"],
  ["median", "Median"],
  ["mean", "Mean"],
  ["upper", "Upper Q"],
  ["high", "High"],
];

function statsSummary(s: ClassStats | undefined): string | null {
  if (!s) return null;
  const parts = STAT_FIELDS.filter(([k]) => s[k] != null).map(([k, l]) => `${l} ${fmtNum(s[k]!)}`);
  return parts.length ? `Class: ${parts.join(", ")}` : null;
}

function StatsEditor({ stats, max, onChange }: { stats: ClassStats | undefined; max: number; onChange: (s: ClassStats | undefined) => void }) {
  return (
    <div className="stats-editor">
      {STAT_FIELDS.map(([k, label]) => (
        <label key={k} className="stat-field">
          <span>{label}</span>
          <NumberField
            value={stats?.[k] ?? null}
            min={0}
            max={max > 0 ? max : undefined}
            placeholder="-"
            ariaLabel={`Class ${label}`}
            onChange={(v) => {
              const next = { ...stats, [k]: v };
              onChange(Object.values(next).some((x) => x != null) ? next : undefined);
            }}
          />
        </label>
      ))}
      <p className="hint small">In raw marks, from the LMS's score details. Quartiles or the median matter most.</p>
    </div>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="issues">
      {issues.map((i, k) => (
        <div key={k} className={i.level === "error" ? "field-error" : "field-warn"}>
          {i.message}
        </div>
      ))}
    </div>
  );
}
