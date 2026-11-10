import { validateBands } from "../engine/bands";
import { validateTop } from "../engine/relative";
import type { GradeBand } from "../engine/types";
import { NumberField } from "./NumberField";

export function BandEditor({ bands, onChange, showTop = true }: { bands: GradeBand[]; onChange: (b: GradeBand[]) => void; showTop?: boolean }) {
  const issues = [...validateBands(bands), ...(showTop ? validateTop(bands).map((x) => ({ ...x, message: `Curved: ${x.message}` })) : [])];
  const issueAt = (i: number) => issues.filter((x) => x.index === i).map((x) => x.message);
  const set = (i: number, patch: Partial<GradeBand>) => onChange(bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <div className="band-editor">
      <div className={`band-row band-head ${showTop ? "with-top" : ""}`}>
        <span>Band</span>
        <span>Min %</span>
        {showTop && <span>Curved: top %</span>}
        <span />
      </div>
      {bands.map((b, i) => {
        const errs = issueAt(i);
        return (
          <div key={i} className="band-row-wrap">
            <div className={`band-row ${showTop ? "with-top" : ""}`}>
              <input value={b.label} aria-label="Band label" onChange={(e) => set(i, { label: e.target.value })} />
              <NumberField
                value={b.min}
                allowEmpty={false}
                ariaLabel={`${b.label} minimum`}
                min={0}
                max={100}
                className={errs.some((e) => !e.startsWith("Curved")) ? "invalid" : ""}
                onChange={(v) => v != null && set(i, { min: v })}
              />
              {showTop && (
                <NumberField
                  value={b.top ?? null}
                  allowEmpty={false}
                  min={0}
                  exclusiveMin
                  max={100}
                  ariaLabel={`${b.label} curved top %`}
                  className={errs.some((e) => e.startsWith("Curved")) ? "invalid" : ""}
                  onChange={(v) => v != null && set(i, { top: v })}
                />
              )}
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
            onChange([...bands, { label: "New", min: Math.max(0, (lowest?.min ?? 50) - 5), top: 100 }]);
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
      <p className="hint">
        Min % is the absolute cutoff (90 and above is A+, and so on). It must go strictly down the list. The lowest band covers everything
        below the one above it.
        {showTop && " Curved: top % is the share of the class that gets this grade or better (A in the top 25%). It must go strictly up, ending at 100."}
      </p>
    </div>
  );
}
