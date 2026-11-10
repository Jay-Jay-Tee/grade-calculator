import { validateBands } from "../engine/bands";
import type { GradeBand } from "../engine/types";
import { NumberField } from "./NumberField";

export function BandEditor({ bands, onChange }: { bands: GradeBand[]; onChange: (b: GradeBand[]) => void }) {
  const issues = validateBands(bands);
  const issueAt = (i: number) => issues.filter((x) => x.index === i).map((x) => x.message);
  const set = (i: number, patch: Partial<GradeBand>) => onChange(bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <div className="band-editor">
      <div className="band-row band-head">
        <span>Band</span>
        <span>Min %</span>
        <span />
      </div>
      {bands.map((b, i) => {
        const errs = issueAt(i);
        return (
          <div key={i} className="band-row-wrap">
            <div className="band-row">
              <input value={b.label} aria-label="Band label" onChange={(e) => set(i, { label: e.target.value })} />
              <NumberField
                value={b.min}
                allowEmpty={false}
                ariaLabel={`${b.label} minimum`}
                className={errs.length ? "invalid" : ""}
                onChange={(v) => v != null && set(i, { min: v })}
              />
              <button className="icon-btn" aria-label={`Remove ${b.label}`} onClick={() => onChange(bands.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
            {errs.length > 0 && <div className="field-error">{errs.join(". ")}</div>}
          </div>
        );
      })}
      <div className="row gap">
        <button
          className="btn small"
          onClick={() => {
            const lowest = bands[bands.length - 1];
            onChange([...bands, { label: "New", min: Math.max(0, (lowest?.min ?? 50) - 5) }]);
          }}
        >
          Add band
        </button>
        {issues.some((x) => x.message.startsWith("Must be lower")) && (
          <button className="btn small" onClick={() => onChange([...bands].sort((a, b) => b.min - a.min))}>
            Sort by min
          </button>
        )}
      </div>
      <p className="hint">The lowest band covers everything below the one above it. Thresholds must go strictly down.</p>
    </div>
  );
}
